import Link from 'next/link';
import { Hero, PricingTable } from '@/components/marketing';

export default function Home() {
  return (
    <>
      <Hero />
      <section className="section">
        <div className="grid grid-3">
          <div className="card">
            <h3>For individuals</h3>
            <p className="muted">Need proof of address for a tenancy, a job or a loan? Order a verification and share a signed report.</p>
            <Link href="/individuals">Learn more →</Link>
          </div>
          <div className="card">
            <h3>For institutions</h3>
            <p className="muted">Banks and lenders create requests, track every visit and receive evidence-backed reports by API or dashboard.</p>
            <Link href="/institutions">Learn more →</Link>
          </div>
          <div className="card">
            <h3>Become a verifier</h3>
            <p className="muted">Identity-approved local agents earn by walking to nearby properties and capturing structured evidence.</p>
            <Link href="/become-a-verifier">Learn more →</Link>
          </div>
        </div>
      </section>
      <section className="section">
        <h2>Transparent pricing</h2>
        <PricingTable />
      </section>
    </>
  );
}
