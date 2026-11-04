import PDFDocument from 'pdfkit';

/**
 * Institution-ready verification report rendering (spec §4.5, Phase 7).
 * The model is built exclusively from verified database records by the API; this
 * package only renders it. The PDF carries the report reference and content hash so
 * any copy can be checked against the public verification endpoint.
 */
export interface ReportFindingRow {
  label: string;
  value: string;
  basis: string;
}
export interface ReportModel {
  reference: string;
  version: number;
  requestReference: string;
  issuedAt: Date;
  validUntil: Date;
  outcome: string;
  outcomeLabel: string;
  rulesVersion: string;
  organisationName?: string;
  customerReference?: string;
  applicantName: string;
  addressLines: string[];
  level: string;
  findings: ReportFindingRow[];
  visit?: {
    verifierCode: string;
    arrivedAt?: Date;
    submittedAt?: Date;
    distanceFromTargetM?: number | null;
    gpsAccuracyM?: number | null;
    withinThreshold?: boolean | null;
    thresholdM?: number | null;
    applicantConfirmed: boolean;
  };
  summary: string;
  aiAssisted: boolean;
  evidence: Array<{ category: string; capturedAt: Date; distanceM?: number | null; image?: Buffer }>;
  contentHash: string;
  verifyUrl: string;
  timezone: string;
}

const NAVY = '#0f1b2d';
const TEAL = '#0f766e';
const MUTED = '#5b6b7f';
const LINE = '#dfe5ec';

const fmt = (d: Date | undefined, tz: string) =>
  d ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(d) + ` (${tz})` : '—';

export function renderReportPdf(m: ReportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `AVN verification report ${m.reference}`, Author: 'AVN' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - 96;
    // Header
    doc.rect(0, 0, doc.page.width, 84).fill(NAVY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('AVN Address Verification Report', 48, 26);
    doc.font('Helvetica').fontSize(9).fillColor('#c7d2de').text(`Report ${m.reference} · v${m.version} · Request ${m.requestReference}`, 48, 52);
    doc.moveDown(3);

    // Outcome block
    const y0 = 104;
    doc.roundedRect(48, y0, width, 58, 6).fillAndStroke('#f4f7fa', LINE);
    doc.fillColor(MUTED).fontSize(8).text('OUTCOME', 62, y0 + 10);
    doc.fillColor(m.outcome === 'VERIFIED' ? TEAL : NAVY).font('Helvetica-Bold').fontSize(16).text(m.outcomeLabel, 62, y0 + 22);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Issued ${fmt(m.issuedAt, m.timezone)}\nValid until ${fmt(m.validUntil, m.timezone)}`, 300, y0 + 14, { width: width - 260, align: 'right' });
    doc.y = y0 + 74;

    const section = (title: string) => {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(title.toUpperCase(), 48);
      doc.moveTo(48, doc.y + 2).lineTo(48 + width, doc.y + 2).strokeColor(LINE).stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(9.5).fillColor('#1f2a37');
    };
    const kv = (k: string, v: string) => {
      const y = doc.y;
      doc.fillColor(MUTED).text(k, 48, y, { width: 150 });
      doc.fillColor('#1f2a37').text(v, 200, y, { width: width - 152 });
      doc.moveDown(0.25);
    };

    section('Subject');
    if (m.organisationName) kv('Requested by', m.organisationName);
    if (m.customerReference) kv('Customer reference', m.customerReference);
    kv('Applicant', m.applicantName);
    kv('Submitted address', m.addressLines.join(', '));
    kv('Verification level', m.level);

    section('Findings');
    for (const f of m.findings) {
      const y = doc.y;
      doc.font('Helvetica-Bold').fillColor('#1f2a37').text(f.label, 48, y, { width: 150 });
      doc.font('Helvetica-Bold').fillColor(f.value === 'Confirmed' ? TEAL : NAVY).text(f.value, 200, y, { width: 110 });
      doc.font('Helvetica').fillColor(MUTED).fontSize(8.5).text(f.basis, 315, y, { width: width - 267 });
      doc.fontSize(9.5);
      doc.moveDown(0.35);
    }

    if (m.visit) {
      section('Field visit');
      kv('Field verifier', m.visit.verifierCode);
      kv('Arrived', fmt(m.visit.arrivedAt, m.timezone));
      kv('Evidence submitted', fmt(m.visit.submittedAt, m.timezone));
      kv(
        'Distance from pinned location',
        m.visit.distanceFromTargetM == null
          ? 'Not recorded'
          : `${m.visit.distanceFromTargetM} m (threshold ${m.visit.thresholdM ?? '—'} m, ${m.visit.withinThreshold ? 'within' : 'outside'} threshold)`,
      );
      kv('GPS accuracy', m.visit.gpsAccuracyM == null ? 'Not recorded' : `±${Math.round(m.visit.gpsAccuracyM)} m`);
      kv('Applicant confirmation code', m.visit.applicantConfirmed ? 'Confirmed by applicant' : 'Not confirmed');
    }

    section('Summary');
    doc.text(m.summary, 48, doc.y, { width });
    if (m.aiAssisted) doc.moveDown(0.3).fontSize(7.5).fillColor(MUTED).text('Wording assisted by AI from the structured findings above; no facts were added. Findings are authoritative.', { width });

    if (m.evidence.length) {
      const thumbW = (width - 24) / 3;
      if (doc.y + thumbW * 0.75 + 70 > doc.page.height - 60) doc.addPage();
      section('Evidence');
      let x = 48;
      let rowY = doc.y;
      m.evidence.slice(0, 6).forEach((e, i) => {
        if (i > 0 && i % 3 === 0) {
          x = 48;
          rowY += thumbW * 0.75 + 30;
        }
        if (rowY + thumbW > doc.page.height - 120) {
          doc.addPage();
          rowY = 60;
        }
        if (e.image) {
          try {
            doc.image(e.image, x, rowY, { fit: [thumbW, thumbW * 0.75] });
          } catch {
            doc.rect(x, rowY, thumbW, thumbW * 0.75).strokeColor(LINE).stroke();
          }
        }
        doc.fontSize(7.5).fillColor(MUTED).text(`${e.category.replace(/_/g, ' ').toLowerCase()} · ${fmt(e.capturedAt, m.timezone)}`, x, rowY + thumbW * 0.75 + 3, { width: thumbW });
        x += thumbW + 12;
      });
      doc.y = rowY + thumbW * 0.75 + 30;
    }

    section('Authenticity');
    doc.fontSize(8.5).fillColor(MUTED);
    doc.text(`Rules version: ${m.rulesVersion}`, { width });
    doc.text(`Content hash (SHA-256): ${m.contentHash}`, { width });
    doc.text(`Verify this report: ${m.verifyUrl}`, { width });
    doc.moveDown(0.5);
    doc.fontSize(7.5).text(
      'This report records what an approved field verifier observed and captured at a specific time. A property existing does not by itself establish residency; ' +
        'applicant absence does not establish that an address is false; uploaded documents do not independently establish the physical address. ' +
        'Contains personal data processed under the Nigeria Data Protection Act 2023 — share only with authorised parties.',
      { width },
    );
    doc.end();
  });
}
