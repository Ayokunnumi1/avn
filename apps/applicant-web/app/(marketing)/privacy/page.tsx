import { ContentPage } from '@/components/marketing';

export const metadata = { title: 'Privacy policy' };
export default function Page() {
  return (
    <ContentPage
      title="Privacy policy"
      intro="How AVN processes personal data under the Nigeria Data Protection Act 2023 (NDPA). Version consent@2026-11."
      sections={[
        { h: 'What we collect', p: 'Identity and contact details you or a requesting institution provide; your residential address and map pin; supporting documents you upload; field evidence (photos with GPS and timestamps) captured at the property; and verifier location while on duty.' },
        { h: 'Why', p: 'To perform the verification you or an institution requested, to prevent fraud, to meet legal and regulatory obligations, and to operate and secure the service.' },
        { h: 'Lawful basis and consent', p: 'We rely on your consent for the visit and report sharing, recorded with a timestamp and text version, plus contract and legal-obligation bases where applicable.' },
        { h: 'Sharing', p: 'Reports go only to the requesting institution and people you share them with. Verifier live locations are never shown to applicants or other verifiers.' },
        { h: 'Security', p: 'Encryption in transit and at rest for sensitive fields, private storage with short-lived signed links, role-based access, tenant isolation and full audit logging.' },
        { h: 'Retention', p: 'Verification records are retained as required by law and institutional agreements. Verifier location history is minimised and purged after the configured retention window.' },
        { h: 'Your rights', p: 'Access, correction, deletion (subject to lawful retention), objection and portability. Submit a data-subject request from your account or contact us. Breaches are handled under our documented response procedure and notified as the NDPA requires.' },
      ]}
    />
  );
}
