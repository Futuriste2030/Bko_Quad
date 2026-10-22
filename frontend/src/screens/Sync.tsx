import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import { EmptyState, PageHeader } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import { useSync } from '../lib/sync';
import { removeOp, resetOp, type OpKind } from '../lib/offline';
import { fcfa } from '../lib/format';

const KIND_LABEL: Record<OpKind, string> = {
  customer: 'Client',
  booking: 'Réservation',
  cash: 'Encaissement',
  invoice: 'Facture',
  expense: 'Caisse',
  anomaly: 'Appel',
  message: 'Message',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Bamako',
  });
}

/* J : file des saisies faites sans réseau. Le rejeu est automatique au retour
   de la connexion ; un refus métier reste en attente d'arbitrage humain. */
export default function Sync() {
  const link = useSiteLink();
  const { notify } = useToast();
  const { ops, pending, failed, running, sync } = useSync();
  const [busyId, setBusyId] = useState('');

  async function doSync() {
    const report = await sync();
    if (!report) { notify('error', 'Synchronisation impossible', 'Réessayez au retour du réseau.'); return; }
    if (report.needLogin) {
      notify('warning', 'Session à renouveler', 'Reconnectez-vous pour envoyer la file.');
      return;
    }
    if (report.sent > 0) notify('success', 'Saisies synchronisées', `${report.sent} envoi(s) confirmé(s) par le Hub.`);
    else if (report.failed > 0) notify('warning', 'Saisies refusées', `${report.failed} refus : arbitrage requis.`);
    else if (pending === 0) notify('info', 'Rien à envoyer', 'Toutes les saisies sont passées.');
  }

  async function abandon(id: string) {
    setBusyId(id);
    await removeOp(id);
    notify('info', 'Saisie abandonnée', 'Elle n’a jamais atteint le Hub.');
    setBusyId('');
  }

  async function retry(id: string) {
    setBusyId(id);
    await resetOp(id);
    await sync();
    setBusyId('');
  }

  return (
    <AppShell>
      <PageHeader
        title="Synchronisation"
        sub="Saisies faites sans réseau : elles repartent seules au retour de la connexion, une seule fois."
      />

      <section className="card">
        <div className="chart-title"><h3>File d’attente</h3><small>{pending} en attente</small></div>
        <p className="small muted" style={{ marginBottom: 10 }}>
          Rien n’est confirmé avant l’envoi : une réservation saisie hors ligne reste « à synchroniser »
          et n’existe pas encore dans le Hub. Un refus du Hub (créneau complet, doublon) est signalé ici
          et attend votre arbitrage.
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => void doSync()} disabled={running || pending === 0}>
            {running ? <span className="caret" aria-hidden="true" /> : <Icon name="refresh" size={18} />}
            Synchroniser maintenant
          </button>
          {failed > 0 && <span className="badge badge-anomaly"><Icon name="alert" size={14} />{failed} refus</span>}
        </div>
      </section>

      {ops.length === 0 && (
        <EmptyState icon="check" title="Aucune saisie en attente" text="Tout est passé dans le Hub." />
      )}

      {ops.length > 0 && (
        <div className="list">
          {ops.map((op) => (
            <article className="row-card" key={op.id}>
              <div className="row-top">
                <span className="row-title">{op.label}</span>
                {op.status === 'pending'
                  ? <span className="badge badge-sync"><Icon name="clock" size={14} />À synchroniser</span>
                  : <span className="badge badge-anomaly"><Icon name="alert" size={14} />Refusée</span>}
              </div>
              <div className="row-meta">
                <span>{KIND_LABEL[op.kind]}</span>
                <span>{when(op.createdAt)}</span>
                {op.meta.amount !== undefined && <span className="num">{fcfa(Number(op.meta.amount))}</span>}
              </div>
              {op.error && <p className="small" style={{ color: 'var(--danger)' }}>{op.error}</p>}
              {op.status === 'failed' && (
                <div className="btn-row">
                  <button type="button" className="btn btn-sm" onClick={() => void retry(op.id)} disabled={busyId === op.id}>
                    Réessayer
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void abandon(op.id)} disabled={busyId === op.id}>
                    Abandonner
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <p className="small muted">
        Besoin d’arbitrer une saisie ? <Link to={link('/reservations')}>Réservations</Link> ·{' '}
        <Link to={link('/appels')}>Appels</Link> · <Link to={link('/caisse')}>Caisse</Link>
      </p>
    </AppShell>
  );
}
