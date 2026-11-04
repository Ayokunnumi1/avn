import { PricingTable } from '@/components/marketing';

export const metadata = { title: 'Pricing' };
export default function Page() {
  return (
    <div className="section">
      <h1 style={{ fontSize: '2rem' }}>Pricing</h1>
      <p className="muted">Live prices from the platform configuration.</p>
      <PricingTable />
    </div>
  );
}
