import { Card } from '@avn/ui';
import { ContactForm } from '@/components/marketing';

export const metadata = { title: 'Contact' };
export default function Page() {
  return (
    <div className="section" style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: '2rem' }}>Contact us</h1>
      <p className="muted">Partnerships, support or privacy questions — we read every message.</p>
      <Card>
        <ContactForm />
      </Card>
    </div>
  );
}
