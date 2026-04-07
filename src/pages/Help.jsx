export default function Help() {
  return (
    <div className="page help-page">
      <h1>Help</h1>

      {/* ── Upload Workflow ──────────────────────────────────────────────── */}
      <section className="help-section">
        <h2>Monthly Upload Workflow</h2>
        <p>
          Each month, export both companies' P&amp;L from QuickBooks and upload them
          here together. Both files must be present before any data is written.
        </p>
        <ol className="help-steps">
          <li>
            <strong>Check Supabase.</strong> On the free tier, the project pauses
            after 7 days of inactivity. Open your Supabase dashboard and restore
            the project if it shows as paused. This takes about 60 seconds.
          </li>
          <li>
            <strong>Open the Upload page</strong> from the navigation.
          </li>
          <li>
            <strong>Select the month</strong> you are closing. The dashboard
            immediately checks whether either company already has actuals for that
            month. If so, the upload is blocked — use the correction workflow
            instead.
          </li>
          <li>
            <strong>Drop both P&amp;L files</strong> — one for Turf Pro and one for
            GreenAce — into their respective drop zones. Each file is validated against
            its drop zone: if you drop the wrong company's file, or a file from the
            wrong month, you will see a specific error before any processing begins.
          </li>
          <li>
            <strong>Review the preview.</strong> Once both files are valid and all
            QuickBooks labels are mapped, a combined preview table appears showing
            every category and amount for both companies. Nothing has been saved yet.
          </li>
          <li>
            <strong>Confirm.</strong> Click "Confirm and save both companies." All
            actuals for both companies are written in a single atomic transaction.
            If anything fails, nothing is written.
          </li>
          <li>
            <strong>Check the Overview page</strong> to verify the numbers look correct.
          </li>
          <li>
            <strong>Export and save.</strong> Go to Settings → Export and download the
            actuals, upload log, budget, and assumptions. Save these files and both
            original QuickBooks P&amp;L exports to Google Drive in a folder named for
            the month (e.g., Budget Dashboard — March 2026). This is your recovery
            record if the Supabase database ever needs to be rebuilt.
          </li>
        </ol>
        <div className="help-callout">
          <strong>Unmapped labels.</strong> If a QuickBooks line item has no mapping
          rule, the upload is blocked and the specific unmapped labels are listed on
          screen. No actuals are written. Go to Settings → Mappings, add a rule for
          each label, then return to Upload and re-upload both files for that month.
          The raw line items from the failed attempt are preserved in the Audit Log.
        </div>
      </section>

      {/* ── Correction Process ───────────────────────────────────────────── */}
      <section className="help-section">
        <h2>Correction Process</h2>
        <p>
          If an uploaded figure was incorrect, use the correction workflow to fix it.
          Corrections do not overwrite the original data — the original actuals row
          is preserved with status "superseded" and a new row is written with the
          corrected amount. Both are visible in the Audit Log.
        </p>
        <ol className="help-steps">
          <li>
            <strong>Open the Audit Log</strong> from the navigation.
          </li>
          <li>
            <strong>Find the successful upload</strong> for the month you need to
            correct and click "Correct this month →."
          </li>
          <li>
            <strong>Select the category</strong> that needs correction. The current
            active actual for that company, month, and category is shown automatically.
          </li>
          <li>
            <strong>Enter the corrected amount</strong> and a written reason explaining
            what was wrong and why the new amount is correct. The reason field is
            required.
          </li>
          <li>
            <strong>Review the preview</strong> showing the original and corrected
            amounts side by side, then confirm.
          </li>
        </ol>
        <div className="help-callout">
          <strong>What gets preserved.</strong> The original actuals row is never
          deleted. It remains in the database with status "superseded." The Audit
          Log shows the correction event with its reason. If a correction itself
          was wrong, you can run a further correction on the same category.
        </div>
      </section>

      {/* ── Color Coding ─────────────────────────────────────────────────── */}
      <section className="help-section">
        <h2>Color Coding</h2>
        <p>
          Variance colors on the KPI cards and Monthly Tracker compare actual
          figures to budget using a 3% tolerance threshold.
        </p>
        <div className="help-color-table">
          <div className="help-color-row">
            <span className="help-color-swatch help-color-swatch--green" />
            <div>
              <strong>Green — favorable.</strong> The actual differs from budget
              by more than 3% in the favorable direction. For revenue and income
              rows, this means actual exceeded budget. For cost and expense rows,
              this means actual came in below budget.
            </div>
          </div>
          <div className="help-color-row">
            <span className="help-color-swatch help-color-swatch--neutral" />
            <div>
              <strong>Gray — within tolerance.</strong> The actual is within 3%
              of budget in either direction. No action indicated.
            </div>
          </div>
          <div className="help-color-row">
            <span className="help-color-swatch help-color-swatch--red" />
            <div>
              <strong>Red — unfavorable.</strong> The actual differs from budget
              by more than 3% in the unfavorable direction. For revenue rows,
              this means actual fell short of budget. For expense rows, this means
              actual exceeded budget.
            </div>
          </div>
        </div>
        <p className="help-note">
          The 3% threshold was chosen to match the recurring service agreement
          business model, where monthly figures are predictable and small variances
          are meaningful. Rows where budget is $0 (such as Owner Wages in January
          through April) show no color coding regardless of the actual amount.
        </p>
        <p className="help-note">
          In per-company view on the Monthly Tracker, color coding applies only to
          revenue rows, which have company-specific budget figures. Expense rows
          in per-company view show actual amounts without a budget comparison because
          the expense budgets are combined-only.
        </p>
      </section>

    </div>
  )
}
