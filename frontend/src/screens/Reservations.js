import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import { EmptyState, IconButton, PageHeader, SkeletonList } from '../components/ui';
import { useToast } from '../lib/toast';
import Icon from '../lib/icons';
import { cancelBooking, listBookings } from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';
const FILTERS = [
    { v: 'all', label: 'Toutes' },
    { v: 'pending_deposit', label: 'Attente acompte' },
    { v: 'confirmed', label: 'Confirmées' },
    { v: 'checked_in', label: 'Arrivées' },
    { v: 'completed', label: 'Terminées' },
    { v: 'cancelled', label: 'Annulées' },
];
export default function Reservations() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [q, setQ] = useState('');
    const [f, setF] = useState('all');
    const [toCancel, setToCancel] = useState(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const { notify } = useToast();
    function load() {
        setLoading(true);
        setError('');
        listBookings().then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false));
    }
    useEffect(load, []);
    const rows = useMemo(() => items.filter((b) => (f === 'all' || b.status === f) &&
        (!q.trim() || b.code.toLowerCase().includes(q.trim().toLowerCase()))), [items, f, q]);
    async function doCancel() {
        if (!toCancel)
            return;
        if (!reason.trim()) {
            notify('warning', 'Motif obligatoire', 'Précisez le motif d’annulation pour tracer.');
            return;
        }
        setBusy(true);
        try {
            await cancelBooking(toCancel.id, reason.trim());
            notify('success', 'Réservation annulée', `${toCancel.code} — motif tracé.`);
            setToCancel(null);
            setReason('');
            load();
        }
        catch (e) {
            notify('error', 'Annulation impossible', e instanceof Error ? e.message : '');
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs(AppShell, { children: [_jsx(PageHeader, { title: "R\u00E9servations", sub: "Cartes sur mobile, tableau d\u00E9taill\u00E9 sur ordinateur. Motif obligatoire pour toute annulation.", actions: _jsxs(Link, { to: "/reservations/nouvelle", className: "btn btn-accent", children: [_jsx(Icon, { name: "plus", size: 18 }), "Nouvelle r\u00E9servation"] }) }), _jsx("div", { className: "card", children: _jsxs("div", { className: "form-2", children: [_jsxs("div", { className: "search", children: [_jsx(Icon, { name: "search", size: 18 }), _jsx("input", { value: q, onChange: (e) => setQ(e.target.value), placeholder: "Rechercher un code (BKO-\u2026)", "aria-label": "Rechercher une r\u00E9servation" })] }), _jsx("div", { className: "segmented", role: "group", "aria-label": "Filtrer par statut", children: FILTERS.map((x) => (_jsx("button", { type: "button", className: "chip", "aria-pressed": f === x.v, onClick: () => setF(x.v), children: x.label }, x.v))) })] }) }), loading && _jsx(SkeletonList, { n: 4 }), error && _jsx("div", { className: "alert-error", role: "alert", children: error }), !loading && !error && rows.length === 0 && (_jsx(EmptyState, { icon: "ticket", title: "Aucune r\u00E9servation", text: "Touchez \u00AB Nouvelle r\u00E9servation \u00BB pour commencer.", action: _jsx(Link, { to: "/reservations/nouvelle", className: "btn btn-primary", children: "Nouvelle r\u00E9servation" }) })), !loading && !error && rows.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "list only-mobile", children: rows.map((b) => (_jsxs("article", { className: "row-card", children: [_jsxs("div", { className: "row-top", children: [_jsx("span", { className: "stub row-title num", children: b.code }), _jsx(StatusBadge, { status: b.status })] }), _jsxs("div", { className: "row-meta", children: [_jsx("span", { className: "num", children: fmtSlot(b.expires_at) }), _jsxs("span", { className: "num", children: [b.persons, " pers. \u00B7 ", b.quads, " quad", b.quads > 1 ? 's' : ''] })] }), _jsxs("div", { className: "row-top", children: [_jsx("strong", { className: "num", children: fcfa(b.total) }), _jsxs("span", { className: "small muted num", children: ["Reste d\u00FB : ", fcfa(Math.max(0, b.total - b.deposit_due))] }), b.status !== 'cancelled' && (_jsx(IconButton, { icon: "x", label: `Annuler ${b.code}`, className: "danger plain", onClick: () => setToCancel(b) }))] })] }, b.id))) }), _jsx("div", { className: "table-wrap only-desktop", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Code" }), _jsx("th", { children: "Cr\u00E9neau" }), _jsx("th", { children: "Personnes" }), _jsx("th", { children: "Total" }), _jsx("th", { children: "Reste d\u00FB" }), _jsx("th", { children: "Statut" }), _jsx("th", { children: "Actions" })] }) }), _jsx("tbody", { children: rows.map((b) => (_jsxs("tr", { children: [_jsx("td", { className: "num", children: _jsx("strong", { children: b.code }) }), _jsx("td", { className: "num", children: fmtSlot(b.expires_at) }), _jsxs("td", { className: "num", children: [b.persons, " \u00B7 ", b.quads, " quads"] }), _jsx("td", { className: "num", children: fcfa(b.total) }), _jsx("td", { className: "num", children: fcfa(Math.max(0, b.total - b.deposit_due)) }), _jsx("td", { children: _jsx(StatusBadge, { status: b.status }) }), _jsx("td", { children: b.status !== 'cancelled' && _jsx(IconButton, { icon: "x", label: `Annuler ${b.code}`, className: "danger plain", onClick: () => setToCancel(b) }) })] }, b.id))) })] }) })] })), toCancel && (_jsx("div", { className: "modal-backdrop", onClick: () => { if (!busy) {
                    setToCancel(null);
                    setReason('');
                } }, children: _jsxs("div", { className: "modal", role: "alertdialog", "aria-modal": "true", "aria-label": `Annuler ${toCancel.code}`, onClick: (e) => e.stopPropagation(), children: [_jsxs("h2", { children: ["Annuler ", toCancel.code, " ?"] }), _jsx("p", { children: "L\u2019annulation est trac\u00E9e (qui, quand, avant, apr\u00E8s). Un motif est obligatoire." }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "cancel-reason", children: "Motif d\u2019annulation (obligatoire)" }), _jsx("input", { id: "cancel-reason", value: reason, onChange: (e) => setReason(e.target.value), placeholder: "Ex. client indisponible, pluie, double saisie" })] }), _jsxs("div", { className: "modal-actions", children: [_jsx("button", { type: "button", className: "btn btn-ghost", onClick: () => { setToCancel(null); setReason(''); }, disabled: busy, children: "Revenir" }), _jsxs("button", { type: "button", className: "btn btn-danger", onClick: doCancel, disabled: busy, children: [busy && _jsx("span", { className: "caret", "aria-hidden": "true" }), "Confirmer l\u2019annulation"] })] })] }) }))] }));
}
