import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import StatusBadge from '../components/StatusBadge';
import { listBookings } from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';
export default function Reservations() {
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    useEffect(() => {
        listBookings().then(setItems).catch((e) => setError(e.message));
    }, []);
    return (_jsxs("div", { className: "main", children: [error && _jsx("div", { className: "alert-error", role: "alert", children: error }), items.length === 0 && !error && (_jsx("div", { className: "card", children: _jsx("p", { children: "Aucune r\u00E9servation. Touchez \u00AB Nouvelle r\u00E9servation \u00BB pour commencer." }) })), items.map((b) => (_jsxs("article", { className: "card", children: [_jsxs("div", { className: "num", children: [fmtSlot(b.expires_at), " \u2014 ", b.code] }), _jsx("div", { children: _jsx(StatusBadge, { status: b.status }) }), _jsxs("div", { className: "num", children: ["Reste d\u00FB : ", fcfa(b.total - b.deposit_due)] })] }, b.id)))] }));
}
