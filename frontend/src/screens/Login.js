import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import { ThemeSwitch } from '../components/ui';
const POINTS = [
    { icon: 'ticket', title: 'Réservations tracées', text: '7 statuts, motif obligatoire, jamais de suppression.' },
    { icon: 'phone', title: '100 % des appels rapprochés', text: 'Anomalie persistante tant qu’elle n’est pas justifiée.' },
    { icon: 'wallet', title: 'Argent suivi dès l’origine', text: 'Acomptes, caisse et bordereau de clôture du jour.' },
];
const inputCls = 'h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]';
export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const { login } = useAuth();
    const nav = useNavigate();
    const { notify } = useToast();
    async function submit(e) {
        e?.preventDefault();
        setError('');
        if (!username.trim()) {
            setError('Saisissez votre identifiant pour continuer.');
            return;
        }
        if (!password) {
            setError('Saisissez votre mot de passe pour continuer.');
            return;
        }
        setBusy(true);
        try {
            await login(username.trim(), password);
            notify('success', 'Connexion réussie', 'Bienvenue sur le Hub BKO Quad.');
            nav('/');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Connexion impossible.');
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { className: "relative min-h-dvh bg-[var(--bg)] text-[var(--ink)]", children: [_jsx("div", { className: "absolute right-4 top-4", children: _jsx(ThemeSwitch, { compact: true }) }), _jsxs("div", { className: "mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-center gap-10 px-4 py-14 sm:px-6 lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-center", children: [_jsxs("div", { className: "anim-rise", children: [_jsx("span", { className: "inline-flex items-center gap-1.5 rounded-full border border-black bg-[var(--accent)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-black", children: "Espace agence" }), _jsxs("div", { className: "mt-4 flex items-center gap-4", children: [_jsx("img", { src: "/android-chrome-192x192.png", alt: "Logo BKO Quad", className: "h-16 w-16 rounded-2xl border border-[var(--border)] object-contain sm:h-20 sm:w-20" }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold uppercase tracking-widest text-[var(--ink-muted)]", children: "Bamako \u00B7 Quad" }), _jsx("h1", { className: "typewrite text-3xl font-extrabold leading-tight sm:text-4xl", children: "BKO Quad Hub" })] })] }), _jsx("p", { className: "mt-4 max-w-md text-base leading-relaxed text-[var(--ink-muted)]", children: "L\u2019unique source de v\u00E9rit\u00E9 des r\u00E9servations : acomptes, appels, caisse et cl\u00F4ture, synchronis\u00E9s avec l\u2019API." }), _jsx("ul", { className: "mt-6 grid max-w-md gap-3", children: POINTS.map((p) => (_jsxs("li", { className: "flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3", children: [_jsx("span", { className: "grid h-11 w-11 flex-none place-items-center rounded-lg border border-[var(--border-strong)]", children: _jsx(Icon, { name: p.icon, size: 20 }) }), _jsxs("span", { children: [_jsx("strong", { className: "block text-base", children: p.title }), _jsx("span", { className: "block text-sm text-[var(--ink-muted)]", children: p.text })] })] }, p.title))) })] }), _jsxs("form", { onSubmit: submit, "aria-label": "Connexion au Hub", style: { animationDelay: '70ms' }, className: "anim-rise w-full rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-[3px_3px_0_var(--ink)] sm:p-8", children: [_jsx("h2", { className: "text-2xl font-bold", children: "Connexion" }), _jsx("p", { className: "mt-1 text-sm text-[var(--ink-muted)]", children: "R\u00E9serv\u00E9e au personnel de l\u2019agence." }), error && (_jsxs("div", { role: "alert", className: "mt-4 flex items-center gap-2 rounded-xl bg-[var(--danger)] p-3 text-sm font-semibold text-white", children: [_jsx(Icon, { name: "alert", size: 18 }), error] })), _jsxs("div", { className: "mt-5 grid gap-4", children: [_jsxs("div", { className: "grid gap-1.5", children: [_jsxs("label", { htmlFor: "login-u", className: "text-sm font-semibold", children: ["Identifiant ", _jsx("span", { "aria-hidden": "true", className: "text-[var(--danger)]", children: "*" })] }), _jsx("input", { id: "login-u", value: username, onChange: (e) => setUsername(e.target.value), autoComplete: "username", placeholder: "Ex. agent.bamako", disabled: busy, className: inputCls })] }), _jsxs("div", { className: "grid gap-1.5", children: [_jsxs("label", { htmlFor: "login-p", className: "text-sm font-semibold", children: ["Mot de passe ", _jsx("span", { "aria-hidden": "true", className: "text-[var(--danger)]", children: "*" })] }), _jsxs("div", { className: "relative", children: [_jsx("input", { id: "login-p", type: showPw ? 'text' : 'password', value: password, onChange: (e) => setPassword(e.target.value), autoComplete: "current-password", placeholder: "Votre mot de passe", disabled: busy, className: `${inputCls} pr-12` }), _jsx("button", { type: "button", onClick: () => setShowPw((v) => !v), "aria-label": showPw ? 'Masquer le mot de passe' : 'Afficher le mot de passe', "aria-pressed": showPw, className: "absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)]", children: showPw ? _jsx(EyeOff, { size: 20 }) : _jsx(Eye, { size: 20 }) })] })] }), _jsxs("button", { type: "submit", disabled: busy, className: "flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-[var(--ink)] bg-[var(--ink)] text-base font-bold text-[var(--bg)] shadow-[3px_3px_0_var(--border-strong)] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-60", children: [busy && _jsx("span", { "aria-hidden": "true", className: "caret on-ink" }), "Se connecter"] }), _jsx("p", { className: "text-center text-sm text-[var(--ink-muted)]", children: "Compte cr\u00E9\u00E9 par votre responsable. La v\u00E9rification en deux \u00E9tapes sera exig\u00E9e avant le pilote." })] })] })] })] }));
}
