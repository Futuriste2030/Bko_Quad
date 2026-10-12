import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import { Field, PageHeader } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import { clearDraft, createBooking, createCustomer, createPayLink, listBookings, listCustomers, listSlots, loadDraft, logMessage, saveDraft, } from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';
const ACTIVE = ['pending_deposit', 'confirmed', 'checked_in'];
const STEPS = ['Client', 'Créneau', 'Détails', 'Récapitulatif'];
export default function NewBooking() {
    const [params] = useSearchParams();
    const { notify } = useToast();
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
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        Promise.all([listCustomers(), listSlots(), listBookings()])
            .then(([c, s, b]) => { setCustomers(c); setSlots(s); setBookings(b); })
            .catch((e) => setError(e.message));
        const d = loadDraft();
        if (d && !params.get('phone'))
            setPhone(d);
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
            notify('info', 'Client retrouvé', found.name);
            return;
        }
        if (!name.trim()) {
            setError('Client inconnu : saisissez son nom pour le créer.');
            return;
        }
        setBusy(true);
        createCustomer({ name: name.trim(), phone: phone.trim() })
            .then((c) => { setCustomer(c); setStep(2); notify('success', 'Client enregistré', c.name); })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
    }
    async function submit() {
        setError('');
        if (!customer || !slotId) {
            setError('Client et créneau requis.');
            return;
        }
        setBusy(true);
        try {
            const b = await createBooking({
                customer: customer.id, slot: slotId,
                persons: Number(persons), quads: Number(quads), source,
            });
            setDone(b);
            clearDraft();
            notify('success', 'Réservation enregistrée', `${b.code} — en attente d’acompte.`);
            try {
                const link = await createPayLink(b.id);
                setPayRef(link.reference);
                const text = `Bonjour, votre réservation ${b.code} est en attente d’acompte (${fcfa(b.deposit_due)}).`;
                const logged = await logMessage(b.id, text);
                setWaMe(logged.wa_me);
            }
            catch {
                notify('warning', 'Lien de paiement indisponible', 'La réservation reste valide en attente d’acompte.');
            }
            setStep(4);
        }
        catch (e) {
            saveDraft(phone);
            setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs(AppShell, { children: [_jsx(PageHeader, { title: "Nouvelle r\u00E9servation", sub: "Quatre \u00E9tapes courtes. Le brouillon est conserv\u00E9 sur ce t\u00E9l\u00E9phone en cas d\u2019interruption." }), _jsx("div", { className: "card", children: _jsx("div", { className: "steps", "aria-label": `Étape ${step} sur 4 : ${STEPS[step - 1]}`, children: STEPS.map((s, i) => (_jsxs("span", { style: { display: 'contents' }, children: [_jsxs("span", { className: `step-dot${i + 1 < step ? ' done' : ''}${i + 1 === step ? ' now' : ''}`, children: [_jsx("span", { className: "n", "aria-hidden": "true", children: i + 1 < step ? '✓' : i + 1 }), s] }), i < 3 && _jsx("span", { className: "step-line", "aria-hidden": "true" })] }, s))) }) }), error && _jsxs("div", { className: "alert-error", role: "alert", children: [_jsx(Icon, { name: "alert", size: 18 }), error] }), step === 1 && (_jsxs("section", { className: "card form", "aria-label": "\u00C9tape 1 : client", children: [_jsx("h2", { children: "1. Client" }), _jsx(Field, { label: "T\u00E9l\u00E9phone", required: true, htmlFor: "nb-phone", hint: "Format international, ex. +223 78 80 30 72", children: _jsx("input", { id: "nb-phone", type: "tel", inputMode: "tel", value: phone, onChange: (e) => setPhone(e.target.value), placeholder: "+223\u2026", autoComplete: "tel" }) }), _jsx(Field, { label: "Nom (si nouveau client)", htmlFor: "nb-name", children: _jsx("input", { id: "nb-name", value: name, onChange: (e) => setName(e.target.value), placeholder: "Nom du client", autoComplete: "name" }) }), _jsxs("button", { type: "button", className: "btn btn-primary", onClick: pickCustomer, disabled: busy, children: [busy && _jsx("span", { className: "caret", "aria-hidden": "true" }), "Continuer"] })] })), step === 2 && (_jsxs("section", { className: "card", "aria-label": "\u00C9tape 2 : cr\u00E9neau", children: [_jsx("h2", { children: "2. Cr\u00E9neau" }), _jsxs("p", { className: "muted small", children: ["Client : ", _jsx("strong", { children: customer?.name }), " \u2014 choisissez un cr\u00E9neau avec des places."] }), _jsxs("div", { className: "slot-list", role: "radiogroup", "aria-label": "Cr\u00E9neaux disponibles", children: [slots.map((s) => {
                                const left = s.capacity - (used.get(s.id) ?? 0);
                                const full = s.closed || left <= 0;
                                return (_jsxs("label", { className: "slot", "aria-checked": slotId === s.id, children: [_jsx("input", { type: "radio", name: "slot", disabled: full, checked: slotId === s.id, onChange: () => setSlotId(s.id) }), _jsxs("span", { children: [_jsx("strong", { className: "num", children: fmtSlot(s.start) }), _jsx("br", {}), _jsx("small", { children: full ? 'Complet — choisissez-en un autre' : `${left} place${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''} sur ${s.capacity}` })] })] }, s.id));
                            }), slots.length === 0 && _jsx("p", { children: "Aucun cr\u00E9neau publi\u00E9 pour le moment." })] }), _jsxs("div", { className: "btn-row", style: { marginTop: 12 }, children: [_jsx("button", { type: "button", className: "btn btn-ghost", onClick: () => setStep(1), children: "Retour" }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => slotId && setStep(3), disabled: !slotId, children: "Continuer" })] })] })), step === 3 && (_jsxs("section", { className: "card form", "aria-label": "\u00C9tape 3 : d\u00E9tails", children: [_jsx("h2", { children: "3. D\u00E9tails et prix" }), _jsxs("div", { className: "form-2", children: [_jsx(Field, { label: "Personnes", required: true, htmlFor: "nb-persons", children: _jsx("input", { id: "nb-persons", inputMode: "numeric", value: persons, onChange: (e) => setPersons(e.target.value) }) }), _jsx(Field, { label: "Quads", required: true, htmlFor: "nb-quads", children: _jsx("input", { id: "nb-quads", inputMode: "numeric", value: quads, onChange: (e) => setQuads(e.target.value) }) })] }), _jsx(Field, { label: "Source", required: true, htmlFor: "nb-source", hint: "D\u2019o\u00F9 vient la demande ? Trac\u00E9 d\u00E8s l\u2019origine.", children: _jsxs("select", { id: "nb-source", value: source, onChange: (e) => setSource(e.target.value), children: [_jsx("option", { value: "phone", children: "T\u00E9l\u00E9phone" }), _jsx("option", { value: "whatsapp", children: "WhatsApp" }), _jsx("option", { value: "onsite", children: "Sur place" }), _jsx("option", { value: "online", children: "En ligne" })] }) }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn btn-ghost", onClick: () => setStep(2), children: "Retour" }), _jsxs("button", { type: "button", className: "btn btn-primary", onClick: submit, disabled: busy, children: [busy && _jsx("span", { className: "caret", "aria-hidden": "true" }), "Enregistrer la r\u00E9servation"] })] })] })), step === 4 && done && (_jsxs("section", { className: "card", "aria-label": "R\u00E9capitulatif", children: [_jsx("h2", { children: "4. R\u00E9capitulatif" }), _jsxs("div", { className: "row-top", children: [_jsx("span", { className: "stub num", style: { fontSize: 'var(--text-xl)' }, children: done.code }), _jsx(StatusBadge, { status: done.status })] }), _jsx("hr", { className: "divider" }), _jsxs("div", { className: "leader", children: [_jsx("span", { children: "Total" }), _jsx("span", { className: "dots", "aria-hidden": "true" }), _jsx("strong", { className: "num", children: fcfa(done.total) })] }), _jsxs("div", { className: "leader", children: [_jsx("span", { children: "Acompte" }), _jsx("span", { className: "dots", "aria-hidden": "true" }), _jsx("strong", { className: "num", children: fcfa(done.deposit_due) })] }), payRef && _jsxs("p", { className: "num", children: ["Lien de paiement : ", payRef] }), _jsx("div", { className: "btn-row", style: { marginTop: 12 }, children: waMe && (_jsxs("a", { href: waMe, target: "_blank", rel: "noreferrer", className: "btn btn-accent", children: [_jsx(Icon, { name: "send", size: 18 }), "Envoyer par WhatsApp"] })) })] }))] }));
}
