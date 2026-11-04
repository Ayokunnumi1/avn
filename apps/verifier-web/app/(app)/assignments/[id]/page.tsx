'use client';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChecklistInput } from '@avn/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorAlert,
  KeyValue,
  Modal,
  Segmented,
  SelectInput,
  Spinner,
  StatusBadge,
  TextArea,
  TextInput,
  formatDateTime,
  formatMoney,
  humanize,
  newIdempotencyKey,
  useAction,
  useApi,
  useLocalDraft,
  useOnline,
  useToast,
  type ApiError,
} from '@avn/ui';
import { api } from '@/lib/api';
import { CameraCapture, type Capture } from '@/components/camera';
import { currentFix, useDuty, type Fix } from '@/components/duty';
import { enqueue, flush, list, type QueuedEvidence } from '@/lib/upload-queue';

const MapView = dynamic(() => import('@avn/ui/map').then((m) => m.MapView), { ssr: false, loading: () => <div className="map skeleton" /> });

interface Assignment {
  id: string;
  status: string;
  reference: string;
  requestStatus: string;
  level: string;
  reward: string;
  currency: string;
  deadline: string | null;
  organisation: string | null;
  target: { lat: number; lng: number } | null;
  address: string[];
  landmark: string | null;
  directions: string | null;
  applicant: { firstName: string; phone: string } | null;
  visitWindow: { date: string; period: string } | null;
  instructions: string | null;
  requiredEvidence: string[];
  mandatoryVideo: boolean;
  arrivalThresholdM: number;
  visit: {
    arrivedAt: string | null;
    distanceFromTargetM: number | null;
    withinThreshold: boolean | null;
    arrivalException: string | null;
    applicantConfirmedAt: string | null;
    draft: Partial<ChecklistInput> | null;
    draftUpdatedAt: string | null;
    submittedAt: string | null;
  } | null;
  evidence: Array<{ id: string; category: string; capturedAt: string; distanceFromTargetM: number | null; url: string; aiSuggestion: { label: string; nextAction: string | null; explanation: string | null } | null }>;
}
interface Route {
  distanceM: number;
  durationMin: number;
  source: string;
  shape?: Array<{ lat: number; lng: number }>;
  externalNavigation: { google: string; osm: string; geo: string };
}

const CATEGORIES = ['BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT', 'ADDITIONAL'] as const;
const TRI = [
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'UNKNOWN', label: 'Unsure' },
] as const;
const QUESTIONS: Array<[keyof ChecklistInput, string]> = [
  ['applicantAvailable', 'Is the applicant personally available?'],
  ['applicantConfirmedResidence', 'Did the applicant confirm they live here?'],
  ['occupantConfirmedResidence', 'Did another occupant confirm the applicant lives here?'],
  ['anyoneAvailable', 'Was anyone available at the property?'],
  ['contactRefused', 'Was contact refused?'],
  ['propertyAccessible', 'Is the property accessible?'],
];

