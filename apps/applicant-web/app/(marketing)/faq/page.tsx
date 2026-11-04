import { ContentPage } from '@/components/marketing';

export const metadata = { title: 'FAQ' };
const faqs = [
  ['Do I have to be at home to submit my address?', 'No. You can submit and pin your address from anywhere. If you use your current location we show its GPS accuracy and ask you to confirm.'],
  ['Who can see my exact address?', 'Only the requesting institution, platform reviewers and the verifier after they accept the job. Verifiers browsing offers see only the general area.'],
  ['Can AI decide my result?', 'No. AI may suggest better photos or flag risks for human review, but outcomes come from versioned rules applied to field evidence.'],
  ['What if I disagree with a report?', 'Raise a dispute from the report page. Upheld disputes reopen the verification for manual review.'],
  ['How do I know a report is genuine?', 'Every report has a reference and content hash. Check it on the public report verification page.'],
  ['What happens to my data?', 'We process personal data under the Nigeria Data Protection Act 2023. You can request access, correction or deletion from your account, subject to lawful retention requirements.'],
];
export default function Page() {
  return <ContentPage title="Frequently asked questions" intro="Straight answers about how AVN works." sections={faqs.map(([h, p]) => ({ h: h!, p: p! }))} />;
}
