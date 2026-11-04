import { ContentPage } from '@/components/marketing';

export const metadata = { title: 'Terms of service' };
export default function Page() {
  return (
    <ContentPage
      title="Terms of service"
      intro="The rules for using AVN. This MVP text is a plain-language summary for pilot use."
      sections={[
        { h: 'The service', p: 'AVN arranges a physical visit and reports what an approved verifier observed. A report is evidence of observations at a point in time, not a guarantee of identity or title.' },
        { h: 'Your responsibilities', p: 'Provide accurate information, authorise only visits to addresses you are entitled to, and do not misuse reports.' },
        { h: 'Payments and refunds', p: 'Individual purchases are paid before dispatch. Institutional requests are charged on creation and refunded if cancelled before field work begins.' },
        { h: 'Verifiers', p: 'Verifiers are independent, identity-approved agents who must follow the field code: no entry into private property, camera-only evidence, honest observations.' },
        { h: 'Disputes', p: 'You may dispute a report. Upheld disputes trigger re-review at no cost.' },
      ]}
    />
  );
}
