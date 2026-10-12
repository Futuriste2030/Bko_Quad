import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { ConfirmDialog, PageHeader } from '../components/ui';
import { ROLE_LABELS, useAuth } from '../lib/auth';
import Icon from '../lib/icons';
export default function Profile() {
    const { user, role, logout } = useAuth();
    const nav = useNavigate();
    const [confirm, setConfirm] = useState(false);
    function doLogout() {
        logout();
        nav('/connexion');
    }
    return (_jsxs(AppShell, { children: [_jsx(PageHeader, { title: "Profil", sub: "Votre compte agent sur le Hub. Les droits suivent votre r\u00F4le, v\u00E9rifi\u00E9 par le serveur." }), _jsxs("section", { className: "card", children: [_jsxs("div", { style: { display: 'flex', gap: 14, alignItems: 'center' }, children: [_jsx("span", { className: "avatar", style: { width: 56, height: 56, fontSize: 'var(--text-xl)' }, "aria-hidden": "true", children: (user?.username ?? 'B').slice(0, 2).toUpperCase() }), _jsxs("div", { children: [_jsx("h2", { style: { margin: 0 }, children: user?.username ?? '—' }), _jsxs("p", { style: { margin: 0 }, children: [role ? ROLE_LABELS[role] : 'Rôle inconnu', " \u00B7 ", user?.phone ?? '—'] })] })] }), _jsx("hr", { className: "divider" }), _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "leader", children: [_jsx("span", { className: "muted", children: "Double authentification (TOTP)" }), _jsx("span", { className: "dots", "aria-hidden": "true" }), _jsx("strong", { children: user?.totp_enabled ? 'Activée' : 'Prévue avant le pilote' })] }), _jsxs("div", { className: "leader", children: [_jsx("span", { className: "muted", children: "Fuseau d\u2019affichage" }), _jsx("span", { className: "dots", "aria-hidden": "true" }), _jsx("strong", { children: "Africa/Bamako" })] })] })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Session" }), _jsx("p", { children: "Fermez la session sur un t\u00E9l\u00E9phone partag\u00E9 \u00E0 chaque fin de service." }), _jsx("div", { className: "btn-row", children: _jsxs("button", { type: "button", className: "btn", onClick: () => setConfirm(true), children: [_jsx(Icon, { name: "logout", size: 18 }), "Se d\u00E9connecter"] }) })] }), confirm && (_jsx(ConfirmDialog, { title: "Se d\u00E9connecter ?", text: "Vous devrez saisir \u00E0 nouveau votre identifiant et votre mot de passe.", confirmLabel: "Se d\u00E9connecter", danger: true, onConfirm: doLogout, onClose: () => setConfirm(false) }))] }));
}
