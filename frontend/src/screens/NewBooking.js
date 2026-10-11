import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import StatusBadge from '../components/StatusBadge';
import { clearDraft, createBooking, createCustomer, createPayLink, listBookings, listCustomers, listSlots, loadDraft, logMessage, saveDraft, } from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';
const ACTIVE = ['pending_deposit', 'confirmed', 'checked_in'];
export default function NewBooking() {
    const [params] = useSearchParams();
    const [step, setStep] = useState(1);
    const [phone, setPhone] = useState(params.get('phone') ?? '');
    const [name, setName] = useState('');
    const [customer, setCustomer] = useState(null);
    const [customers, setCustomers] = useState([]);
    const [slots, setSlots] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [slotId, setSlotId] = useState(() => {
        const s = params.get('slot');
        return s ? Number(s) : null;
    });
    const [persons, setPersons] = useState('2');
    const [quads, setQuads] = useState('1');
    const [source, setSource] = useState('phone');
    const [done, setDone] = useState(null);
    const [payRef, setPayRef] = useState('');
    const [waMe, setWaMe] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        Promise.all([listCustomers(), listSlots(), listBookings()])
            .then(([c, s, b]) => { setCustomers(c); setSlots(s); setBookings(b); })
            .catch((e) => setError(e.message));
        const d = loadDraft();
        if (d)
            setPhone(d);
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
    function pickCustomer() {
        setError('');
        const found = customers.find((c) => c.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
        if (found) {
            setCustomer(found);
            setStep(2);
            return;
        }
        if (!name.trim()) {
            setError('Client inconnu : saisissez son nom pour le créer.');
            return;
        }
        createCustomer({ name: name.trim(), phone: phone.trim() })
            .then((c) => { setCustomer(c); setStep(2); })
            .catch((e) => setError(e.message));
    }
    async function submit() {
        setError('');
        if (!customer || !slotId) {
            setError('Client et créneau requis.');
            return;
        }
        try {
            const b = await createBooking({
                customer: customer.id, slot: slotId,
                persons: Number(persons), quads: Number(quads), source,
            });
            setDone(b);
            clearDraft();
            try {
                const link = await createPayLink(b.id);
                setPayRef(link.reference);
                const text = `Bonjour, votre réservation ${b.code} est en attente d’acompte (${fcfa(b.deposit_due)}).`;
                const logged = await logMessage(b.id, text);
                setWaMe(logged.wa_me);
            }
            catch {
                // Lien/paiement indisponible : la réservation reste valide en attente.
            }
            setStep(4);
        }
        catch (e) {
            saveDraft(phone);
            setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
        }
    }
    return (_jsxs("div", { className: "main", children: [error && _jsx("div", { className: "alert-error", role: "alert", children: error }), step === 1 && (_jsxs("section", { className: "card", children: [_jsx("h2", { children: "1. Client" }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "phone", children: "T\u00E9l\u00E9phone (obligatoire)" }), _jsx("input", { id: "phone", type: "tel", inputMode: "tel", value: phone, onChange: (e) => setPhone(e.target.value), placeholder: "+223\u2026" })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "name", children: "Nom (si nouveau client)" }), _jsx("input", { id: "name", value: name, onChange: (e) => setName(e.target.value), placeholder: "Nom du client" })] }), _jsx("button", { className: "btn btn-primary", onClick: pickCustomer, children: "Continuer" })] })), step === 2 && (_jsxs("section", { className: "card", children: [_jsx("h2", { children: "2. Cr\u00E9neau" }), slots.map((s) => {
                        const left = s.capacity - (used.get(s.id) ?? 0);
                        const full = s.closed || left <= 0;
                        return (_jsxs("label", { style: { display: 'flex', gap: 8, minHeight: 48, alignItems: 'center' }, children: [_jsx("input", { type: "radio", name: "slot", disabled: full, checked: slotId === s.id, onChange: () => setSlotId(s.id) }), _jsxs("span", { className: "num", children: [fmtSlot(s.start), " \u2014 ", full ? 'complet' : `${left} places`] })] }, s.id));
                    }), _jsx("button", { className: "btn btn-primary", onClick: () => slotId && setStep(3), children: "Continuer" })] })), step === 3 && (_jsxs("section", { className: "card", children: [_jsx("h2", { children: "3. D\u00E9tails et prix" }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "persons", children: "Personnes (obligatoire)" }), _jsx("input", { id: "persons", inputMode: "numeric", value: persons, onChange: (e) => setPersons(e.target.value) })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "quads", children: "Quads (obligatoire)" }), _jsx("input", { id: "quads", inputMode: "numeric", value: quads, onChange: (e) => setQuads(e.target.value) })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "source", children: "Source (obligatoire)" }), _jsxs("select", { id: "source", value: source, onChange: (e) => setSource(e.target.value), children: [_jsx("option", { value: "phone", children: "T\u00E9l\u00E9phone" }), _jsx("option", { value: "whatsapp", children: "WhatsApp" }), _jsx("option", { value: "onsite", children: "Sur place" }), _jsx("option", { value: "online", children: "En ligne" })] })] }), _jsx("button", { className: "btn btn-primary", onClick: submit, children: "Enregistrer la r\u00E9servation" })] })), step === 4 && done && (_jsxs("section", { className: "card", children: [_jsx("h2", { children: "4. R\u00E9capitulatif" }), _jsx("div", { className: "num", children: done.code }), _jsx("div", { children: _jsx(StatusBadge, { status: done.status }) }), _jsxs("div", { className: "num", children: ["Total : ", fcfa(done.total), " \u2014 Acompte : ", fcfa(done.deposit_due)] }), payRef && _jsxs("div", { className: "num", children: ["Lien de paiement : ", payRef] }), waMe && _jsx("a", { href: waMe, target: "_blank", rel: "noreferrer", children: _jsx("button", { className: "btn btn-accent", children: "Envoyer par WhatsApp" }) })] }))] }));
}
