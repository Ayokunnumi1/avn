import { ContentPage } from '@/components/marketing';

export const metadata = { title: 'How it works' };
export default function Page() {
  return (
    <ContentPage
      title="How AVN verification works"
      intro="A deterministic, auditable process: people collect evidence, rules evaluate it, humans review exceptions."
      sections={[
        { h: '1. Request', p: 'An institution creates a request and you receive a secure link by SMS — or you order a verification yourself. No permanent account is needed for institution links.' },
        { h: '2. Your address and map pin', p: 'Enter your address and place a pin on the exact property. Use your current location if you are at home, or drop the pin manually from anywhere.' },
        { h: '3. Nearby verifier', p: 'The assignment engine finds available, identity-approved verifiers using actual pedestrian walking time — starting at 15 minutes and expanding to 20, 30 and 45. The first to accept gets the job; no job is ever awarded twice.' },
        { h: '4. Physical visit', p: 'The verifier records arrival with GPS, captures camera-only photos of the building, entrance and street, and completes a structured checklist. You can confirm the visit in your app with a one-time code.' },
        { h: '5. Evidence-based findings', p: 'Versioned rules evaluate building existence, address match, occupancy, applicant presence, residency confirmation, contactability and evidence integrity separately. Anything unusual goes to a trained human reviewer.' },
        { h: '6. Verifiable report', p: 'A PDF report with a SHA-256 content hash and reference can be checked by anyone holding it at the public verification page.' },
      ]}
    />
  );
}
