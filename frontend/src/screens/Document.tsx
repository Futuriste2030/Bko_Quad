import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import { CompanyFooter, CompanyHeader } from '../components/CompanyDoc';
import QrCode, { qrValue } from '../components/QrCode';
import StatusBadge from '../components/StatusBadge';
import { EmptyState, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useCompany } from '../lib/company';
import { useToast } from '../lib/toast';
import {
  downloadPdf, listActivities, listBookings, listCustomers, listInvoices, listPayments, listSites, listSlots, listVehicles, logMessage, setBookingVehicles,
  type Activity, type Booking, type Customer, type Invoice, type Payment, type Site, type Slot, type Vehicle,
} from '../lib/api';
import { factureNumber, fcfa, fmtPhone, fmtSlot, norm, dureeLibelle } from '../lib/format';
import { mediaUrl } from '../lib/api';

/* Reçu ET facture séparés (PRD R2) : contenu opposable, QR du talon,
   téléchargement PDF serveur (même numérotation, envoyable au client).
   Reçu = paiement (envoyé à la main au client, WhatsApp).
   Facture = total, numéro séquentiel sans trou. */
type Kind = 'recu' | 'facture';

/* Paiement comptant sur place : pas de partie « conditions » sur le reçu ni la facture.
   Détail commande : personnes, quads (solo 25 000 / duo 30 000), nÂ° des quads, prix. */
const PRICE_SOLO_QUAD = 25000;
const PRICE_DUO_QUAD = 30000;

const splitName = (full: string): { first: string; last: string } => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '—', last: '—' };
  if (parts.length === 1) return { first: parts[0], last: '—' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
};

const quadParts = (persons: number, quads: number): { solo: number; duo: number } => ({
  solo: 2 * quads - persons,
  duo: persons - quads,
});

const isKidsActivityName = (v: string): boolean => {
  const n = norm(v);
  return n.includes('kid') || n.includes('enfant');
};

