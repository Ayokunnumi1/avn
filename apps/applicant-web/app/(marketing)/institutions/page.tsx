import { ContentPage, LINKS } from '@/components/marketing';

export const metadata = { title: 'For institutions' };
export default function Page() {
  return (
    <ContentPage
      title="Physical address verification for institutions"
      intro="KYC-grade residential verification with evidence, policies and audit trails your compliance team can rely on."
      sections={[
        { h: 'Create requests your way', p: 'Single requests from the dashboard, CSV bulk upload with validation and error reports, or the REST API with idempotency keys and signed webhooks.' },
        { h: 'Your verification policy', p: 'Configure applicant presence, residency confirmation, required evidence, review thresholds, report freshness and deadlines. Policies are versioned; existing requests are never silently changed.' },
        { h: 'Roles and isolation', p: 'Owner, administrator, supervisor, verification officer, finance officer and read-only auditor — enforced server-side with strict tenant isolation.' },
        { h: 'Billing', p: 'Prepaid wallet with usage-based charging, monthly statements, invoices and reconciliation. Postpaid credit for approved organisations.' },
        { h: 'Analytics assistant', p: 'Ask questions such as "which locations have the highest failure rate?" — answered from your own data only, without free-form SQL.' },
      ]}
      cta={<a href={LINKS.BUSINESS_URL} className="btn btn-primary btn-lg">Open the Business app</a>}
    />
  );
}
