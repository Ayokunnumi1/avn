# Administrator guide (Admin Panel, port 3003)

Roles: **Super admin** (everything), **Operations** (verifiers, institutions, users, assignments, geography), **Reviewer** (manual reviews, fraud, disputes, assignments), **Finance** (payments, payouts, pricing, refunds), **Support** (read-only overview/audit). Enable MFA under Security.

Daily routine

1. **Overview** — queues for verifier and institution approvals, pending reviews, high-risk signals.
2. **Verifiers** → open a pending verifier, check the ID document and selfie, approve or reject with a reason. Suspend for misconduct (removes availability and offers immediately).
3. **Institutions** → approve new organisations; set postpaid credit for trusted clients.
4. **Assignments / Live map** — find requests with "No coverage", restart the search, or manually assign an approved verifier (they must accept). Reassign stalled jobs.
5. **Manual reviews** — open the request, inspect findings, GPS map, evidence (hashes, duplicates, AI suggestions), add notes, then resolve with a final outcome, optional finding override, or request a re-visit.
6. **Fraud signals** — confirm fraud (affects verifier reliability) or mark false positive.
7. **Disputes** — uphold (reopens for review) or reject with a note.
8. **Finance** — approve/reject payouts and issue refunds (password confirmation), run reconciliation.
9. **Configuration** — arrival threshold, heartbeat expiry, walking tiers, offer expiry, rewards, pricing (all audited).
10. **AI** — enable features, choose models, set the monthly budget; AI is optional and advisory.
11. **Audit log** — every sensitive action, including login history.
