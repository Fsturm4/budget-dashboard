// Employee Analysis — version 1 placeholder.
// This page is present in navigation per the v1 plan but contains no
// functional hire modeling. It becomes active when a hire is being
// actively considered. No backend work, data structures, or scenario
// logic are implemented here. The workbook's Employee Analysis tab
// (assumptions-driven quick scenarios) serves as the reference model
// for a future implementation.

export default function EmployeeAnalysis() {
  return (
    <div className="page employee-page">
      <div className="employee-placeholder">
        <p className="employee-placeholder-icon">👤</p>
        <h1>Employee Analysis</h1>
        <p className="employee-placeholder-status">Not active in version 1</p>
        <p className="employee-placeholder-desc">
          This page will model the cost and net income impact of a potential
          part-time hire when one is actively being considered. It is present
          in navigation now and will be built out at that point.
        </p>
        <p className="employee-placeholder-ref">
          For now, use the Employee Analysis tab in the Excel workbook for
          quick hire cost scenarios based on the 2026 assumptions.
        </p>
      </div>
    </div>
  )
}
