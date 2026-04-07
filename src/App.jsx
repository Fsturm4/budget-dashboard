import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Nav from './components/Nav.jsx'
import Overview from './pages/Overview.jsx'
import MonthlyTracker from './pages/MonthlyTracker.jsx'
import Budget2026 from './pages/Budget2026.jsx'
import Actuals2025 from './pages/Actuals2025.jsx'
import EmployeeAnalysis from './pages/EmployeeAnalysis.jsx'
import Upload from './pages/Upload.jsx'
import AuditLog from './pages/AuditLog.jsx'
import Correction from './pages/Correction.jsx'
import Settings from './pages/Settings.jsx'
import Help from './pages/Help.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <main className="main-content">
        <Routes>
          <Route path="/"             element={<Overview />} />
          <Route path="/tracker"      element={<MonthlyTracker />} />
          <Route path="/budget"       element={<Budget2026 />} />
          <Route path="/actuals-2025" element={<Actuals2025 />} />
          <Route path="/employees"    element={<EmployeeAnalysis />} />
          <Route path="/upload"       element={<Upload />} />
          <Route path="/audit"        element={<AuditLog />} />
          <Route path="/correction"   element={<Correction />} />
          <Route path="/settings"     element={<Settings />} />
          <Route path="/help"         element={<Help />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