export default function Document() {
  const link = useSiteLink();
  const { id, kind = 'recu' } = useParams();
  const doc: Kind = kind === 'facture' ? 'facture' : 'recu';
  const { notify } = useToast();
  const { company } = useCompany();
  const { can } = useAuth();
  const mayAssign = can('responsable', 'admin');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [pays, setPays] = useState<Payment[]>([]);
  const [site, setSite] = useState<Site | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Correction a posteriori : fige les N° d'engins (anciens reçus), tracée serveur.
  const [assignOpen, setAssignOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);

  useEffect(() => {
    Promise.all([listBookings(), listCustomers(), listActivities(), listSlots(), listSites().catch(() => [] as Site[]), listVehicles().catch(() => [] as Vehicle[]), listPayments().catch(() => [] as Payment[]), listInvoices().catch(() => [] as Invoice[])])
      .then(([bb, cc, aa, ss, si, vv, pp, ii]) => {
        const b = bb.find((x) => x.id === Number(id)) ?? null;
        setBooking(b);
        if (b) {
  setCustomer(cc.find((x) => x.id === b.customer) ?? null);
          const sl = ss.find((s) => s.id === b.slot) ?? null;
          setSlot(sl);
          const act = aa.find((a) => a.id === sl?.activity) ?? null;
          setActivity(act);
          setSite(si.find((s) => s.id === act?.site) ?? null);
          setVehicles(vv);
          setPays(pp.filter((p) => p.booking === b.id && p.status === 'paid'));
          /* Facture auto à l'encaissement complet (paiement instantané) :
             présente si déjà émise, le bouton disparaît. */
          setInvoice(ii.find((x) => x.booking === b.id) ?? null);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);


  const fNum = invoice ? factureNumber(invoice.number, site?.name ?? '', customer?.name ?? '', new Date(invoice.issued_at)) : '';
  /* Immatriculations : engins affectés à la réservation, sinon ceux du créneau. */
  const docPlates = (booking?.vehicle_plates && booking.vehicle_plates.length > 0)
    ? booking.vehicle_plates
    : (slot?.vehicles ?? []).map((vid) => vehicles.find((v) => v.id === vid)?.plate ?? '').filter(Boolean);

  /* Vrai PDF serveur, envoyable au client (même numérotation qu'à l'écran). */
  async function download() {
  if (!booking) return;
    if (doc === 'facture' && !invoice) {
  notify('warning', 'Facture non émise', 'Émettez la facture avant de la télécharger.');
      return;
    }
    setBusy(true);
    try {
      const name = doc === 'facture' ? (fNum || booking.code) : `recu-${booking.code}`;
      await downloadPdf(`/documents/${booking.id}/${doc}/pdf/`, `${name}.pdf`);
      notify('success', 'PDF téléchargé', 'Prêt à envoyer au client.');
    } catch (e) { notify('error', 'Téléchargement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  /* Engins du site en service : correction des N° (anciens reçus), tracée. */
  const siteVehicles = (activity && vehicles.filter((v) => v.status === 'en_service' && v.site === activity.site)
    .sort((a, b) => a.plate.localeCompare(b.plate))) || [];

  function openAssign() {
  if (!booking) return;
    const current = new Set(booking.vehicle_plates ?? []);
    setPicked(siteVehicles.filter((v) => current.has(v.plate)).map((v) => v.id));
    setAssignOpen(true);
  }

  function togglePick(id: number) {
  setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p]));
  }

  async function saveAssign() {
  if (!booking) return;
    setBusy(true);
    try {
      const upd = await setBookingVehicles(booking.id, picked);
      setBooking(upd);
      setAssignOpen(false);
      notify('success', 'Engins affectés', `${(upd.vehicle_plates ?? []).join(', ') || '—'} — tracé.`);
    } catch (e) { notify('error', 'Affectation impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function sendRecu() {
  if (!booking) return;
    setBusy(true);
    try {
      const text = `Bonjour ${customer?.name ?? ''}, voici votre reçu BKO Quad : réservation ${booking.code}`
        + `${slot ? `, ${activity?.name ?? ''} ${fmtSlot(slot.start)}` : ''}.`
        + ` Payé ${fcfa(pays.reduce((s, p) => s + p.amount, 0))} sur un total de ${fcfa(booking.total)}.`
        + ` Présentez le code ${booking.code} à l’arrivée.`;
      const logged = await logMessage(booking.id, text);
      const native = (window as unknown as { BkoNative?: { openExternal?: (u: string) => void } }).BkoNative;
      if (native && typeof native.openExternal === 'function') {
        native.openExternal(logged.wa_me);
      } else {
        window.open(logged.wa_me, '_blank', 'noopener');
      }
      notify('success', 'Reçu prêt à envoyer', 'WhatsApp ouvert avec le texte du reçu.');
    } catch (e) { notify('error', 'Envoi impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title={doc === 'facture' ? 'Facture' : 'Reçu'}
        sub={doc === 'facture'
          ? 'Total de la réservation, numéro séquentiel sans trou.'
          : 'Paiement à envoyer à la main au client (WhatsApp).'}
        actions={(
          <>
            <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}><Icon name="file" size={18} />Imprimer</button>
            {booking && <button type="button" className="btn btn-ghost no-print" onClick={download}><Icon name="download" size={18} />Télécharger</button>}
          </>
        )}
      />
      {loading && <SkeletonList n={2} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && !booking && (
        <EmptyState icon="ticket" title="Réservation introuvable" text="Ce document n’existe pas ou plus." />
      )}
      {!loading && !error && booking && (
        <section className="card doc" aria-label={doc === 'facture' ? 'Facture' : 'Reçu'}>
          <CompanyHeader
            title={doc === 'facture' ? `Facture ${fNum || ''}` : 'Reçu — paiement'}
            sub={doc === 'facture' ? 'Montant total, numéro séquentiel sans trou.' : 'Paiement encaissé, à remettre au client.'}
          />
          <div className="row-top"><span className="stub num">{booking.code}</span><StatusBadge status={booking.status} /></div>
          <hr className="divider" />
          {(() => {
            const nm = splitName(customer?.name ?? '');
            /* Immatriculations : engins affectés à la réservation, sinon ceux du créneau. */
            const pl = (booking.vehicle_plates && booking.vehicle_plates.length > 0)
              ? booking.vehicle_plates
              : (slot?.vehicles ?? []).map((vid) => vehicles.find((v) => v.id === vid)?.plate ?? '').filter(Boolean);
            const kids = isKidsActivityName(activity?.name ?? '');
            const velo = booking.resource_type === 'velo';
            const engins = velo ? 'vélo' : 'quad';
            const parts = quadParts(booking.persons, booking.quads);
            const docLines = booking.lines && booking.lines.length > 0 ? [...booking.lines].sort((a, b) => a.rank - b.rank) : null;
            /* H : unité de facturation affichée (heures ou jours), reste à l'identique quand unité = 1. */
            const slotMin = slot ? Math.max(0, Math.round((new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60000)) : 0;
            const units = Math.max(1, booking.units ?? 1);
            const unitLabel = dureeLibelle(activity?.duration_minutes ?? slotMin);
            const brut = (booking.lines ?? []).reduce((s, l) => s + l.line_total, 0);
            const remise = booking.discount_total ?? 0;
            const facturationLabel = units > 1
              ? `${dureeLibelle(slotMin)} = ${units} × ${unitLabel}`
              : `${unitLabel} (formule « ${activity?.name ?? '—'} »)`;
            return (
              <>
                <div className="leader"><span>Facturation</span><span className="dots" aria-hidden="true" /><strong>{facturationLabel}</strong></div>
                <div className="leader"><span>Prénom</span><span className="dots" aria-hidden="true" /><strong>{nm.first}</strong></div>
                <div className="leader"><span>Nom</span><span className="dots" aria-hidden="true" /><strong>{nm.last}</strong></div>
                <div className="leader"><span>Téléphone</span><span className="dots" aria-hidden="true" /><strong className="num">{customer ? fmtPhone(customer.phone) : '—'}</strong></div>
                {slot && <div className="leader"><span>Créneau</span><span className="dots" aria-hidden="true" /><strong className="num">{activity?.name} {fmtSlot(slot.start)}</strong></div>}
                {site && <div className="leader"><span>Site</span><span className="dots" aria-hidden="true" /><strong>{site.name}</strong></div>}
                {docLines ? (
                  <>
                    {docLines.map((l) => (
                      <div className="leader" key={l.rank}><span>Ligne {l.rank} — {l.persons} pers., {l.quads} {engins}{l.quads > 1 ? 's' : ''}{units > 1 ? ` · ${units} × ${unitLabel}` : ''}</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(l.line_total)}</strong></div>
                    ))}
                    {remise > 0 && (
                      <>
                        {docLines.map((l) => (l.discount ?? 0) > 0 ? (
                          <div className="leader" key={`r${l.rank}`}><span>Remise ligne {l.rank} (manuelle)</span><span className="dots" aria-hidden="true" /><strong className="num">− {fcfa(l.discount ?? 0)}</strong></div>
                        ) : null)}
                        <div className="leader"><span>Sous-total</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(brut)}</strong></div>
                        <div className="leader"><span>Remise manuelle</span><span className="dots" aria-hidden="true" /><strong className="num">− {fcfa(remise)}</strong></div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                <div className="leader"><span>Personnes</span><span className="dots" aria-hidden="true" /><strong className="num">{booking.persons}</strong></div>
                <div className="leader"><span>{velo ? 'Vélos' : 'Quads'}</span><span className="dots" aria-hidden="true" /><strong className="num">{booking.quads}{!kids && !velo && parts.duo > 0 && parts.solo >= 0 ? ` (${parts.solo} solo + ${parts.duo} duo)` : ''}</strong></div>
                {kids || velo ? (
                  <div className="leader"><span>{velo ? 'Vélo' : 'Quad enfant'} — {booking.persons} × {fcfa(booking.unit_price)}</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(booking.total)}</strong></div>
                ) : (
                  <>
                    {parts.solo > 0 && <div className="leader"><span>Quads solo (1 pers.) — {parts.solo} × {fcfa(PRICE_SOLO_QUAD)}</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(parts.solo * PRICE_SOLO_QUAD)}</strong></div>}
                    {parts.duo > 0 && <div className="leader"><span>Quads duo (2 pers.) — {parts.duo} × {fcfa(PRICE_DUO_QUAD)}</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(parts.duo * PRICE_DUO_QUAD)}</strong></div>}
                  </>
                )}
                  </>
                )}
                {pl.length > 0 && <div className="leader"><span>N° des engins</span><span className="dots" aria-hidden="true" /><strong className="num">{pl.join(', ')}</strong></div>}
              </>
            );
          })()}
          {doc === 'facture' ? (
            <>
              <div className="leader"><span>Montant facturé</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(booking.total)}</strong></div>
              {invoice && (
                <div className="leader"><span>Émise le</span><span className="dots" aria-hidden="true" /><strong className="num">{new Date(invoice.issued_at).toLocaleDateString('fr-FR')}</strong></div>
              )}
            </>
          ) : (
            <>
              <div className="leader"><span>Payé (comptant, sur place)</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(pays.reduce((s, p) => s + p.amount, 0))}</strong></div>
              <div className="leader"><span>Reste dû</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(Math.max(0, booking.total - pays.reduce((s, p) => s + p.amount, 0)))}</strong></div>
              <button type="button" className="btn btn-accent no-print" onClick={sendRecu} disabled={busy} style={{ marginTop: 12 }}>
                <Icon name="send" size={18} />Envoyer le reçu par WhatsApp
              </button>
              {(mediaUrl(company.stamp) || mediaUrl(company.signature)) && (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12 }}>
                  {mediaUrl(company.stamp) && <img src={mediaUrl(company.stamp)} alt="Cachet de l’entreprise" style={{ height: 84, objectFit: 'contain' }} />}
                  {mediaUrl(company.signature) && <img src={mediaUrl(company.signature)} alt="Signature" style={{ height: 72, objectFit: 'contain' }} />}
                </div>
              )}
            </>
          )}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <QrCode value={qrValue(booking.code, booking.qr_token)} label={`QR ${doc} ${booking.code}`} />
            <p className="small muted" style={{ maxWidth: 260 }}>Présentez ce talon au guide : le scan valide l’arrivée et consomme le code.</p>
            {doc === 'facture' && mediaUrl(company.stamp) && (
              <img src={mediaUrl(company.stamp)} alt="Cachet de l’entreprise" style={{ height: 84, objectFit: 'contain' }} />
            )}
            {doc === 'facture' && mediaUrl(company.signature) && (
              <img src={mediaUrl(company.signature)} alt="Signature" style={{ height: 72, objectFit: 'contain' }} />
            )}
          </div>
          <div className="no-print" style={{ marginTop: 12 }}>
            <div className="leader"><span>Engins affectés (N°)</span><span className="dots" aria-hidden="true" /><strong className="num">{docPlates.length > 0 ? docPlates.join(', ') : '—'}</strong></div>
            {docPlates.length === 0 && <p className="small muted">Ancien document sans immatriculations : figez les N° utilisés, ils apparaîtront ici et sur le PDF.</p>}
            {mayAssign && !assignOpen && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={openAssign} disabled={busy} style={{ marginTop: 8 }}>
                <Icon name="plus" size={16} />{docPlates.length > 0 ? 'Corriger les N°' : 'Affecter les N°'}
              </button>
            )}
            {mayAssign && assignOpen && (
              <div className="card form" style={{ marginTop: 8 }}>
                <p className="small muted">Cochez les engins utilisés ({booking.quads} attendu{booking.quads > 1 ? 's' : ''}). Contrôle de chevauchement si le créneau est à venir — tracé.</p>
                <div className="slot-list">
                  {siteVehicles.map((v) => (
                    <label key={v.id} className="slot" aria-checked={picked.includes(v.id)}>
                      <input type="checkbox" checked={picked.includes(v.id)} onChange={togglePick.bind(null, v.id)} />
                      <span><strong className="num">{v.plate}</strong><br /><small>{v.model} · {v.type === 'velo' ? 'Vélo' : 'Quad'}</small></span>
                    </label>
                  ))}
                  {siteVehicles.length === 0 && <p>Aucun engin en service sur ce site. Voyez la Flotte.</p>}
                </div>
                <div className="btn-row">
                  <button type="button" className="btn btn-ghost" onClick={() => setAssignOpen(false)} disabled={busy}>Revenir</button>
                  <button type="button" className="btn btn-primary" onClick={saveAssign} disabled={busy || picked.length === 0}>
                    {busy && <span className="caret" aria-hidden="true" />}Enregistrer ({picked.length})
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="btn-row no-print" style={{ marginTop: 12 }}>
            <Link to={link(doc === 'facture' ? `/documents/${booking.id}/recu` : `/documents/${booking.id}/facture`)} className="btn btn-ghost">
              Voir {doc === 'facture' ? 'le reçu' : 'la facture'}
            </Link>
            <Link to={link("/factures")} className="btn btn-ghost">Retour aux factures</Link>
          </div>
          <CompanyFooter showConditions={false} />
        </section>
      )}
    </AppShell>
  );
}
