import { ContentPage, LINKS } from '@/components/marketing';

export const metadata = { title: 'Become a verifier' };
export default function Page() {
  return (
    <ContentPage
      title="Earn as an AVN field verifier"
      intro="Walk to nearby properties, capture structured evidence and get paid to your Nigerian bank account."
      sections={[
        { h: 'Requirements', p: '18+, a smartphone with camera and GPS, a government ID (NIN, BVN, voter card, driver’s licence or passport) and a bank account for payouts.' },
        { h: 'Approval', p: 'Register, complete identity verification and pass an administrative review. Unapproved accounts never receive paid assignments.' },
        { h: 'How jobs work', p: 'Go "Available" with the app open. You will receive nearby offers with the general area, walking time, reward and deadline. Accept to see the exact address and directions.' },
        { h: 'Fair performance', p: 'Your reliability score reflects completion and timeliness. You are never penalised when an applicant is legitimately absent, and you are never required to enter private property.' },
      ]}
      cta={<a href={LINKS.AGENT_URL} className="btn btn-primary btn-lg">Open the Agent app</a>}
    />
  );
}
