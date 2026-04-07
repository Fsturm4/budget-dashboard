import { NavLink } from 'react-router-dom'

const PRIMARY_LINKS = [
  { to: '/',             label: 'Overview',          end: true  },
  { to: '/tracker',      label: 'Monthly Tracker',   end: false },
  { to: '/budget',       label: '2026 Budget',       end: false },
  { to: '/actuals-2025', label: '2025 Actuals',      end: false },
  { to: '/employees',    label: 'Employee Analysis', end: false },
]

const SECONDARY_LINKS = [
  { to: '/upload', label: 'Upload',    end: false },
  { to: '/audit',  label: 'Audit Log', end: false },
]

function navClass({ isActive }) {
  return isActive ? 'nav-link active' : 'nav-link'
}

function iconClass({ isActive }) {
  return isActive ? 'nav-icon-link active' : 'nav-icon-link'
}

export default function Nav() {
  return (
    <nav className="nav">
      <div className="nav-primary">
        {PRIMARY_LINKS.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={navClass}>
            {label}
          </NavLink>
        ))}
      </div>
      <div className="nav-right">
        {SECONDARY_LINKS.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={navClass}>
            {label}
          </NavLink>
        ))}
        <NavLink to="/settings" title="Settings" className={iconClass}>⚙</NavLink>
        <NavLink to="/help"     title="Help"     className={iconClass}>?</NavLink>
      </div>
    </nav>
  )
}
