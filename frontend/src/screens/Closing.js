import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { listAnomalies, todayISO, validateClosing } from '../lib/api';
import { fcfa } from '../lib/format';
export default function Closing() {
    const [closing, setClosing] = useState(null);
    const [open, setOpen] = useState([]);
    const [error, setError] = useState('');
    useEffect(() => {
        listAnomalies().then((a) => setOpen(a.filter((x) => x.status === 'open')))
            .catch((e) => setError(e.message));
    }, []);
    async function submit() {
        setError('');
        try {
            setClosing(await validateClosing(todayISO()));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Clôture impossible.');
        }
    }
    return (_jsxs("div", { className: "main", children: [error && _jsx("div", { className: "alert-error", role: "alert", children: error }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Cl\u00F4ture du jour" }), _jsxs("p", { children: ["Anomalies ouvertes : ", _jsx("strong", { className: "num", children: open.length })] }), closing && (_jsxs("div", { className: "num", children: ["R\u00E9servations : ", closing.bookings_count, " \u2014 Encaiss\u00E9 : ", fcfa(closing.amount_collected), " \u2014 Appels : ", closing.calls_count, " \u2014 Anomalies : ", closing.anomalies_open] })), _jsx("button", { className: "btn btn-primary", onClick: submit, children: "Valider la journ\u00E9e" })] })] }));
}
