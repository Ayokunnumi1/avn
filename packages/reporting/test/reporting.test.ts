import { describe, expect, it } from 'vitest';
import { renderReportPdf } from '../src';

describe('report PDF', () => {
  it('renders a valid PDF document', async () => {
    const pdf = await renderReportPdf({
      reference: 'AVN-RPT-TEST1234',
      version: 1,
      requestReference: 'AVN-REQ-TEST1234',
      issuedAt: new Date('2026-11-01T10:00:00Z'),
      validUntil: new Date('2027-01-30T10:00:00Z'),
      outcome: 'VERIFIED',
      outcomeLabel: 'Verified',
      rulesVersion: 'avn-rules@1.0.0',
      applicantName: 'Test Applicant (fictional)',
      addressLines: ['12 Test Street', 'Ikeja', 'Lagos'],
      level: 'STANDARD',
      findings: [{ label: 'Building existence', value: 'Confirmed', basis: 'Verifier observed the building; 3 photos.' }],
      summary: 'The building exists and matches the description.',
      aiAssisted: false,
      evidence: [],
      contentHash: 'a'.repeat(64),
      verifyUrl: 'http://localhost:3000/reports/verify?ref=AVN-RPT-TEST1234',
      timezone: 'Africa/Lagos',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
