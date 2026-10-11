import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createBooking } from '../lib/api';
export default function NewBooking() {
    const [customer, setCustomer] = useState('');
    const [slot, setSlot] = useState('');
    const [persons, setPersons] = useState('2');
    const [error, setError] = useState('');
    const [ok, setOk] = useState('');
    async function submit() {
        setError('');
        setOk('');
        try {
            const b = await createBooking({
                customer: Number(customer), slot: Number(slot), persons: Number(persons), source: 'phone',
            });
            setOk(`Réservation ${b.code} enregistrée, en attente d’acompte.`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
        }
    }
    return (_jsxs("div", { className: "main", children: [error && _jsx("div", { className: "alert-error", role: "alert", children: error }), ok && _jsx("div", { className: "card", role: "status", children: ok }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "customer", children: "Client (obligatoire)" }), _jsx("input", { id: "customer", inputMode: "numeric", value: customer, onChange: (e) => setCustomer(e.target.value), placeholder: "N\u00B0 client" })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "slot", children: "Cr\u00E9neau (obligatoire)" }), _jsx("input", { id: "slot", inputMode: "numeric", value: slot, onChange: (e) => setSlot(e.target.value), placeholder: "N\u00B0 cr\u00E9neau" })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "persons", children: "Personnes (obligatoire)" }), _jsx("input", { id: "persons", inputMode: "numeric", value: persons, onChange: (e) => setPersons(e.target.value) })] }), _jsx("button", { className: "btn btn-primary", onClick: submit, children: "Enregistrer la r\u00E9servation" })] }));
}
