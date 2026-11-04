import Link from 'next/link';
import { ContentPage } from '@/components/marketing';

export const metadata = { title: 'For individuals' };
export default function Page() {
  return (
    <ContentPage
      title="Address verification for individuals"
      intro="Order a verification, pay securely, and receive a report you control."
      sections={[
        { h: 'Who it is for', p: 'Tenants, job applicants, students, small business owners and anyone asked to prove where they live.' },
        { h: 'What you need', p: 'A phone number, your address and a map pin. Supporting documents such as a utility bill are optional — they support, but never replace, the physical visit.' },
        { h: 'Absent on the day?', p: 'If you are not home, the verifier still records what they observe. Absence never marks your address as false; the report says exactly what was and was not confirmed.' },
        { h: 'Sharing', p: 'Share time-limited report links with landlords or employers, and raise a dispute if anything looks wrong.' },
      ]}
      cta={<Link href="/sign-up" className="btn btn-primary btn-lg">Start a verification</Link>}
    />
  );
}
