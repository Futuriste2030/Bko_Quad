import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listBookings, listSlots } from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';
const ACTIVE = ['pending_deposit', 'confirmed', 'checked_in'];
export default function Calendar() {
    const [slots, setSlots] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [error, setError] = useState('');
    useEffect(() => {
        Promise.all([listSlots(), listBookings()])
            .then(([s, b]) => { setSlots(s); setBookings(b); })
            .catch((e) => setError(e.message));
    }, []);
    const used = useMemo(() => {
        const m = new Map();
        for (const b of bookings) {
            if (!ACTIVE.includes(b.status))
                continue;
            m.set(b.slot, (m.get(b.slot) ?? 0) + b.persons);
        }
        return m;
    }, [bookings]);
    return (_jsxs("div", { className: "main", children: [error && _jsx("div", { className: "alert-error", role: "alert", children: error }), slots.map((s) => {
                const left = s.capacity - (used.get(s.id) ?? 0);
                const full = s.closed || left <= 0;
                return (_jsxs("article", { className: "card", children: [_jsx("div", { className: "num", children: fmtSlot(s.start) }), _jsxs("div", { children: ["Places restantes : ", _jsx("strong", { className: "num", children: Math.max(0, left) })] }), full ? (_jsx("p", { children: "Ce cr\u00E9neau est complet, choisissez-en un autre." })) : (_jsx(Link, { to: `/reservations/nouvelle?slot=${s.id}`, children: _jsx("button", { className: "btn btn-primary", children: "Choisir le cr\u00E9neau" }) }))] }, s.id));
            }), slots.length === 0 && !error && _jsx("div", { className: "card", children: _jsx("p", { children: "Aucun cr\u00E9neau publi\u00E9 pour le moment." }) }), _jsxs("p", { className: "num", children: ["Montants en ", fcfa(0).replace('0', '').trim() || 'FCFA', " \u2014 prix calcul\u00E9s \u00E0 l\u2019\u00E9tape suivante."] })] }));
}
