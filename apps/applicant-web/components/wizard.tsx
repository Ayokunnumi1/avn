'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { VERIFICATION_PURPOSES, type VerificationPurpose } from '@avn/contracts';
import {
  Alert,
  ApiError,
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  KeyValue,
  SelectInput,
  Steps,
  TextArea,
  TextInput,
  formatMoney,
  humanize,
  useApi,
  useLocalDraft,
} from '@avn/ui';
import { api } from '@/lib/api';

const MapView = dynamic(() => import('@avn/ui/map').then((m) => m.MapView), { ssr: false, loading: () => <div className="map skeleton" /> });

export interface WizardRequest {
  id: string;
  applicantName: string;
  lockedFields: string[];
  purpose: string;
  level: string;
  requestedBy: string | null;
}

interface Area {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  centerLat: number | null;
  centerLng: number | null;
}
interface GeoResult {
  label: string;
  lat: number;
  lng: number;
  components: Record<string, string | undefined>;
}

const STEPS = ['Purpose', 'Your details', 'Address', 'Map pin', 'Confirm', 'Documents', 'Privacy', 'Visit time', 'Submit'];
const DOC_TYPES = ['UTILITY_BILL', 'TENANCY_AGREEMENT', 'BANK_STATEMENT', 'GOVERNMENT_LETTER', 'ID_DOCUMENT', 'OTHER'];
const LAGOS = { lat: 6.5244, lng: 3.3792 };

interface Draft {
  step: number;
  purpose: string;
  level: string;
  fullName: string;
  email: string;
  dob: string;
  address: { countryCode: string; state: string; lga: string; city: string; district: string; street: string; houseNumber: string; estate: string; landmark: string; directions: string };
  pin: { lat: number; lng: number } | null;
  locationSource: 'MAP_PIN' | 'DEVICE_GPS' | 'GEOCODER';
  gpsAccuracyM: number | null;
  consent: { privacyNoticeAccepted: boolean; visitAuthorised: boolean; dataSharingAuthorised: boolean };
  visitDate: string;
  visitPeriod: string;
}

const emptyDraft = (r?: WizardRequest, name = ''): Draft => ({
  step: 0,
  purpose: r?.purpose ?? 'PERSONAL',
  level: r?.level ?? 'STANDARD',
  fullName: r?.applicantName ?? name,
  email: '',
  dob: '',
  address: { countryCode: 'NG', state: 'Lagos', lga: '', city: '', district: '', street: '', houseNumber: '', estate: '', landmark: '', directions: '' },
  pin: null,
  locationSource: 'MAP_PIN',
  gpsAccuracyM: null,
  consent: { privacyNoticeAccepted: false, visitAuthorised: false, dataSharingAuthorised: false },
  visitDate: '',
  visitPeriod: 'ANY',
});

