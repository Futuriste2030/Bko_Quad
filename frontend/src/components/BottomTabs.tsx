import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Accueil' },
  { to: '/calendrier', label: 'Calendrier' },
  { to: '/reservations', label: 'Réservations' },
  { to: '/appels', label: 'Appels' },
  { to: '/plus', label: 'Plus' },
];

export default function BottomTabs() {
  return (
    <nav className="tabs" aria-label="Navigation principale">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
