const LABELS: Record<string, string> = {
  pending_deposit: 'En attente d’acompte',
  confirmed: 'Confirmée',
  checked_in: 'Arrivée validée',
  completed: 'Terminée',
  cancelled: 'Annulée',
  no_show: 'Absent',
  expired: 'Expirée',
};

export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{LABELS[status] ?? status}</span>;
}
