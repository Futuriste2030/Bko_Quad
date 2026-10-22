import Icon, { type IconName } from '../lib/icons';

export const STATUS_LABELS: Record<string, string> = {
  pending_deposit: 'En attente de paiement',
  confirmed: 'Confirmée',
  checked_in: 'Arrivée validée',
  completed: 'Terminée',
  cancelled: 'Annulée',
  no_show: 'Absent',
  expired: 'Expirée',
};

const ICONS: Record<string, IconName> = {
  pending_deposit: 'clock',
  confirmed: 'check',
  checked_in: 'user',
  completed: 'check',
  cancelled: 'x',
  no_show: 'alert',
  expired: 'clock',
};

/* Statut : toujours texte + icône, jamais couleur seule (guide §2). */
export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status}`}>
      <Icon name={ICONS[status] ?? 'info'} size={14} />
      {STATUS_LABELS[status] ?? status}    </span>
  );
}
