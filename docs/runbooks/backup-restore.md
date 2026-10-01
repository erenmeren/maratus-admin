# Backup & Restore Runbook

_Owner: platform team · Last reviewed: 2026-06-01_

Maratus's durable state lives in two places:

| Store | Holds | Backup mechanism |
|---|---|---|
| **Neon Postgres** | All tenant data: orgs, users, stores, devices, receipts (metadata), invoices | Point-in-time restore (PITR) |
| **Cloudflare R2** | Receipt **images** (`receipts/{orgId}/{receiptId}`) | Object versioning + lifecycle |

A receipt row in Postgres references an R2 object by `storageKey`. A consistent
restore must consider both — restoring the DB to a point before an image was
uploaded leaves a row pointing at a missing object (handled gracefully by the
public receipt page, but still a data gap).

## Targets

| Metric | Target |
|---|---|
| **RPO** (max acceptable data loss) | ≤ 5 minutes |
| **RTO** (max acceptable downtime to restore) | ≤ 1 hour |

> These are proposed defaults. Confirm against the customer SLA before treating
> them as committed.

## Prerequisites (verify these are enabled — DO before relying on this runbook)

- [ ] **Neon PITR retention** is set to at least 7 days (Neon Console → Project →
      Settings → History retention). Default on free tier is short — confirm the
      plan covers the retention you need.
- [ ] **R2 object versioning** is enabled on the receipts bucket (Cloudflare
      Dashboard → R2 → bucket → Settings). Without it, an overwritten or deleted
      receipt image is unrecoverable.
- [ ] **R2 lifecycle policy** does not delete current versions prematurely.

## Restore: Postgres (Neon PITR)

1. Identify the target timestamp (just before the incident).
2. Neon Console → Project → **Restore** → "Restore to a point in time".
3. Neon creates a branch at that timestamp. **Restore into a new branch first**,
   never overwrite production blind.
4. Inspect the restored branch (row counts, latest receipts) via `npm run db:studio`
   pointed at the branch connection string.
5. When verified, promote the branch to the primary / repoint `DATABASE_URL` and
   redeploy.

## Restore: R2 images

1. For a specific lost object: R2 → bucket → object → **Versions** → restore the
   prior version.
2. For bulk loss: use the Cloudflare API / `rclone` against the versioned bucket
   to copy the last-good versions back.

## Restore drill (REQUIRED — a runbook is not "done" until tested once)

- [ ] Restore the Neon DB into a throwaway branch and confirm row counts match a
      known-good snapshot.
- [ ] Restore one R2 object from a prior version.
- [ ] Record the actual time taken and compare against the RTO target above.
- [ ] Note the date of the last successful drill here: **_not yet run_**

## What is NOT backed up (and is fine)

- R2 **presigned URLs** — generated fresh on demand (5-min TTL), nothing to back up.
- Sessions — users simply re-authenticate after a restore.
- Anything in `.env.local` — secrets live in the deploy platform's env store and
  the team password manager, not in backups.