export default function FieldVisit() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const duty = useDuty();
  const q = useApi<Assignment>(api, `/assignments/${id}`);
  const a = q.data;
  const [fix, setFix] = useState<Fix | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [fixError, setFixError] = useState<string>();
  const [exception, setException] = useState('NONE');
  const [exceptionNote, setExceptionNote] = useState('');
  const [queue, setQueue] = useState<QueuedEvidence[]>([]);
  const [category, setCategory] = useState<string>('BUILDING_EXTERIOR');
  const [feedback, setFeedback] = useState<Record<string, string[]>>({});
  const [checklist, setChecklist, clearLocal] = useLocalDraft<Partial<ChecklistInput>>(`avn-checklist:${id}`, {});
  const [submitKey, setSubmitKey] = useLocalDraft<string>(`avn-submit-key:${id}`, '');
  const [code, setCode] = useState('');
  const [incident, setIncident] = useState<'ASSISTANCE' | 'UNSAFE_CONDITIONS' | null>(null);
  const [incidentMsg, setIncidentMsg] = useState('');
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseReason, setReleaseReason] = useState('');
  const live = a ? ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(a.status) : false;

  const refreshQueue = useCallback(async () => setQueue(await list(id)), [id]);
  const flushQueue = useCallback(async () => {
    await flush(id, (item, ok, body) => {
      const b = body as { feedback?: { messages: string[] }; integrity?: Array<{ explanation: string }>; error?: { message: string } };
      if (ok) setFeedback((f) => ({ ...f, [item.category]: [...(b.feedback?.messages ?? []), ...(b.integrity?.map((x) => x.explanation) ?? [])] }));
      else toast(b.error?.message ?? 'Evidence was rejected', true);
    });
    await refreshQueue();
    await q.reload();
  }, [id, q, refreshQueue, toast]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);
  useEffect(() => {
    if (online) void flushQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);
  // Merge the server draft if it is newer than the local one (resume on another device).
  useEffect(() => {
    if (a?.visit?.draft && Object.keys(checklist).length === 0) setChecklist(a.visit.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.visit?.draftUpdatedAt]);
  // Autosave the checklist draft to the server (debounced) when online.
  useEffect(() => {
    if (!online || !a?.visit || a.visit.submittedAt || Object.keys(checklist).length === 0) return;
    const t = setTimeout(() => void api.put(`/assignments/${id}/draft`, { checklist, clientUpdatedAt: new Date().toISOString() }).catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [checklist, online, id, a?.visit]);

  const locate = useAction(async () => {
    setFixError(undefined);
    try {
      const f = await currentFix();
      setFix(f);
      if (a?.target) setRoute(await api.get<Route>(`/assignments/${id}/route?lat=${f.lat}&lng=${f.lng}`));
      return f;
    } catch (e) {
      setFixError(e instanceof Error ? e.message : 'Location failed');
      return undefined;
    }
  });
  const enRoute = useAction(async () => {
    await api.post(`/assignments/${id}/en-route`);
    await q.reload();
  });
  const arrive = useAction(async () => {
    // Prefer the on-duty watcher's live fix if it is fresh; otherwise request a new one.
    const live = duty.fix && Date.now() - duty.fix.at < 20_000 ? duty.fix : null;
    const f: Fix = live ?? (fix && Date.now() - fix.at < 20_000 ? fix : await currentFix());
    setFix(f);
    const r = await api.post<{ distanceM: number; withinThreshold: boolean; status: string; exception: string }>(`/assignments/${id}/arrive`, { lat: f.lat, lng: f.lng, accuracyM: f.accuracy, capturedAt: new Date(f.at).toISOString(), isMocked: f.mocked, exception, exceptionNote: exceptionNote || undefined });
    toast(r.withinThreshold ? `Arrival recorded ${r.distanceM} m from the pin` : `Recorded ${r.distanceM} m from the pin — this visit will be reviewed`);
    await q.reload();
  });
  const sendCode = useAction(async () => {
    await api.post(`/assignments/${id}/confirmation-code`);
    toast('Code sent to the applicant by SMS and in their app');
  });
  const verifyCode = useAction(async () => {
    await api.post(`/assignments/${id}/confirmation-code/verify`, { code });
    toast('Applicant confirmation recorded');
    setCode('');
    await q.reload();
  });
  const report = useAction(async () => {
    await api.post(`/assignments/${id}/incidents`, { kind: incident, message: incidentMsg, lat: fix?.lat, lng: fix?.lng });
    toast(incident === 'UNSAFE_CONDITIONS' ? 'Operations alerted. Leave the area if you feel unsafe.' : 'Assistance requested');
    setIncident(null);
    setIncidentMsg('');
  });
  const release = useAction(async () => {
    await api.post(`/assignments/${id}/release`, { reason: releaseReason });
    router.replace('/jobs');
  });
  const submit = useAction(async () => {
    const key = submitKey || newIdempotencyKey();
    if (!submitKey) setSubmitKey(key);
    const r = await api.post<{ requestStatus: string }>(`/assignments/${id}/submit`, { checklist: { houseNumberVisible: false, ...checklist }, idempotencyKey: key });
    clearLocal();
    toast(`Submitted — ${humanize(r.requestStatus)}`);
    await q.reload();
  });

  async function onCapture(c: Capture) {
    const f = await currentFix(10000).catch(() => fix);
    if (!f) return toast('A GPS fix is required with every photo', true);
    await enqueue({
      id: newIdempotencyKey(),
      assignmentId: id,
      category,
      blob: c.blob,
      attempts: 0,
      createdAt: Date.now(),
      meta: {
        category,
        lat: String(f.lat),
        lng: String(f.lng),
        accuracyM: String(Math.round(f.accuracy)),
        capturedAt: c.capturedAt,
        deviceId: deviceId(),
        captureSource: 'CAMERA',
        clientSha256: c.uploadSha256,
        originalSha256: c.originalSha256,
        compressed: String(c.compressed),
      },
    });
    await refreshQueue();
    if (online) await flushQueue();
  }

  const missing = useMemo(() => (a ? a.requiredEvidence.filter((c) => !a.evidence.some((e) => e.category === c)) : []), [a]);
  const checklistDone = QUESTIONS.every(([k]) => checklist[k]) && !!checklist.addressMatchesDescription && !!checklist.buildingExists && !!checklist.occupancySigns;

  if (q.loading) return <Spinner />;
  if (q.error || !a) return <ErrorAlert error={q.error} />;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 2 }}>{a.reference}</h1>
          <div className="row small">
            <StatusBadge status={a.requestStatus} />
            <span>{formatMoney(a.reward, a.currency)}</span>
            <span className="muted">due {formatDateTime(a.deadline)}</span>
          </div>
        </div>
        {queue.length ? <Badge tone="warning">{queue.length} upload{queue.length > 1 ? 's' : ''} pending</Badge> : null}
      </div>

      {a.visit?.submittedAt ? <Alert tone="success" title="Visit submitted">Thank you. Your reward is credited once the verification is processed.</Alert> : null}

      {live ? (
        <Card title="Property">
          <div className="stack">
            <KeyValue
              items={[
                ['Address', a.address.join(', ')],
                ['Landmark', a.landmark],
                ['Directions', a.directions],
                ['Applicant', a.applicant ? <a href={`tel:${a.applicant.phone}`}>{a.applicant.firstName} · {a.applicant.phone}</a> : null],
                ['Preferred visit', a.visitWindow ? `${a.visitWindow.date} · ${humanize(a.visitWindow.period)}` : 'Any time'],
                ['Instructions', a.instructions],
              ]}
            />
            {a.target ? (
              <MapView
                center={a.target}
                zoom={16}
                markers={[{ id: 'target', ...a.target, label: 'Property', color: '#b42318' }, ...(fix ? [{ id: 'me', lat: fix.lat, lng: fix.lng, label: 'You', color: '#175cd3' }] : [])]}
                route={route?.shape}
                accuracy={fix ? { lat: fix.lat, lng: fix.lng, radiusM: fix.accuracy } : null}
                fitToContent={!!fix}
                ariaLabel="Navigation map"
              />
            ) : null}
            {route ? (
              <div className="row small">
                <Badge tone="primary">{Math.round(route.durationMin)} min walk</Badge>
                <span>{(route.distanceM / 1000).toFixed(2)} km remaining{route.source === 'estimate' ? ' (straight-line estimate)' : ''}</span>
              </div>
            ) : null}
            {fixError ? <Alert tone="warning">{fixError}</Alert> : null}
            <div className="row">
              <Button variant="secondary" loading={locate.pending} onClick={() => void locate.run()}>
                Update my position
              </Button>
              {route ? (
                <>
                  <a className="btn btn-secondary" href={route.externalNavigation.google} target="_blank" rel="noreferrer">
                    Google Maps
                  </a>
                  <a className="btn btn-ghost" href={route.externalNavigation.geo}>
                    Other map app
                  </a>
                </>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {a.status === 'ACCEPTED' || a.status === 'EN_ROUTE' ? (
        <Card title="Arrival">
          <div className="stack">
            {a.status === 'ACCEPTED' ? (
              <Button variant="secondary" loading={enRoute.pending} onClick={() => void enRoute.run()}>
                I'm on my way
              </Button>
            ) : null}
            <p className="small muted" style={{ margin: 0 }}>
              At the property, record arrival. Target: within {a.arrivalThresholdM} m. Poor GPS or an inaccessible property never auto-rejects a visit — choose an exception and it goes to review.
            </p>
            <SelectInput
              label="Exception (if any)"
              value={exception}
              onChange={(e) => setException(e.target.value)}
              options={[
                { value: 'NONE', label: 'No exception' },
                { value: 'POOR_GPS', label: 'GPS accuracy is poor here' },
                { value: 'PROPERTY_INACCESSIBLE', label: 'Property is inaccessible' },
                { value: 'ADDRESS_NOT_FOUND', label: 'Address cannot be found' },
              ]}
            />
            {exception !== 'NONE' ? <TextArea label="Explain" value={exceptionNote} onChange={(e) => setExceptionNote(e.target.value)} /> : null}
            {fix ? <div className="small">Current fix ±{Math.round(fix.accuracy)} m</div> : null}
            <ErrorAlert error={arrive.error} />
            <Button size="lg" loading={arrive.pending} onClick={() => void arrive.run()}>
              I have arrived
            </Button>
          </div>
        </Card>
      ) : null}

      {a.status === 'IN_PROGRESS' || a.evidence.length ? (
        <Card title="Evidence" actions={missing.length ? <Badge tone="warning">{missing.length} required missing</Badge> : <Badge tone="success">Required captured</Badge>}>
          <div className="stack">
            {a.visit?.arrivedAt ? (
              <div className="small">
                Arrived {formatDateTime(a.visit.arrivedAt)} · {a.visit.distanceFromTargetM} m from pin {a.visit.withinThreshold ? <Badge tone="success">within threshold</Badge> : <Badge tone="warning">review</Badge>}
              </div>
            ) : null}
            <div className="evidence-grid">
              {a.evidence.map((e) => (
                <figure key={e.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.url} alt={humanize(e.category)} loading="lazy" />
                  <figcaption>
                    {humanize(e.category)} · {e.distanceFromTargetM} m
                    {e.aiSuggestion?.nextAction ? (
                      <span style={{ display: 'block', color: 'var(--info)' }}>
                        {e.aiSuggestion.label}: {e.aiSuggestion.nextAction}
                      </span>
                    ) : null}
                  </figcaption>
                </figure>
              ))}
            </div>
            {Object.entries(feedback).map(([cat, msgs]) => (msgs.length ? <Alert key={cat} tone="warning" title={`${humanize(cat)} — quality check`}>{msgs.join(' ')}</Alert> : null))}
            {queue.length ? (
              <Alert tone="warning" title="Waiting to upload">
                {queue.map((x) => `${humanize(x.category)}${x.lastError ? ` (${x.lastError}, retry ${x.attempts})` : ''}`).join(', ')}
                <div style={{ marginTop: 6 }}>
                  <Button size="sm" variant="secondary" onClick={() => void flushQueue()}>Retry now</Button>
                </div>
              </Alert>
            ) : null}
            {a.status === 'IN_PROGRESS' ? (
              <>
                <SelectInput label="What are you photographing?" value={category} onChange={(e) => setCategory(e.target.value)} options={[...CATEGORIES, ...(a.mandatoryVideo ? [] : [])].map((c) => ({ value: c, label: `${humanize(c)}${a.requiredEvidence.includes(c) ? ' (required)' : ''}` }))} />
                <CameraCapture onCapture={(c) => void onCapture(c)} label={`Capture: ${humanize(category)}`} />
                <p className="small muted" style={{ margin: 0 }}>Photos come only from the in-app camera with GPS and time stamped. Do not enter private property.</p>
              </>
            ) : null}
          </div>
        </Card>
      ) : null}

      {a.status === 'IN_PROGRESS' ? (
        <>
          <Card title="Applicant confirmation (optional)">
            <div className="stack-sm">
              {a.visit?.applicantConfirmedAt ? (
                <Alert tone="success">Applicant confirmed at {formatDateTime(a.visit.applicantConfirmedAt)}. A code alone does not establish residence — complete the checklist honestly.</Alert>
              ) : (
                <>
                  <Button variant="secondary" loading={sendCode.pending} onClick={() => void sendCode.run()}>
                    Send code to applicant
                  </Button>
                  <div className="row">
                    <input className="input otp-input" style={{ maxWidth: 200 }} inputMode="numeric" maxLength={6} aria-label="Code from applicant" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                    <Button loading={verifyCode.pending} disabled={code.length !== 6} onClick={() => void verifyCode.run()}>
                      Verify code
                    </Button>
                  </div>
                  <ErrorAlert error={verifyCode.error ?? sendCode.error} />
                </>
              )}
            </div>
          </Card>
          <Card title="Checklist">
            <div className="stack">
              {QUESTIONS.map(([k, label]) => (
                <Segmented key={k} label={label} value={checklist[k] as string | undefined} options={[...TRI]} onChange={(v) => setChecklist({ ...checklist, [k]: v })} />
              ))}
              <Segmented label="Does the physical address match the description?" value={checklist.addressMatchesDescription} options={[{ value: 'YES', label: 'Yes' }, { value: 'PARTIAL', label: 'Partly' }, { value: 'NO', label: 'No' }, { value: 'UNKNOWN', label: 'Unsure' }]} onChange={(v) => setChecklist({ ...checklist, addressMatchesDescription: v })} />
              <Segmented label="Does the building exist at the pin?" value={checklist.buildingExists} options={[...TRI]} onChange={(v) => setChecklist({ ...checklist, buildingExists: v })} />
              <Segmented label="Signs of occupation?" value={checklist.occupancySigns} options={[{ value: 'OCCUPIED', label: 'Occupied' }, { value: 'APPEARS_VACANT', label: 'Looks vacant' }, { value: 'UNKNOWN', label: 'Unsure' }]} onChange={(v) => setChecklist({ ...checklist, occupancySigns: v })} />
              <SelectInput
                label="Building type"
                value={checklist.buildingType ?? ''}
                onChange={(e) => setChecklist({ ...checklist, buildingType: (e.target.value || undefined) as ChecklistInput['buildingType'] })}
                options={[{ value: '', label: 'Select' }, ...['DETACHED', 'SEMI_DETACHED', 'BLOCK_OF_FLATS', 'COMPOUND', 'COMMERCIAL', 'MIXED_USE', 'UNDER_CONSTRUCTION', 'VACANT_LAND', 'OTHER'].map((b) => ({ value: b, label: humanize(b) }))]}
              />
              <Segmented label="House number visible?" value={checklist.houseNumberVisible === undefined ? undefined : checklist.houseNumberVisible ? 'YES' : 'NO'} options={[{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }]} onChange={(v) => setChecklist({ ...checklist, houseNumberVisible: v === 'YES' })} />
              <TextArea label="Additional observations" value={checklist.observations ?? ''} onChange={(e) => setChecklist({ ...checklist, observations: e.target.value })} />
              <Alert tone="info">If the applicant is absent, say so — absence never means the address is invalid, and you are paid the same.</Alert>
              <ErrorAlert error={submit.error} />
              <Button size="lg" block loading={submit.pending} disabled={!checklistDone || queue.length > 0} onClick={() => void submit.run()}>
                {queue.length ? 'Waiting for uploads…' : missing.length ? `Submit (missing: ${missing.map(humanize).join(', ')})` : 'Submit visit'}
              </Button>
              {!online ? <p className="small muted">You're offline — your checklist is saved on this phone and you can submit when you reconnect.</p> : null}
            </div>
          </Card>
        </>
      ) : null}

      {live ? (
        <div className="row">
          <Button variant="secondary" onClick={() => setIncident('ASSISTANCE')}>
            Request assistance
          </Button>
          <Button variant="danger" onClick={() => setIncident('UNSAFE_CONDITIONS')}>
            Report unsafe conditions
          </Button>
          {a.status !== 'IN_PROGRESS' ? (
            <Button variant="ghost" onClick={() => setReleaseOpen(true)}>
              Give job back
            </Button>
          ) : null}
        </div>
      ) : null}

      <Modal open={!!incident} onClose={() => setIncident(null)} title={incident === 'UNSAFE_CONDITIONS' ? 'Report unsafe conditions' : 'Request assistance'}>
        <div className="stack">
          {incident === 'UNSAFE_CONDITIONS' ? <Alert tone="danger">Your safety comes first. Leave the area, then tell us what happened.</Alert> : null}
          <TextArea label="Message" value={incidentMsg} onChange={(e) => setIncidentMsg(e.target.value)} required />
          <ErrorAlert error={report.error} />
          <Button loading={report.pending} disabled={incidentMsg.length < 3} onClick={() => void report.run()}>
            Send
          </Button>
        </div>
      </Modal>
      <Modal open={releaseOpen} onClose={() => setReleaseOpen(false)} title="Give this job back?">
        <div className="stack">
          <TextInput label="Reason" value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} />
          <ErrorAlert error={release.error as ApiError | undefined} />
          <Button variant="danger" loading={release.pending} disabled={releaseReason.length < 3} onClick={() => void release.run()}>
            Release job
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function deviceId(): string {
  try {
    let id = localStorage.getItem('avn-device-id');
    if (!id) {
      id = `web-${newIdempotencyKey()}`;
      localStorage.setItem('avn-device-id', id);
    }
    return id;
  } catch {
    return 'web-unknown';
  }
}
