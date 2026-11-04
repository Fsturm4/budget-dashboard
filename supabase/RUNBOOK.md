# Production deployment runbook

The Supabase project is on the free plan, which has no development branches, so every migration is tested first against a local Postgres 17.6 copy. That copy is built from `tests/baseline.sql` (production's schema and default privileges) plus a read-only snapshot of production data that is never stored in this repository. Each migration runs in a single transaction: it applies completely or not at all.

Nothing below runs without the owner's explicit approval of that step.

## Netlify previews

Pull-request previews use the same Supabase project as the live site, so anything done in a preview is real. Browsing is safe. An upload, correction or mapping change in a preview writes to production.

## Before any database step

1. **Snapshot (read-only).** Record:
   - row counts for every table
   - active actuals per company and month (rows and total cents)
   - every public function's definition and grants, default privileges and policies
   - a full data export saved outside the repo

   This is the comparison point for verification, and lets any function be restored exactly.
2. **Retest locally.** Rebuild the local copy from a fresh snapshot and rerun the migration and its tests.

## Order of operations

| # | Step | Who | Downtime / lockout risk |
|---|------|-----|-------------------------|
| 1 | Merge PR #1 (subtotal fix) | Claude, on approval | None (frontend only) |
| 2 | Upload September; add the two Turf Pro mappings and upload August when ready | Owner | None |
| 3 | Snapshot, then apply `migrations/20261103000000_pending_review.sql` | Claude, on approval | None: the current upload call still works |
| 4 | Merge PR #2 (Pending Review) | Claude, on approval | None |
| 5 | Create your Supabase Auth account (below) | Owner | None |
| 6 | Merge PR #3 (sign-in screen) | Claude, on approval | None: data is still open, so sign-in only adds a screen |
| 7 | Sign in on the live site; check every page | Owner | If sign-in fails, nothing else has changed yet |
| 8 | Snapshot, then apply `migrations/20261104000000_dashboard_access_control.sql`, with the owner's email filled in at apply time | Claude, on approval | Refuses to run unless that account exists |
| 9 | Verify (below); owner reloads and checks pages | Claude and owner | Rollback restores access at once |

Steps 3–4 and 5–9 are independent; either group can go first. Each migration detects the other and keeps the same rules.

**Intercompany reconciliation** (after steps 1–9, since it needs the access-control migration):

| # | Step | Who | Effect on figures |
|---|------|-----|-------------------|
| 10 | Snapshot, then apply `migrations/20261105000000_intercompany_reconciliation.sql` | Claude, on approval | None: new empty tables |
| 11 | Merge the intercompany PR | Claude, on approval | None until a transfer is recorded |
| 12 | Migrate June: two restoring corrections plus one transfer per check, in one transaction that aborts unless every month's combined total per category is unchanged. The script holds real figures, so it is kept outside this repository | Claude, on approval | Company views return to QuickBooks; combined unchanged |
| 13 | Record each month's transfers as months are imported | Owner or Claude, on approval | Combined revenue and COGS each fall by the transfer; profit unchanged |

## Creating your Supabase sign-in (step 5)

1. Open the Supabase dashboard and select the project.
2. Go to Authentication → Users.
3. Add a user with your email and a strong password, marked as confirmed (auto-confirm) so no email link is needed. Labels can differ slightly between Supabase versions.
4. Optional but recommended: in the Authentication settings, turn off new user sign-ups. The allowlist already gives any other account no data.

To reset a forgotten password, use the same Users page.

## Verification

**After the Pending Review migration:**
- Table counts are unchanged except `categories` (+4).
- Every company-month total is unchanged.
- `upload_monthly_actuals` accepts its two optional parameters.
- The security advisor shows nothing new.
- The owner opens Overview, Monthly Tracker and Audit Log.

**After the access-control migration:**
- `dashboard_users` lists exactly the owner.
- Inside a rolled-back transaction, the `anon` role is denied on every table and function.
- The security advisor no longer reports RLS or anonymous-access findings.
- The owner reloads the signed-in dashboard and checks Overview, Upload preview and Audit Log.

**After the intercompany migration:**
- Table counts are unchanged; three new empty tables.
- `anon` is denied on the new tables and functions; the signed-in owner can read the tables but write them only through the functions.
- The security advisor may list the four intercompany functions as callable by signed-in users. That is intended: each checks the allowlist first.

## Rollback

- **Pending Review:** `rollback/20261103000000_pending_review_down.sql` restores the original structure. It refuses once any account has been imported as Pending Review, because rolling back would discard records; from then, fix forward.
- **Access control:** `rollback/20261104000000_dashboard_access_control_down.sql` restores the previous open access immediately, without touching financial data. Then fix and re-apply.
- **Intercompany:** `rollback/20261105000000_intercompany_reconciliation_down.sql` removes it while no transfer or reviewed month exists. After that, void a transfer to reverse both its eliminations together; June's restoring corrections can be reversed with the correction workflow.
- **Frontend:** redeploy the previous build from Netlify's Deploys page, or revert the merge on GitHub.

## Adding a person later

Create their Auth account, then insert their user ID into `dashboard_users`. That is a database change, so it needs approval.
