import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, useAuth } from '../lib/auth';
import Icon from '../lib/icons';
import { ThemeSwitch } from './ui';
export const NAV = [
    { to: '/', label: 'Accueil', icon: 'home', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable', 'client'] },
    { to: '/calendrier', label: 'Calendrier', icon: 'calendar', roles: ['agent', 'guide', 'responsable', 'admin'] },
    { to: '/reservations', label: 'Réservations', icon: 'ticket', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable'] },
    { to: '/appels', label: 'Appels', icon: 'phone', roles: ['agent', 'responsable', 'admin'] },
    { to: '/cloture', label: 'Clôture du jour', icon: 'close', roles: ['agent', 'responsable', 'admin', 'comptable'] },
    { to: '/caisse', label: 'Caisse', icon: 'wallet', roles: ['responsable', 'admin', 'comptable'] },
];
const MOBILE_TABS = [
    { to: '/', label: 'Accueil', icon: 'home', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable', 'client'] },
    { to: '/calendrier', label: 'Calendrier', icon: 'calendar', roles: ['agent', 'guide', 'responsable', 'admin'] },
    { to: '/reservations', label: 'Réservations', icon: 'ticket', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable'] },
    { to: '/appels', label: 'Appels', icon: 'phone', roles: ['agent', 'responsable', 'admin'] },
    { to: '/menu', label: 'Menu', icon: 'menu', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable', 'client'] },
];
function initials(name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? 'B') + (parts[1]?.[0] ?? 'Q')).toUpperCase();
}
export default function AppShell({ children, anomalies = 0 }) {
    const { user, role, logout } = useAuth();
    const nav = useNavigate();
    const loc = useLocation();
    const [menu, setMenu] = useState(false);
    const [offline, setOffline] = useState(!navigator.onLine);
    const menuRef = useRef(null);
    useEffect(() => {
        const on = () => setOffline(!navigator.onLine);
        window.addEventListener('online', on);
        window.addEventListener('offline', on);
        return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
    }, []);
    useEffect(() => { setMenu(false); }, [loc.pathname]);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape')
            setMenu(false); };
        const onClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target))
            setMenu(false); };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onClick);
        return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
    }, []);
    const visible = (items) => items.filter((i) => (role ? (i.roles.includes(role) || role === 'admin') : false));
    const name = user?.username ?? 'Utilisateur';
    const roleLabel = role ? ROLE_LABELS[role] : '';
    function doLogout() {
        logout();
        setMenu(false);
        nav('/connexion');
    }
    return (_jsxs("div", { className: "shell", children: [_jsxs("aside", { className: "sidebar", "aria-label": "Navigation principale", children: [_jsxs("div", { className: "side-brand", children: [_jsx("img", { src: "/android-chrome-192x192.png", alt: "BKO Quad" }), _jsxs("div", { children: [_jsx("strong", { children: "BKO QUAD" }), _jsx("small", { children: "Hub agence" })] })] }), _jsx("div", { className: "side-section", children: "Pilotage" }), visible(NAV).map((i) => (_jsxs(NavLink, { to: i.to, end: i.to === '/', className: ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link'), children: [_jsx(Icon, { name: i.icon, size: 20 }), i.label, i.to === '/appels' && anomalies > 0 && _jsx("span", { className: "count num", children: anomalies })] }, i.to))), _jsxs("div", { className: "side-foot", children: [_jsx("div", { className: "side-section", children: "Compte" }), _jsxs(NavLink, { to: "/profil", className: ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link'), children: [_jsx(Icon, { name: "user", size: 20 }), "Profil"] }), _jsxs(NavLink, { to: "/parametres", className: ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link'), children: [_jsx(Icon, { name: "settings", size: 20 }), "Param\u00E8tres"] }), _jsxs("span", { className: "role-chip", children: [_jsx("span", { className: "dot", "aria-hidden": "true" }), roleLabel] })] })] }), _jsxs("header", { className: "topbar", children: [_jsxs("div", { className: "brand", children: [_jsx("img", { src: "/android-chrome-192x192.png", alt: "", "aria-hidden": "true" }), _jsx("div", { children: _jsx("strong", { children: "BKO QUAD" }) })] }), _jsx("div", { className: "topbar-spacer" }), _jsxs("div", { className: "topbar-actions", children: [_jsx(ThemeSwitch, { compact: true }), _jsxs("div", { ref: menuRef, style: { position: 'relative' }, children: [_jsxs("button", { type: "button", className: "avatar-btn", onClick: () => setMenu((m) => !m), "aria-haspopup": "menu", "aria-expanded": menu, title: "Ouvrir le menu du compte", children: [_jsx("span", { className: "avatar", "aria-hidden": "true", children: initials(name) }), _jsx("span", { className: "small", style: { maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: name })] }), menu && (_jsxs("div", { className: "menu", role: "menu", style: { position: 'fixed' }, children: [_jsxs("div", { style: { padding: '8px 12px' }, children: [_jsx("strong", { children: name }), _jsx("div", { className: "small muted", children: roleLabel })] }), _jsx("hr", {}), _jsxs(Link, { to: "/profil", role: "menuitem", onClick: () => setMenu(false), children: [_jsx(Icon, { name: "user", size: 18 }), "Profil"] }), _jsxs(Link, { to: "/parametres", role: "menuitem", onClick: () => setMenu(false), children: [_jsx(Icon, { name: "settings", size: 18 }), "Param\u00E8tres"] }), _jsx("hr", {}), _jsxs("button", { type: "button", role: "menuitem", onClick: doLogout, children: [_jsx(Icon, { name: "logout", size: 18 }), "Se d\u00E9connecter"] })] }))] })] })] }), offline && _jsx("div", { className: "offline-bar", role: "status", children: "Hors ligne \u2014 vos saisies sont conserv\u00E9es" }), _jsx("div", { className: "shell-body", children: _jsx("main", { className: "content", children: children }) }), _jsx("nav", { className: "tabs", "aria-label": "Navigation principale", children: visible(MOBILE_TABS).map((t) => (_jsxs(NavLink, { to: t.to, end: t.to === '/', title: t.label, className: ({ isActive }) => (isActive ? 'active' : ''), children: [_jsx(Icon, { name: t.icon, size: 22 }), _jsx("span", { className: "lbl", children: t.label })] }, t.to))) })] }));
}
