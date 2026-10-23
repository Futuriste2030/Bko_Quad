import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import { ConfirmDialog, EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import { activeSiteId, listAnomalies, listCalls, createLine, listLines, listSites, reconcileCall, resolveAnomaly, toggleLine, type Anomaly, type CallItem, type Site, type TrackedLine } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDirection, fmtPhone, fmtSlot } from '../lib/format';

const REASONS = [
  { v: 'renseignement', label: 'Renseignement' },
  { v: 'annulation', label: 'Annulation' },
  { v: 'faux_numero', label: 'Faux numéro' },
  { v: 'autre', label: 'Autre' },
];

export default function Calls() {
  const link = useSiteLink();
  const { can, user } = useAuth();
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [anoms, setAnoms] = useState<Anomaly[]>([]);
  const [lines, setLines] = useState<TrackedLine[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [lineLabel, setLineLabel] = useState('');
  const [lineNumber, setLineNumber] = useState('');
  const [lineSite, setLineSite] = useState('');
  const mayLines = can('responsable', 'admin');
  const needsSite = mayLines && !user?.site;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('renseignement');
  const [pendingResolve, setPendingResolve] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const { notify } = useToast();

  function load(silent = false) {
  if (!silent) { setLoading(true); setError(''); }
    Promise.all([
      listCalls(),
      listAnomalies().catch(() => [] as Anomaly[]),
      listLines().catch(() => [] as TrackedLine[]),
      listSites().catch(() => [] as Site[]),
    ])
      .then(([c, a, l, s]) => {
        setCalls(c); setAnoms(a); setLines(l); setSites(s);
        setLineSite((cur) => cur || (user?.site ? String(user.site) : (activeSiteId() ? String(activeSiteId()) : '')));
        setUpdatedAt(new Date()); if (!silent) setError('');
      })
      .catch((e: Error) => { if (!silent) setError(e.message); })
      .finally(() => { if (!silent) setLoading(false); });
  }
  /* Rechargement live : le journal se met à jour seul toutes les 15 s
     (pause quand l'onglet est caché), sans déconnexion. */
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    loadRef.current();
    const id = setInterval(() => { if (!document.hidden) loadRef.current(true); }, 15000);
    return () => clearInterval(id);
  }, []);

  async function addLine() {
  if (!lineLabel.trim() || !lineNumber.trim()) {
  notify('warning', 'Libellé et numéro requis', 'Ex. Ligne Business, +22320201212.');
      return;
    }
    const siteId = user?.site ?? (lineSite ? Number(lineSite) : null);
    if (!siteId) {
      notify('warning', 'Site requis', 'Choisissez le site de cette ligne d’entreprise.');
      return;
    }
    try {
      const l = await createLine({
        label: lineLabel.trim(), number: lineNumber.trim(), site: siteId });
      notify('success', 'Ligne suivie', `${l.label} (${l.number}) - ${l.site_name || 'site non rattaché'}.`);
      setLineLabel(''); setLineNumber('');
      load();
    } catch (e) { notify('error', 'Ajout impossible', e instanceof Error ? e.message : ''); }
  }

  async function flipLine(l: TrackedLine) {
  try {
      await toggleLine(l.id, !l.active);
      load();
    } catch (e) { notify('error', 'Modification impossible', e instanceof Error ? e.message : ''); }
  }

  const openByCall = (id: number) => anoms.find((a) => a.call === id && a.status === 'open');
  const openCount = anoms.filter((a) => a.status === 'open').length;

  async function reconcile(id: number) {
  setBusy(true);
    try {
      const r = await reconcileCall(id);
      if (r.booking) notify('success', 'Appel rapproché', `Réservation ${r.booking.code}.`);
      else notify('warning', 'Anomalie créée', 'Aucune réservation trouvée : motif requis pour clore.');
      load();
    } catch (e) { notify('error', 'Rapprochement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function doResolve() {
  if (pendingResolve == null) return;
    const an = anoms.find((a) => a.id === pendingResolve);
    if (!an) return;
    setBusy(true);
    try {
      const res = await resolveAnomaly(an.id, reason);
      if (res.queued) notify('warning', 'Justification consignée hors ligne', 'L’appel sera clôturé au retour du réseau.');
      else notify('success', 'Anomalie justifiée', 'L’appel est clôturé avec motif.');
      setPendingResolve(null);
      load();
    } catch (e) { notify('error', 'Clôture impossible', e instanceof Error ? e.message : 'Motif obligatoire.'); }
    finally { setBusy(false); }
  }

  return (
    <AppShell anomalies={openCount}>
      <PageHeader title="Appels" sub="Journal d’appels. Chaque appel est rapproché ou justifié — aucune anomalie ne disparaît seule." />
      <p className="small muted">Actualisé{updatedAt ? ` à ${updatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Bamako' })}` : ''} Â· auto toutes les 15 s.</p>
      <section className="card" aria-label="Numéros suivis">
        <h2>Numéros d’entreprise suivis</h2>
        <p className="small muted">Remontée auto par l’APK collecteur (Mali +223, Côte d’Ivoire +225). Seuls responsable et admin gèrent les lignes.</p>
        <div className="list" style={{ marginTop: 8 }}>
          {lines.filter((l) => l.active).map((l) => (
            <div className="row-top" key={l.id}>
              <span><strong>{l.label}</strong> <span className="num muted">{fmtPhone(l.number)}</span>{l.site_name ? <span className="small muted"> Â· {l.site_name}</span> : null}{l.last_sync ? <span className="small muted"> Â· synchro {fmtSlot(l.last_sync)}</span> : <span className="small muted"> Â· jamais synchronisé</span>}</span>
              {mayLines && <button type="button" className="btn btn-sm btn-ghost" onClick={() => flipLine(l)}>Suspendre</button>}
            </div>
          ))}
          {lines.filter((l) => !l.active).map((l) => (
            <div className="row-top" key={l.id}>
              <span className="muted"><strong>{l.label}</strong> <span className="num">{fmtPhone(l.number)} (suspendu)</span></span>
              {mayLines && <button type="button" className="btn btn-sm btn-ghost" onClick={() => flipLine(l)}>Réactiver</button>}
            </div>
          ))}
          {lines.length === 0 && !loading && <p className="small muted">Aucune ligne déclarée pour le moment.</p>}
        </div>
        {mayLines && (
          <div className="form-2" style={{ marginTop: 8 }}>
            <Field label="Libellé" htmlFor="line-label"><input id="line-label" value={lineLabel} onChange={(e) => setLineLabel(e.target.value)} placeholder="Ex. Ligne Business" /></Field>
            <Field label="Numéro international" htmlFor="line-number"><input id="line-number" type="tel" value={lineNumber} onChange={(e) => setLineNumber(e.target.value)} placeholder="+223…" /></Field>
            {needsSite && (
              <Field label="Site de la ligne" required htmlFor="line-site" hint="Les appels seront rattachés à ce site.">
                <select id="line-site" value={lineSite} onChange={(e) => setLineSite(e.target.value)}>
                  <option value="">-</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
        {mayLines && (
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={addLine}>Ajouter la ligne</button>
          </div>
        )}
      </section>
      {openCount > 0 && (
        <div className="banner banner-danger" role="alert">
          <Icon name="alert" size={20} />
          <div><strong>{openCount} anomalie{openCount > 1 ? 's' : ''} ouverte{openCount > 1 ? 's' : ''}</strong>
          <div className="small">Motif obligatoire pour clore.</div></div>
        </div>
      )}
      {loading && <SkeletonList n={4} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && calls.length === 0 && (
        <EmptyState icon="phone" title="Aucun appel à traiter" text="Le journal se remplit à chaque appel entrant." />
      )}
      {!loading && !error && (
        <div className="list">
          {calls.map((c) => {
            const an = openByCall(c.id);
            return (
              <article className={`row-card${an ? ' alert' : ''}`} key={c.id}>
                <div className="row-top">
                  <span className="row-title num">{fmtPhone(c.phone_number)}</span>
                  {an
                    ? <span className="badge badge-anomaly"><Icon name="alert" size={14} />Anomalie ouverte</span>
                    : <span className="badge badge-completed"><Icon name="check" size={14} />Ã€ rapprocher</span>}
                </div>
                <div className="row-meta"><span className="num">{fmtSlot(c.started_at)}</span><span className="num">{c.duration_seconds} s</span><span>{fmtDirection(c.direction)}</span></div>
                <div className="small muted">
                  {c.line_label ? `Ligne ${c.line_label}` : 'Ligne non rattachée'}
                  {c.site_name ? ` · ${c.site_name}` : ' · site non rattaché'}
                  {c.imported_by_name ? ` · importé par ${c.imported_by_name}` : ''}
                </div>
                <div className="btn-row">
                  <button type="button" className="btn btn-sm" onClick={() => reconcile(c.id)} disabled={busy}>
                    <Icon name="refresh" size={16} />Rapprocher
                  </button>
                  <Link to={link(`/reservations/nouvelle?phone=${encodeURIComponent(c.phone_number)}`)} className="btn btn-sm btn-accent">
                    <Icon name="plus" size={16} />Réserver
                  </Link>
                </div>
                <div className="form-2">
                  <Field label="Motif (obligatoire pour clore)" htmlFor={`reason-${c.id}`}>
                    <select id={`reason-${c.id}`} value={reason} onChange={(e) => setReason(e.target.value)}>
                      {REASONS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                    </select>
                  </Field>
                  <div style={{ display: 'flex', alignItems: 'end' }}>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={!an || busy}
                      onClick={() => an && setPendingResolve(an.id)}>
                      Justifier l’appel
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {pendingResolve != null && (
        <ConfirmDialog
          title="Clore cette anomalie ?"
          text={`Motif : ${REASONS.find((r) => r.v === reason)?.label}. Cette clôture est tracée et définitive.`}
          confirmLabel="Justifier et clore" busy={busy}
          onConfirm={doResolve} onClose={() => !busy && setPendingResolve(null)}
        />
      )}
    </AppShell>
  );
}