export function VerificationWizard({ request, defaultName = '', onDone }: { request?: WizardRequest; defaultName?: string; onDone: (requestId: string, payUrl?: string) => void }) {
  const institution = !!request;
  const locked = new Set(request?.lockedFields ?? []);
  const [d, setD, clearDraft] = useLocalDraft<Draft>(`avn-wizard:${request?.id ?? 'individual'}`, emptyDraft(request, defaultName));
  const [docs, setDocs] = useState<Array<{ file: File; documentType: string }>>([]);
  const [error, setError] = useState<ApiError>();
  const [submitting, setSubmitting] = useState(false);
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const setAddr = (patch: Partial<Draft['address']>) => setD({ ...d, address: { ...d.address, ...patch } });

  const states = useApi<Area[]>(api, '/geo/areas?countryCode=NG&type=STATE');
  const stateId = states.data?.find((s) => s.name === d.address.state)?.id;
  const lgas = useApi<Area[]>(api, stateId ? `/geo/areas?countryCode=NG&type=LGA&parentId=${stateId}` : null);
  const quote = useApi<{ price: string; currency: string; slaHours: number }>(api, !institution ? `/me/quote?level=${d.level}&countryCode=NG` : null);

  const stepValid = useMemo(() => {
    switch (d.step) {
      case 1:
        return d.fullName.trim().length >= 2;
      case 2:
        return !!d.address.state && !!d.address.city.trim() && !!d.address.street.trim();
      case 3:
        return !!d.pin;
      case 6:
        return d.consent.privacyNoticeAccepted && d.consent.visitAuthorised && d.consent.dataSharingAuthorised;
      default:
        return true;
    }
  }, [d]);

  async function submit() {
    setSubmitting(true);
    setError(undefined);
    const address = {
      ...Object.fromEntries(Object.entries(d.address).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? undefined : v])),
      countryCode: 'NG',
      lat: d.pin!.lat,
      lng: d.pin!.lng,
      locationSource: d.locationSource,
      gpsAccuracyM: d.gpsAccuracyM ?? undefined,
    };
    const body = {
      purpose: d.purpose,
      fullName: d.fullName,
      email: d.email || undefined,
      dateOfBirth: d.dob || undefined,
      address,
      consent: d.consent,
      visitWindow: d.visitDate ? { date: d.visitDate, period: d.visitPeriod } : undefined,
    };
    try {
      let id = request?.id;
      if (!institution) {
        const created = await api.post<{ id: string }>('/me/requests', { ...body, level: d.level });
        id = created.id;
      }
      for (const doc of docs) {
        const form = new FormData();
        form.append('documentType', doc.documentType);
        form.append('file', doc.file);
        await api.upload(`/me/requests/${id}/documents`, form);
      }
      if (institution) {
        await api.post(`/me/requests/${id}/submit`, body);
        clearDraft();
        onDone(id!);
      } else {
        const pay = await api.post<{ authorizationUrl: string }>(`/me/requests/${id}/pay`);
        clearDraft();
        onDone(id!, pay.authorizationUrl);
      }
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <Steps total={STEPS.length} current={d.step} />
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>
          Step {d.step + 1} of {STEPS.length}: {STEPS[d.step]}
        </h2>
        {institution ? <Badge tone="info">Requested by {request?.requestedBy}</Badge> : null}
      </div>
      <div className="stack">
        {d.step === 0 ? (
          <>
            <SelectInput
              label="Why do you need this verification?"
              value={d.purpose}
              disabled={locked.has('purpose')}
              onChange={(e) => set({ purpose: e.target.value as VerificationPurpose })}
              options={VERIFICATION_PURPOSES.map((p) => ({ value: p, label: humanize(p) }))}
              hint={locked.has('purpose') ? 'Set by the requesting institution.' : undefined}
            />
            {!institution ? (
              <SelectInput
                label="Verification level"
                value={d.level}
                onChange={(e) => set({ level: e.target.value })}
                options={[
                  { value: 'BASIC', label: 'Basic — building & address' },
                  { value: 'STANDARD', label: 'Standard — plus residency confirmation' },
                  { value: 'ENHANCED', label: 'Enhanced — fastest, priority dispatch' },
                ]}
                hint={quote.data ? `${formatMoney(quote.data.price, quote.data.currency)} · target ${quote.data.slaHours} hours` : undefined}
              />
            ) : null}
          </>
        ) : null}

        {d.step === 1 ? (
          <>
            <TextInput label="Full legal name" value={d.fullName} disabled={locked.has('applicantName')} onChange={(e) => set({ fullName: e.target.value })} hint={locked.has('applicantName') ? 'Provided by the institution — contact them if it is wrong.' : undefined} required />
            <TextInput label="Email (optional)" type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} />
            <TextInput label="Date of birth (optional)" type="date" value={d.dob} onChange={(e) => set({ dob: e.target.value })} />
          </>
        ) : null}

        {d.step === 2 ? <AddressStep d={d} setAddr={setAddr} set={set} states={states.data ?? []} lgas={lgas.data ?? []} /> : null}

        {d.step === 3 ? <PinStep d={d} set={set} states={states.data ?? []} /> : null}

        {d.step === 4 ? (
          <>
            <KeyValue
              items={[
                ['Purpose', humanize(d.purpose)],
                ...(institution ? [] : ([['Level', d.level]] as Array<[string, string]>)),
                ['Name', d.fullName],
                ['Address', [[d.address.houseNumber, d.address.street].filter(Boolean).join(' '), d.address.estate, d.address.district, d.address.city, d.address.lga, d.address.state].filter(Boolean).join(', ')],
                ['Landmark', d.address.landmark || '—'],
                ['Map pin', d.pin ? `${d.pin.lat.toFixed(6)}, ${d.pin.lng.toFixed(6)}${d.gpsAccuracyM ? ` (±${Math.round(d.gpsAccuracyM)} m GPS)` : ''}` : '—'],
              ]}
            />
            <Alert tone="info">Check that the pin sits on the right building. The verifier will be guided to this exact point.</Alert>
          </>
        ) : null}

        {d.step === 5 ? <DocsStep docs={docs} setDocs={setDocs} /> : null}

        {d.step === 6 ? (
          <div className="stack">
            <Alert tone="info">
              Read our <a href="/privacy" target="_blank">privacy notice</a>. Your consent is recorded with the date and policy version.
            </Alert>
            <Checkbox label="I have read the privacy notice" checked={d.consent.privacyNoticeAccepted} onChange={(v) => set({ consent: { ...d.consent, privacyNoticeAccepted: v } })} />
            <Checkbox label="I authorise an approved AVN verifier to visit and photograph the outside of this property" description="Verifiers never enter private property." checked={d.consent.visitAuthorised} onChange={(v) => set({ consent: { ...d.consent, visitAuthorised: v } })} />
            <Checkbox label={institution ? `I authorise AVN to share the verification report with ${request?.requestedBy}` : 'I authorise AVN to prepare a report I can share'} checked={d.consent.dataSharingAuthorised} onChange={(v) => set({ consent: { ...d.consent, dataSharingAuthorised: v } })} />
          </div>
        ) : null}

        {d.step === 7 ? (
          <div className="grid grid-2">
            <TextInput label="Preferred day (optional)" type="date" min={new Date().toISOString().slice(0, 10)} value={d.visitDate} onChange={(e) => set({ visitDate: e.target.value })} />
            <SelectInput
              label="Preferred time"
              value={d.visitPeriod}
              onChange={(e) => set({ visitPeriod: e.target.value })}
              options={[
                { value: 'ANY', label: 'Any time' },
                { value: 'MORNING', label: 'Morning' },
                { value: 'AFTERNOON', label: 'Afternoon' },
                { value: 'EVENING', label: 'Evening' },
              ]}
            />
            <p className="small muted" style={{ gridColumn: '1 / -1' }}>We try to match your preference; the verification still proceeds if you are not available.</p>
          </div>
        ) : null}

        {d.step === 8 ? (
          <div className="stack">
            <Alert tone="success" title="Ready to submit">
              {institution ? 'Your details go to the verification network. A nearby verifier will be assigned.' : 'Next you will pay securely. Your request is dispatched only after the payment is confirmed by our server.'}
            </Alert>
            {!institution && quote.data ? <KeyValue items={[['Amount', formatMoney(quote.data.price, quote.data.currency)], ['Target turnaround', `${quote.data.slaHours} hours`]]} /> : null}
            <ErrorAlert error={error} />
            {error?.fieldErrors() && Object.keys(error.fieldErrors()).length ? (
              <ul className="small error-text">
                {Object.entries(error.fieldErrors()).map(([k, v]) => (
                  <li key={k}>
                    {k}: {v}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="row between">
          <Button variant="secondary" disabled={d.step === 0 || submitting} onClick={() => set({ step: d.step - 1 })}>
            Back
          </Button>
          {d.step < STEPS.length - 1 ? (
            <Button disabled={!stepValid} onClick={() => set({ step: d.step + 1 })}>
              Continue
            </Button>
          ) : (
            <Button loading={submitting} onClick={() => void submit()}>
              {institution ? 'Submit for verification' : 'Continue to payment'}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function AddressStep({ d, setAddr, set, states, lgas }: { d: Draft; setAddr: (p: Partial<Draft['address']>) => void; set: (p: Partial<Draft>) => void; states: Area[]; lgas: Area[] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [geoNote, setGeoNote] = useState<string>();
  const [freeText, setFreeText] = useState('');
  const [parse, setParse] = useState<{ source: string; missing: string[]; clarificationQuestions: string[] } | null>(null);
  useEffect(() => {
    if (query.trim().length < 4) return setResults([]);
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ results: GeoResult[]; provider: string; unavailable?: boolean }>(`/geo/search?q=${encodeURIComponent(query)}&countryCode=NG`);
        setResults(r.results);
        setGeoNote(r.provider === 'disabled' ? 'Address search is not configured — fill the fields below and place the pin on the map.' : r.unavailable ? 'Address search is temporarily unavailable.' : undefined);
      } catch {
        setGeoNote('Address search is temporarily unavailable.');
      }
    }, 450);
    return () => clearTimeout(t);
  }, [query]);
  const a = d.address;
  return (
    <div className="stack">
      <TextInput label="Search your address" placeholder="e.g. 12 Allen Avenue, Ikeja" value={query} onChange={(e) => setQuery(e.target.value)} hint={geoNote} />
      {results.length ? (
        <div className="choice-group" role="listbox" aria-label="Address suggestions">
          {results.map((r) => (
            <button
              key={`${r.lat},${r.lng}`}
              type="button"
              className="choice"
              onClick={() => {
                setAddr({ state: r.components.state ?? a.state, city: r.components.city ?? a.city, lga: r.components.lga ?? a.lga, district: r.components.district ?? a.district, street: r.components.street ?? a.street, houseNumber: r.components.houseNumber ?? a.houseNumber });
                set({ pin: { lat: r.lat, lng: r.lng }, locationSource: 'GEOCODER' });
                setResults([]);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>
          Paste your address as text and let us split it for you
        </summary>
        <div className="stack-sm" style={{ marginTop: 8 }}>
          <TextArea label="Address text" value={freeText} onChange={(e) => setFreeText(e.target.value)} />
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              const r = await api.post<{ source: string; components: Record<string, string | null>; missing: string[]; clarificationQuestions: string[] }>('/geo/parse', { text: freeText, countryCode: 'NG' });
              const c = r.components;
              setAddr({ houseNumber: c.houseNumber ?? a.houseNumber, street: c.street ?? a.street, estate: c.estate ?? a.estate, district: c.district ?? a.district, city: c.city ?? a.city, lga: c.lga ?? a.lga, state: c.state ?? a.state, landmark: c.landmark ?? a.landmark });
              setParse(r);
            }}
          >
            Suggest fields
          </Button>
          {parse ? (
            <Alert tone="warning" title={`Suggestion (${parse.source === 'ai' ? 'AI-assisted' : 'rule-based'}) — please check every field`}>
              {parse.missing.length ? `Still missing: ${parse.missing.join(', ')}. ` : ''}
              {parse.clarificationQuestions.join(' ')}
            </Alert>
          ) : null}
        </div>
      </details>
      <div className="grid grid-2">
        <SelectInput label="State" value={a.state} onChange={(e) => setAddr({ state: e.target.value, lga: '' })} options={(states.length ? states : [{ id: 'x', name: 'Lagos' } as Area]).map((s) => ({ value: s.name, label: s.name }))} required />
        {lgas.length ? (
          <SelectInput label="Local government area" value={a.lga} onChange={(e) => setAddr({ lga: e.target.value })} options={[{ value: '', label: 'Select LGA' }, ...lgas.map((l) => ({ value: l.name, label: l.name }))]} />
        ) : (
          <TextInput label="Local government area" value={a.lga} onChange={(e) => setAddr({ lga: e.target.value })} />
        )}
        <TextInput label="City / town" value={a.city} onChange={(e) => setAddr({ city: e.target.value })} required />
        <TextInput label="District or neighbourhood" value={a.district} onChange={(e) => setAddr({ district: e.target.value })} />
        <TextInput label="Street" value={a.street} onChange={(e) => setAddr({ street: e.target.value })} required />
        <TextInput label="House / plot number" value={a.houseNumber} onChange={(e) => setAddr({ houseNumber: e.target.value })} />
        <TextInput label="Estate or compound" value={a.estate} onChange={(e) => setAddr({ estate: e.target.value })} />
        <TextInput label="Nearest landmark" value={a.landmark} onChange={(e) => setAddr({ landmark: e.target.value })} />
      </div>
      <TextArea label="Additional directions" value={a.directions} onChange={(e) => setAddr({ directions: e.target.value })} hint="e.g. Blue gate after the pharmacy, second building on the left." />
    </div>
  );
}

function PinStep({ d, set, states }: { d: Draft; set: (p: Partial<Draft>) => void; states: Area[] }) {
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string>();
  const [atProperty, setAtProperty] = useState(false);
  const st = states.find((s) => s.name === d.address.state);
  const center = d.pin ?? (st?.centerLat != null ? { lat: st.centerLat, lng: st.centerLng! } : LAGOS);
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Tap the map on your building, or drag the red pin. You do not need to be at home to do this.
      </p>
      <MapView center={center} zoom={d.pin ? 18 : 13} pin={d.pin} onPinChange={(p) => set({ pin: p, locationSource: 'MAP_PIN', gpsAccuracyM: null })} accuracy={gps ? { lat: gps.lat, lng: gps.lng, radiusM: gps.accuracy } : null} ariaLabel="Select your property on the map" className="map tall" />
      <div className="row">
        <Button
          variant="secondary"
          onClick={() => {
            setGpsError(undefined);
            if (!navigator.geolocation) return setGpsError('Location is not available on this device.');
            navigator.geolocation.getCurrentPosition(
              (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
              (e) => setGpsError(e.code === 1 ? 'Location permission was denied. Place the pin manually instead.' : 'Could not get your location. Place the pin manually.'),
              { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
            );
          }}
        >
          Use my current location
        </Button>
        {d.pin ? <span className="small mono">{`${d.pin.lat.toFixed(6)}, ${d.pin.lng.toFixed(6)}`}</span> : <span className="small muted">No pin yet</span>}
      </div>
      {gpsError ? <Alert tone="warning">{gpsError}</Alert> : null}
      {gps ? (
        <Card>
          <div className="stack-sm">
            <strong>Your device location</strong>
            <span className="small">
              GPS accuracy ±{Math.round(gps.accuracy)} m{gps.accuracy > 50 ? ' — low accuracy; consider placing the pin manually.' : ''}
            </span>
            <Checkbox label="I am at the property now and this location is correct" checked={atProperty} onChange={setAtProperty} />
            <Button size="sm" disabled={!atProperty} onClick={() => set({ pin: { lat: gps.lat, lng: gps.lng }, locationSource: 'DEVICE_GPS', gpsAccuracyM: gps.accuracy })}>
              Use this location as my pin
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function DocsStep({ docs, setDocs }: { docs: Array<{ file: File; documentType: string }>; setDocs: (d: Array<{ file: File; documentType: string }>) => void }) {
  const [type, setType] = useState('UTILITY_BILL');
  return (
    <div className="stack">
      <Alert tone="info">Optional unless your institution requires it. Documents support the verification; they do not by themselves prove your physical address. PDF, JPG, PNG or WEBP up to 12 MB.</Alert>
      <div className="grid grid-2">
        <SelectInput label="Document type" value={type} onChange={(e) => setType(e.target.value)} options={DOC_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
        <div className="field">
          <label htmlFor="doc-file">File</label>
          <input
            id="doc-file"
            className="input"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setDocs([...docs, { file: f, documentType: type }].slice(0, 5));
              e.target.value = '';
            }}
          />
        </div>
      </div>
      {docs.length ? (
        <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {docs.map((doc, i) => (
            <li key={i} className="row between card" style={{ padding: 10 }}>
              <span className="small">
                {humanize(doc.documentType)} — {doc.file.name} ({Math.round(doc.file.size / 1024)} KB)
              </span>
              <Button variant="ghost" size="sm" onClick={() => setDocs(docs.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
