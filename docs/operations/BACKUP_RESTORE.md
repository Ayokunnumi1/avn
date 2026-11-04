# Backup & restore

What to protect: the PostgreSQL database (all records, ledger, audit) and private file storage (`STORAGE_LOCAL_DIR`: evidence, documents, reports).

Backups

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > avn-$(date +%F).dump
tar czf avn-files-$(date +%F).tgz -C "$STORAGE_LOCAL_DIR" .
```

Run daily (Railway scheduled job or managed Postgres PITR), keep 30 days, store encrypted off-site.

Restore (into an empty database)

```bash
createdb avn_restore
psql avn_restore -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
pg_restore --no-owner --dbname=avn_restore avn-YYYY-MM-DD.dump
tar xzf avn-files-YYYY-MM-DD.tgz -C "$STORAGE_LOCAL_DIR"
```

Then point `DATABASE_URL` at the restored DB, run `prisma migrate deploy` (no-op if current) and verify: report authenticity checks pass (`/api/v1/reports/verify/:ref`), wallet balances equal the ledger (`Run reconciliation` in Admin → Finance).

Drill quarterly and record the result. Note: the ledger trigger blocks row deletes but not `TRUNCATE`; restrict database credentials accordingly.
