import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import SiteFilter from '../components/SiteFilter';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import { issueInvoice, listBookings, listCustomers, listInvoices, listPayments, recordCash, type Booking, type Customer, type Payment } from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';

/* Factures : numéro séquentiel (Hub), encaissement espèces (versement/solde).
   (écriture de caisse, parcours guide), reçu et facture avec QR. */
export default function Invoices() {
  const link = useSiteLink();
  const [items, setItems] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [numbers, setNumbers] = useState<Record<number, number>>({});
  const [paid, setPaid] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [toCash, setToCash] = useState<Booking | null>(null);
  const [amount, setAmount] = useState('');
  const [nature, setNature] = useState<'deposit' | 'balance'>('deposit');
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  function load() {
  setLoading(true); setError('');
    Promise.all([listBookings(), listCustomers().catch(() => [] as Customer[]), listPayments().catch(() => [] as Payment[]), listInvoices().catch(() => [])])
      .then(([b, c, p, inv]) => {
        setItems(b); setCustomers(c);
        const m: Record<number, number> = {};
        for (const x of p) if (x.status === 'paid') m[x.booking] = (m[x.booking] ?? 0) + x.amount;
        setPaid(m);
        const n: Record<number, number> = {};
        for (const x of inv) n[x.booking] = x.number;
        setNumbers(n);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const nameOf = (id: number) => customers.find((c) => c.id === id)?.name ?? '—';
  const rows = useMemo(() => items.filter((b) =>
    !q.trim() || b.code.toLowerCase().includes(q.trim().toLowerCase()) || nameOf(b.customer).toLowerCase().includes(q.trim().toLowerCase()),
  ), [items, q, customers]);

  async function emit(b: Booking) {
  setBusy(true);
    try {
      const inv = await issueInvoice(b.id);
      setNumbers((m) => ({ ...m, [b.id]: inv.number }));
      if (inv.queued) notify('warning', 'Facture programmée', 'Le numéro sera attribué à la synchronisation.');
      else notify('success', 'Facture émise', `${b.code} → ${inv.number}.`);
    } catch (e) { notify('error', 'Émission impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function doCash() {
  if (!toCash) return;
    const n = Number(amount);
    if (!n || n < 1) { notify('warning', 'Montant invalide', 'Saisissez les espèces reçues, en FCFA.'); return; }
    setBusy(true);
    try {
      const res = await recordCash(toCash.id, Math.round(n), nature);
      if (res.queued) {
        notify('warning', 'Encaissement consigné hors ligne',
          `${fcfa(n)} sur ${toCash.code} — la réservation sera confirmée à la synchronisation.`);
      } else {
        notify('success', 'Encaissé', `${fcfa(n)} sur ${toCash.code} — reçu ${res.reference}.`);
        if (res.booking.status === 'confirmed' && toCash.status === 'pending_deposit') {
          notify('info', 'Réservation confirmée', 'Paiement espèces complet et tracé.');
        }
      }
      setToCash(null); setAmount('');
      load();
    } catch (e) { notify('error', 'Encaissement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader title="Factures" sub="Facture à numéro unique, encaissement espèces tracé, reçu et facture avec QR." />
      <div className="card">
        <div className="form-2">
          <div className="search">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher code ou client…" aria-label="Rechercher une facture" />
          </div>
          <SiteFilter />
        </div>
      </div>
      {loading && <SkeletonList n={4} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState icon="file" title="Aucune facture" text="Les réservations facturables apparaîtront ici." />
      )}
      {!loading && !error && (
        <div className="list">
          {rows.map((b) => {
            const rest = Math.max(0, b.total - (paid[b.id] ?? 0));
            return (
              <article className="row-card" key={b.id}>
                <div className="row-top">
                  <span className="row-title num">{b.code}</span>
                  <StatusBadge status={b.status} />
                </div>
                <div className="row-meta">
                  <span>{nameOf(b.customer)}</span>
                  <span className="num">{fmtSlot(b.expires_at)}</span>
                </div>
                <div className="row-top">
                  <strong className="num">{fcfa(b.total)}</strong>
                  <span className="small muted num">{numbers[b.id] ? `Facture N° ${String(numbers[b.id]).padStart(4, '0')}` : 'Sans facture'}</span>
                  <span className="small num">Payé : {fcfa(paid[b.id] ?? 0)} · Reste : {fcfa(rest)}</span>
                </div>
                <div className="btn-row">
                  {b.total === 0 ? (
                    <span className="small muted">Montant nul (ancienne saisie) — à annuler depuis Réservations, motif « erreur de saisie ».</span>
                  ) : (
                    <>
                      {!numbers[b.id] && (
                        <button type="button" className="btn btn-sm" onClick={() => emit(b)} disabled={busy}>
                          <Icon name="file" size={16} />Facturer
                        </button>
                      )}
                      {rest > 0 && b.status !== 'cancelled' && b.status !== 'expired' && (
                        <button type="button" className="btn btn-sm btn-accent" onClick={() => { setToCash(b); setAmount(String(rest)); setNature(b.status === 'pending_deposit' ? 'deposit' : 'balance'); }}>
                          <Icon name="wallet" size={16} />Encaisser
                        </button>
                      )}
                      {rest === 0 && (
                        <span className="badge badge-confirmed"><Icon name="check" size={14} />Soldé</span>
                      )}
                    </>
                  )}
                  <Link to={link(`/documents/${b.id}/recu`)} className="btn btn-sm btn-ghost">Reçu</Link>
                  <Link to={link(`/documents/${b.id}/facture`)} className="btn btn-sm btn-ghost">Facture</Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {toCash && (
        <div className="modal-backdrop" onClick={() => !busy && setToCash(null)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label={`Encaisser ${toCash.code}`} onClick={(e) => e.stopPropagation()}>
            <h2>Encaisser {toCash.code}</h2>
            <p>Un seul encaissement du total, en espèces : une écriture de caisse liée est créée et la réservation est confirmée (tracé).</p>
            <Field label="Nature" required htmlFor="cash-nature">
              <select id="cash-nature" value={nature} onChange={(e) => setNature(e.target.value as 'deposit' | 'balance')}>
                <option value="deposit">Versement</option>
                <option value="balance">Solde</option>
              </select>
            </Field>
            <Field label="Montant reçu (FCFA)" required htmlFor="cash-amount">
              <input id="cash-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setToCash(null)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={doCash} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Confirmer l’encaissement
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
