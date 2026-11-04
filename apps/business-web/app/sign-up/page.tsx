'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BUSINESS_TYPES } from '@avn/contracts';
import { AuthLayout, Button, ErrorAlert, SelectInput, TextArea, TextInput, humanize, useAction, useAuth } from '@avn/ui';
import { api } from '@/lib/api';

export default function Page() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [o, setO] = useState({ legalName: '', tradingName: '', registrationNumber: '', businessType: 'BANK', contactEmail: '', contactPhone: '', address: '', website: '', expectedMonthlyVolume: '100', verificationRequirements: '' });
  const [r, setR] = useState({ fullName: '', email: '', phone: '', jobTitle: '', password: '' });
  const reg = useAction(async () => {
    await api.post('/org/register', { ...o, expectedMonthlyVolume: Number(o.expectedMonthlyVolume), countryCode: 'NG', representative: r });
    await refresh();
    router.replace('/dashboard');
  });
  const fe = reg.error?.fieldErrors() ?? {};
  return (
    <AuthLayout title="Register your organisation" subtitle="Approval by the AVN platform team is required before you can create verification requests." footer={<>Already registered? <Link href="/sign-in">Sign in</Link></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void reg.run(); }}>
        <ErrorAlert error={reg.error && !Object.keys(fe).length ? reg.error : undefined} />
        <h3>Organisation</h3>
        <TextInput label="Legal business name" value={o.legalName} onChange={(e) => setO({ ...o, legalName: e.target.value })} error={fe.legalName} required />
        <TextInput label="Trading name" value={o.tradingName} onChange={(e) => setO({ ...o, tradingName: e.target.value })} />
        <div className="grid grid-2">
          <TextInput label="CAC registration number" value={o.registrationNumber} onChange={(e) => setO({ ...o, registrationNumber: e.target.value })} error={fe.registrationNumber} required />
          <SelectInput label="Business type" value={o.businessType} onChange={(e) => setO({ ...o, businessType: e.target.value })} options={BUSINESS_TYPES.map((b) => ({ value: b, label: humanize(b) }))} />
          <TextInput label="Contact email" type="email" value={o.contactEmail} onChange={(e) => setO({ ...o, contactEmail: e.target.value })} error={fe.contactEmail} required />
          <TextInput label="Contact phone" value={o.contactPhone} onChange={(e) => setO({ ...o, contactPhone: e.target.value })} error={fe.contactPhone} required />
        </div>
        <TextInput label="Registered address" value={o.address} onChange={(e) => setO({ ...o, address: e.target.value })} error={fe.address} required />
        <div className="grid grid-2">
          <TextInput label="Website" value={o.website} onChange={(e) => setO({ ...o, website: e.target.value })} error={fe.website} />
          <TextInput label="Expected verifications / month" inputMode="numeric" value={o.expectedMonthlyVolume} onChange={(e) => setO({ ...o, expectedMonthlyVolume: e.target.value.replace(/\D/g, '') })} />
        </div>
        <TextArea label="Verification requirements" value={o.verificationRequirements} onChange={(e) => setO({ ...o, verificationRequirements: e.target.value })} hint="e.g. KYC tier upgrades, loan origination, presence required" />
        <h3>Authorised representative (becomes the Owner)</h3>
        <div className="grid grid-2">
          <TextInput label="Full name" value={r.fullName} onChange={(e) => setR({ ...r, fullName: e.target.value })} error={fe['representative.fullName']} required />
          <TextInput label="Job title" value={r.jobTitle} onChange={(e) => setR({ ...r, jobTitle: e.target.value })} error={fe['representative.jobTitle']} required />
          <TextInput label="Work email" type="email" value={r.email} onChange={(e) => setR({ ...r, email: e.target.value })} error={fe['representative.email']} required />
          <TextInput label="Phone" value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} error={fe['representative.phone']} required />
        </div>
        <TextInput label="Password" type="password" autoComplete="new-password" value={r.password} onChange={(e) => setR({ ...r, password: e.target.value })} error={fe['representative.password']} hint="10+ characters, upper & lower case and a number." required />
        <Button type="submit" block size="lg" loading={reg.pending}>Submit for approval</Button>
      </form>
    </AuthLayout>
  );
}
