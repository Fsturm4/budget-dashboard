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

**After the reconcile migration:**
- Four new empty tables (`actuals_replacements`, `_months`, `_lines`, `_mappings`); every existing table has the same row counts.
- `uploads.source` also accepts `'reconciliation'`.
- `anon` is denied on the new tables and functions; the signed-in owner can read the tables but change them only through `replace_company_actuals` and `restore_actuals_replacement`.
- Run `tests/reconcile_replace_test.sql` on the local copy first. Do not run it against production (it rolls back, but uses made-up months).

## Reconciling a corrected QuickBooks report

Reconcile (top navigation) replaces one company's stored figures for existing months with a corrected QuickBooks P&L:
1. Choose the company. Export one whole-month P&L per month from QuickBooks (.xlsx, the same file the Upload page takes) and add them all at once. A report covering several months, or part of a month, is rejected: the importer reads one column, so months cannot be split without estimating.
2. Decide every account listed under "Accounts that need your decision": map it to a category (saved as a mapping for that company) or hold it in Pending Review. Nothing is guessed, and nothing is saved yet.
3. Review each month's differences, the effect on totals and margins (company and combined), and any highlighted net income change or earlier correction. Tick each review box, enter a reason, and confirm.
4. The database recomputes the figures, checks them against QuickBooks' Net Income and against the stored month, and replaces all months or none. Old rows stay as `superseded`.
5. To undo, open Replacement history, choose Restore previous version, and give a reason. Restoring is refused if a later change touched the same months; restore or review that first.

## Testing database functions the way the API runs them

The dashboard calls the database through PostgREST, whose connections load the `pg-safeupdate` extension: a `DELETE` or `UPDATE` without a `WHERE` clause fails with "DELETE requires a WHERE clause", even inside a `security definer` function. A test run as a superuser does not show this. Run the SQL tests with the extension loaded:

```
PGOPTIONS='-c session_preload_libraries=safeupdate' psql -d <test db> -f supabase/tests/reconcile_replace_test.sql
```

In functions, empty a temporary table with `truncate`, not a bare `delete`. Migration `20261107000000_reconcile_safeupdate_fix.sql` does this for `replace_company_actuals`.

## Migration versions: repository filename vs Supabase history

Supabase records a migration under the timestamp at which it was applied, not the timestamp in the filename. The reconcile migration is `20261106000000_reconcile_replace_actuals.sql` in GitHub but was recorded in production as version `20261106232421` (`reconcile_replace_actuals`). The SQL is identical apart from the removed `begin;`/`commit;`, which the apply tool supplies itself.

Before the next migration:
1. Compare `select version, name from supabase_migrations.schema_migrations order by version` with `supabase/migrations/`. Match by **name**, not version.
2. Never re-run a migration already recorded by name; fix forward with a new file, as the safe-update fix does. The original file is not edited.
3. If the Supabase CLI (`supabase db push`) is ever used, first make the history agree, either by renaming the repository files to the recorded versions or by `supabase migration repair`. Otherwise the CLI sees the old filename as unapplied and tries to run it again, which fails because the tables already exist.
4. Record the version the tool assigned in the PR that applies each migration.

## Rollback

- **Pending Review:** `rollback/20261103000000_pending_review_down.sql` restores the original structure. It refuses once any account has been imported as Pending Review, because rolling back would discard records; from then, fix forward.
- **Access control:** `rollback/20261104000000_dashboard_access_control_down.sql` restores the previous open access immediately, without touching financial data. Then fix and re-apply.
- **Intercompany:** `rollback/20261105000000_intercompany_reconciliation_down.sql` removes it while no transfer or reviewed month exists. After that, void a transfer to reverse both its eliminations together; June's restoring corrections can be reversed with the correction workflow.
- **Reconcile:** `rollback/20261106000000_reconcile_replace_actuals_down.sql` removes it while no replacement exists. After that, restore replacements from the Reconcile page instead (history is never deleted).
- **Frontend:** redeploy the previous build from Netlify's Deploys page, or revert the merge on GitHub.

## Adding a person later

Create their Auth account, then insert their user ID into `dashboard_users`. That is a database change, so it needs approval.
