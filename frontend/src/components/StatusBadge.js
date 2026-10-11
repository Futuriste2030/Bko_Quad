import { jsx as _jsx } from "react/jsx-runtime";
const LABELS = {
    pending_deposit: 'En attente d’acompte',
    confirmed: 'Confirmée',
    checked_in: 'Arrivée validée',
    completed: 'Terminée',
    cancelled: 'Annulée',
    no_show: 'Absent',
    expired: 'Expirée',
};
export default function StatusBadge({ status }) {
    return _jsx("span", { className: `badge badge-${status}`, children: LABELS[status] ?? status });
}
