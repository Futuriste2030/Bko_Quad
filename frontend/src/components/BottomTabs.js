import { jsx as _jsx } from "react/jsx-runtime";
import { NavLink } from 'react-router-dom';
const TABS = [
    { to: '/', label: 'Accueil' },
    { to: '/calendrier', label: 'Calendrier' },
    { to: '/reservations', label: 'Réservations' },
    { to: '/appels', label: 'Appels' },
    { to: '/plus', label: 'Plus' },
];
export default function BottomTabs() {
    return (_jsx("nav", { className: "tabs", "aria-label": "Navigation principale", children: TABS.map((t) => (_jsx(NavLink, { to: t.to, end: t.to === '/', className: ({ isActive }) => (isActive ? 'active' : ''), children: t.label }, t.to))) }));
}
