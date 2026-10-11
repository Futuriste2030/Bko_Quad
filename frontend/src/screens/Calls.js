import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAnomalies, listCalls, reconcileCall, resolveAnomaly } from '../lib/api';
import { fmtPhone, fmtSlot } from '../lib/format';
const REASONS = [
    { v: 'renseignement', label: 'Renseignement' },
    { v: 'annulation', label: 'Annulation' },
    { v: 'faux_numero', label: 'Faux numéro' },
    { v: 'autre', label: 'Autre' },
];
export default function Calls() {
    const [calls, setCalls] = useState([]);
    const [anomByCall, setAnomByCall] = useState({});
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [reason, setReason] = useState('renseignement');
    useEffect(() => {
        Promise.all([listCalls(), listAnomalies()])
            .then(([c, a]) => {
            setCalls(c);
            const m = {};
            for (const an of a)
                if (an.status === 'open')
                    m[an.call] = an.id;
            setAnomByCall(m);
        })
            .catch((e) => setError(e.message));
    }, []);
    async function reconcile(id) {
        setError('');
        setInfo('');
        try {
            const r = await reconcileCall(id);
            if (r.booking)
                setInfo(`Appel rapproché : réservation ${r.booking.code}.`);
            else {
                if (r.anomaly)
                    setAnomByCall((m) => ({ ...m, [id]: r.anomaly.id }));
                setInfo('Aucune réservation trouvée : anomalie créée, motif requis.');
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Rapprochement impossible.');
        }
    }
    async function resolve(callId) {
        setError('');
        setInfo('');
        const anomalyId = anomByCall[callId];
        if (!anomalyId) {
            setError('Rapprochez d’abord l’appel pour créer l’anomalie.');
            return;
        }
        try {
            await resolveAnomaly(anomalyId, reason);
            setAnomByCall((m) => { const n = { ...m }; delete n[callId]; return n; });
            setInfo('Anomalie justifiée.');
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Clôture impossible.');
        }
    }
    return (_jsxs("div", { className: "main", children: [error && _jsx("div", { className: "alert-error", role: "alert", children: error }), info && _jsx("div", { className: "card", role: "status", children: info }), calls.map((c) => (_jsxs("article", { className: "card", children: [_jsx("div", { className: "num", children: fmtPhone(c.phone_number) }), _jsxs("div", { className: "num", children: [fmtSlot(c.started_at), " \u2014 ", c.duration_seconds, "s"] }), _jsxs("div", { style: { display: 'grid', gap: 8, marginTop: 8 }, children: [_jsx("button", { className: "btn", onClick: () => reconcile(c.id), children: "Rapprocher" }), _jsx(Link, { to: `/reservations/nouvelle?phone=${encodeURIComponent(c.phone_number)}`, children: _jsx("button", { className: "btn btn-accent", children: "Nouvelle r\u00E9servation" }) }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: `reason-${c.id}`, children: "Motif (obligatoire pour clore)" }), _jsx("select", { id: `reason-${c.id}`, value: reason, onChange: (e) => setReason(e.target.value), children: REASONS.map((r) => _jsx("option", { value: r.v, children: r.label }, r.v)) })] }), _jsx("button", { className: "btn", onClick: () => resolve(c.id), children: "Justifier l\u2019appel" })] })] }, c.id))), calls.length === 0 && !error && _jsx("div", { className: "card", children: _jsx("p", { children: "Aucun appel \u00E0 traiter." }) })] }));
}
