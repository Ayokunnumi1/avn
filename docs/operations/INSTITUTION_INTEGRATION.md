# Institution integration guide

1. **Register** in the Business app and wait for platform approval. Top up the wallet (Billing).
2. **Policies** — configure presence/residency requirements, required evidence, review threshold, freshness and deadlines. Versions are immutable once used.
3. **Team** — invite staff with least-privilege roles (Officer, Supervisor, Finance, Auditor…). Enable MFA.
4. **Create requests** from the dashboard, by **CSV** (Bulk upload, template provided, validation + error report), or by **API**:

```bash
curl -X POST https://api.example.com/api/v1/integrations/verifications \
  -H "Authorization: Bearer $AVN_KEY" -H "Idempotency-Key: loan-778812" -H "Content-Type: application/json" \
  -d '{"applicantName":"Ada Obi","applicantPhone":"08031234567","customerReference":"LOAN-778812","level":"STANDARD","purpose":"LOAN"}'
# → 201 { id, reference, status: "AWAITING_APPLICANT", invitationUrl }

curl https://api.example.com/api/v1/integrations/verifications/AVN-XXXXXXXX -H "Authorization: Bearer $AVN_KEY"
curl -o report.pdf https://api.example.com/api/v1/integrations/verifications/<id>/report.pdf -H "Authorization: Bearer $AVN_KEY"
```

5. **Webhooks** (API & webhooks page) — subscribe to `verification.completed` and `report.issued`; verify signatures:

```js
const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
const ok = crypto.timingSafeEqual(Buffer.from(v1, 'hex'), crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest());
```

6. **Reading reports** — treat each finding separately. *Partially verified* commonly means building and address are confirmed but residency was not (e.g. applicant absent). Disputes and "Request additional verification" are available on every completed request.
