import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import Icon from '../lib/icons';
import { useTheme } from '../lib/theme';
/* En-tête d'écran : titre + description + actions. */
export function PageHeader({ title, sub, actions }) {
    return (_jsxs("div", { className: "page-row", children: [_jsxs("div", { className: "page-head", children: [_jsx("h1", { children: title }), sub && _jsx("p", { children: sub })] }), actions && _jsx("div", { className: "btn-row", style: { minWidth: 200 }, children: actions })] }));
}
/* Champ accessible : libellé au-dessus, 16px min, erreur avec conseil. */
export function Field({ label, required, hint, error, children, htmlFor }) {
    return (_jsxs("div", { className: `field${error ? ' invalid' : ''}`, children: [_jsxs("label", { htmlFor: htmlFor, children: [label, required && _jsx("span", { className: "req", "aria-hidden": "true", children: " *" })] }), children, hint && !error && _jsx("span", { className: "hint", children: hint }), error && _jsxs("span", { className: "error", role: "alert", children: [_jsx(Icon, { name: "alert", size: 15 }), error] })] }));
}
/* Bouton icône seul : toujours un libellé accessible. */
export function IconButton({ icon, label, ...rest }) {
    return (_jsx("button", { type: "button", className: `icon-btn${rest.className ? ` ${rest.className}` : ''}`, title: label, "aria-label": label, ...rest, children: _jsx(Icon, { name: icon, size: 20 }) }));
}
/* Interrupteur jour / nuit. */
export function ThemeSwitch({ compact }) {
    const { theme, toggle } = useTheme();
    const dark = theme === 'dark';
    return (_jsxs("button", { type: "button", className: "switch", role: "switch", "aria-checked": dark, onClick: toggle, title: dark ? 'Passer en thème clair' : 'Passer en thème sombre', "aria-label": dark ? 'Passer en thème clair' : 'Passer en thème sombre', children: [_jsx("span", { className: "track", "aria-hidden": "true", children: _jsx("span", { className: "thumb" }) }), !compact && (dark ? 'Sombre' : 'Clair'), _jsx(Icon, { name: dark ? 'moon' : 'sun', size: 16 })] }));
}
/* État vide : pictogramme + phrase + action. */
export function EmptyState({ icon = 'quad', title, text, action }) {
    return (_jsxs("div", { className: "card empty", children: [_jsx(Icon, { name: icon, size: 40 }), _jsx("strong", { className: "strong", children: title }), text && _jsx("p", { className: "typed", children: text }), action] }));
}
export function SkeletonList({ n = 3 }) {
    return (_jsx("div", { className: "stack", "aria-busy": "true", "aria-label": "Chargement en cours", children: Array.from({ length: n }).map((_, i) => _jsx("div", { className: "skeleton" }, i)) }));
}
/* Dialogue de confirmation : toute action destructive. */
export function ConfirmDialog({ title, text, confirmLabel, danger, busy, onConfirm, onClose }) {
    const ref = useRef(null);
    useEffect(() => {
        ref.current?.querySelector('button')?.focus();
        const onKey = (e) => { if (e.key === 'Escape')
            onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (_jsx("div", { className: "modal-backdrop", onClick: onClose, children: _jsxs("div", { className: "modal", role: "alertdialog", "aria-modal": "true", "aria-label": title, ref: ref, onClick: (e) => e.stopPropagation(), children: [_jsx("h2", { children: title }), _jsx("p", { children: text }), _jsxs("div", { className: "modal-actions", children: [_jsx("button", { type: "button", className: "btn btn-ghost", onClick: onClose, disabled: busy, children: "Revenir" }), _jsxs("button", { type: "button", className: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onClick: onConfirm, disabled: busy, children: [busy && _jsx("span", { className: "caret", "aria-hidden": "true" }), confirmLabel] })] })] }) }));
}
