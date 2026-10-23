import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { CompanyFooter, CompanyHeader } from '../components/CompanyDoc';
import { ConfirmDialog, EmptyState, Field, IconButton, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import {
  createMaintenance, createSparePart, createVehicle, deleteSparePart, deleteVehicle,
  listMaintenances, listSites, listSpareParts, listVehicles,
  type Maintenance, type Site, type SparePart, type Vehicle,
} from '../lib/api';
import { fcfa } from '../lib/format';
import { mediaUrl } from '../lib/api';

const STATUS: Record<string, { label: string; cls: string }> = {
  en_service: { label: 'En service', cls: 'badge-confirmed' },
  maintenance: { label: 'En maintenance', cls: 'badge-pending_deposit' },
  hors_service: { label: 'Hors service', cls: 'badge-no_show' },
};
const TYPES = [
  { v: 'quad', label: 'Quad', icon: 'moto' },
  { v: 'velo', label: 'Vélo', icon: 'velo' },
  { v: 'kart', label: 'Kart', icon: 'car' },
  { v: 'navette', label: 'Navette', icon: 'bus' },
  { v: 'autre', label: 'Autre', icon: 'truck' },
] as const;
const COLORS = [
  { v: 'rouge', label: 'Rouge', hex: '#c62828' },
  { v: 'noir', label: 'Noir', hex: '#0a0a0a' },
  { v: 'blanc', label: 'Blanc', hex: '#ffffff' },
  { v: 'bleu', label: 'Bleu', hex: '#1d5fd1' },
  { v: 'vert', label: 'Vert', hex: '#17703d' },
  { v: 'jaune', label: 'Jaune', hex: '#f2b01e' },
  { v: 'orange', label: 'Orange', hex: '#e8590c' },
  { v: 'gris', label: 'Gris', hex: '#5c5c5c' },
];
const colorHex = (name: string) => COLORS.find((c) => c.v === name)?.hex ?? '#888888';
const typeIcon = (t: string) => (TYPES.find((x) => x.v === t)?.icon ?? 'truck') as 'moto' | 'velo' | 'car' | 'bus' | 'truck';
const typeLabel = (t: string) => TYPES.find((x) => x.v === t)?.label ?? t;

const KINDS = [
  { v: 'vidange', label: 'Vidange' },
  { v: 'reparation', label: 'Réparation' },
  { v: 'piece', label: 'Changement de pièce' },
  { v: 'controle', label: 'Contrôle' },
  { v: 'pneus', label: 'Pneus' },
  { v: 'autre', label: 'Autre' },
];

/* Flotte : registre des engins (modèle, type, immatriculation, couleur,
   état, site), maintenances qui pilotent l'état affiché, rapport mensuel. */
export default function Fleet() {
  const { can, user } = useAuth();
  const { notify } = useToast();
  const [items, setItems] = useState<Vehicle[]>([]);
  const [maint, setMaint] = useState<Maintenance[]>([]);
  const [parts, setParts] = useState<SparePart[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fSite, setFSite] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [openV, setOpenV] = useState(false);
  const [openM, setOpenM] = useState<Vehicle | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);
  const now = new Date();
  const defaultMonth = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= 25 ? 0 : -1), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const [month, setMonth] = useState(defaultMonth);
  const [vSite, setVSite] = useState('');
  const [vType, setVType] = useState('quad');
  const [vModel, setVModel] = useState('');
  const [vPlate, setVPlate] = useState('');
  const [vColor, setVColor] = useState('');
  /* Photo de l'engin : aperçu local, le serveur convertit en WebP. */
  const [vPhoto, setVPhoto] = useState<File | null>(null);
  const [vPhotoUrl, setVPhotoUrl] = useState('');
  const [mKind, setMKind] = useState('vidange');
  const [mPart, setMPart] = useState('');
  const [mSerial, setMSerial] = useState('');
  const [toDelete, setToDelete] = useState<Vehicle | null>(null);
  const [partToDelete, setPartToDelete] = useState<SparePart | null>(null);
  const [mDate, setMDate] = useState('');
  const [mCost, setMCost] = useState('');
  const [mNotes, setMNotes] = useState('');
  const [mStatus, setMStatus] = useState('');
  const [mOil, setMOil] = useState('');
  const [mQty, setMQty] = useState('');
  /* Stock de pièces : ajout, recherche, fiche utilisée grisée. */
  const [openPart, setOpenPart] = useState(false);
  const [partQ, setPartQ] = useState('');
  const [pSite, setPSite] = useState('');
  const [pName, setPName] = useState('');
  const [pSerial, setPSerial] = useState('');
  const [pColor, setPColor] = useState('');
  const [pReason, setPReason] = useState('');
  const [pDate, setPDate] = useState(new Date().toISOString().slice(0, 10));
  const mayEdit = can('responsable', 'admin');

  function load() {
    setLoading(true); setError('');
    Promise.all([
      listVehicles(),
      listMaintenances().catch(() => [] as Maintenance[]),
      listSpareParts().catch(() => [] as SparePart[]),
      listSites().catch(() => [] as Site[]),
    ])
      .then(([v, m, p, s]) => {
        setItems(v); setMaint(m); setParts(p); setSites(s);
        if (s.length === 1) setVSite((prev) => prev || String(s[0].id));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const partMatch = useMemo(() => {
    const serial = mSerial.trim().toLowerCase();
    if (!serial) return null;
    return parts.find((p) => p.serial_number.toLowerCase() === serial) ?? null;
  }, [parts, mSerial]);

  const partRows = useMemo(() => {
    const needle = partQ.trim().toLowerCase();
    if (!needle) return parts;
    return parts.filter((p) =>
      p.name.toLowerCase().includes(needle)
      || p.serial_number.toLowerCase().includes(needle)
      || p.reason.toLowerCase().includes(needle)
      || (p.used_vehicle_plate ?? '').toLowerCase().includes(needle));
  }, [parts, partQ]);

  const rows = useMemo(() => items.filter((v) =>
    (fSite === 'all' || String(v.site) === fSite) && (fStatus === 'all' || v.status === fStatus),
  ), [items, fSite, fStatus]);
  const inService = items.filter((v) => v.status === 'en_service').length;

  async function doDelete() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await deleteVehicle(toDelete.id);
      notify('success', 'Engin retiré', `${toDelete.plate} — sans historique, sans créneau.`);
      setToDelete(null);
      load();
    } catch (e) { notify('error', 'Suppression impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  function openPartModal() {
    setPSite(fSite !== 'all' ? fSite : String(user?.site ?? sites[0]?.id ?? ''));
    setPName(''); setPSerial(''); setPColor(''); setPReason('');
    setPDate(new Date().toISOString().slice(0, 10));
    setOpenPart(true);
  }

  async function submitPart() {
    if (!pSite || !pName.trim() || !pSerial.trim() || !pReason.trim()) {
      notify('warning', 'Site, nom, numéro de série et raison requis',
        'Le numéro de série est unique et permet de rapprocher la pièce en maintenance.');
      return;
    }
    setBusy(true);
    try {
      await createSparePart({
        site: Number(pSite), name: pName.trim(), serial_number: pSerial.trim(),
        color: pColor, reason: pReason.trim(), bought_on: pDate || undefined,
      });
      notify('success', 'Pièce ajoutée au stock', `${pName.trim()} — N° ${pSerial.trim().toUpperCase()}.`);
      setOpenPart(false);
      setPName(''); setPSerial(''); setPColor(''); setPReason('');
      load();
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function doDeletePart() {
    if (!partToDelete) return;
    setBusy(true);
    try {
      await deleteSparePart(partToDelete.id);
      notify('success', 'Pièce retirée du stock', `${partToDelete.name} — N° ${partToDelete.serial_number}.`);
      setPartToDelete(null);
      load();
    } catch (e) { notify('error', 'Suppression impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  /* Rapport du mois M : ajouts du mois, interventions du mois,
     dernière maintenance ≤ fin du mois par engin. Mois proposé :
     mois en cours dès le 25 (clôture), sinon mois précédent. */
  const monthEnd = (() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0);
  })();
  const addedRows = useMemo(() => items.filter((v) => {
    if (!v.created_at) return false;
    const d = new Date(v.created_at);
    const [y, m] = month.split('-').map(Number);
    return d.getFullYear() === y && d.getMonth() + 1 === m;
  }), [items, month]);
  const maintOf = (id: number) => maint.filter((m) => m.vehicle === id).slice(0, 3);
  /* Libellé lisible : pièce, huile (L), nombre selon l’intervention. */
  const maintLabel = (m: Maintenance): string => {
    const bits = [m.kind];
    if (m.part_name) bits.push(`(${m.part_name})`);
    if (m.part_serial) bits.push(`N° ${m.part_serial}`);
    if (m.oil_liters) bits.push(`${Number(m.oil_liters)} L d’huile`);
    if (m.quantity) bits.push(`× ${m.quantity}`);
    return bits.join(' ');
  };
  const lastMaintBefore = (id: number) => {
    const past = maint.filter((m) => m.vehicle === id && new Date(m.date) <= monthEnd)
      .sort((a, b) => b.date.localeCompare(a.date));
    return past[0] ?? null;
  };
  const repRows = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return maint.filter((x) => {
      const d = new Date(x.date);
      return d.getFullYear() === y && d.getMonth() + 1 === m;
    });
  }, [maint, month]);
  const repCost = repRows.reduce((s, x) => s + x.cost, 0);

  async function submitVehicle() {
    if (!vSite || !vModel.trim() || !vPlate.trim()) {
      notify('warning', 'Site, modèle et immatriculation requis', 'L’immatriculation identifie l’engin.');
      return;
    }
    setBusy(true);
    try {
      await createVehicle({ site: Number(vSite), type: vType, model: vModel.trim(), plate: vPlate.trim().toUpperCase(), color: vColor.trim(), photo: vPhoto ?? undefined });
      notify('success', 'Engin enregistré', vPlate.trim().toUpperCase());
      setOpenV(false); setVModel(''); setVPlate(''); setVColor(''); setVPhoto(null); setVPhotoUrl('');
      load();
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function submitMaint() {
    if (!openM) return;
    if (mKind === 'piece' && !mPart.trim()) {
      notify('warning', 'Pièce requise', 'Nommez la pièce changée.');
      return;
    }
    if (mKind === 'piece' && !mSerial.trim()) {
      notify('warning', 'Numéro de série requis', 'Saisissez le numéro de série de la pièce de rechange.');
      return;
    }
    if (mKind === 'piece' && !partMatch) {
      notify('warning', 'Pièce introuvable', 'Aucune pièce du stock ne porte ce numéro de série.');
      return;
    }
    if (mKind === 'piece' && partMatch && partMatch.site !== openM.site) {
      notify('warning', 'Pièce d’un autre site', `Cette pièce appartient au site ${partMatch.site_name}.`);
      return;
    }
    if (mKind === 'piece' && partMatch && partMatch.status !== 'available') {
      notify('warning', 'Pièce déjà utilisée', partMatch.used_vehicle_plate
        ? `Elle a été montée sur l’engin ${partMatch.used_vehicle_plate}.`
        : 'Cette pièce a déjà servi en maintenance.');
      return;
    }
    if (mKind === 'autre' && !mPart.trim()) {
      notify('warning', 'Précision requise', 'Écrivez ce qui a été fait, en une phrase.');
      return;
    }
    if (mKind === 'vidange' && mOil.trim() && !(Number(mOil) > 0)) {
      notify('warning', 'Quantité invalide', 'Huile en litres, ex. 1.5.');
      return;
    }
    setBusy(true);
    try {
      await createMaintenance({
        vehicle: openM.id, kind: mKind, date: mDate || new Date().toISOString().slice(0, 10),
        cost: Number(mCost) || 0, part_name: mPart.trim() || undefined,
        part_serial: mKind === 'piece' ? mSerial.trim() : undefined,
        oil_liters: mKind === 'vidange' && Number(mOil) > 0 ? Number(mOil) : null,
        quantity: (mKind === 'piece' || mKind === 'pneus') && Number(mQty) > 0 ? Math.round(Number(mQty)) : null,
        notes: mNotes.trim(), new_status: mStatus || undefined,
      });
      notify('success', 'Maintenance enregistrée',
        mStatus ? `État affiché : ${STATUS[mStatus]?.label}.` : 'Historique mis à jour.');
      if (mKind === 'piece' && partMatch) {
        notify('info', 'Pièce sortie du stock', `${partMatch.name} — N° ${partMatch.serial_number}.`);
      }
      if (Number(mCost) > 0) notify('info', 'Dépense créée', 'Le coût est passé en caisse.');
      setOpenM(null); setMCost(''); setMNotes(''); setMStatus(''); setMPart(''); setMSerial(''); setMOil(''); setMQty('');
      load();
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  /* Champs proposés selon l'intervention : vidange → huile (L) ;
     pièce → nom + nombre ; pneus → nombre ; le reste → notes. */
  const KIND_HINT: Record<string, string> = {
    vidange: 'Ex. 10W40, filtre à huile changé.',
    reparation: 'Ex. embrayage, câble, freins.',
    piece: 'Ex. kit embrayage, plaquettes avant.',
    controle: 'Ex. contrôle 50 h, serrages, niveaux.',
    pneus: 'Ex. avant, arrière, les deux.',
    autre: 'Précisez l’intervention.',
  };

  return (
    <AppShell>
      <PageHeader
        title="Flotte"
        sub="Registre des engins et maintenances. L’état affiché vient de la dernière intervention."
        actions={(
          <>
            {mayEdit && <button type="button" className="btn btn-accent" onClick={() => setOpenV(true)}><Icon name="plus" size={18} />Engin</button>}
            <button type="button" className="btn btn-ghost no-print" onClick={() => setReport((v) => !v)}><Icon name="file" size={18} />Rapport mensuel</button>
          </>
        )}
      />
      {report && (
        <section className="card" aria-label="Rapport mensuel de la flotte">
          <div className="no-print" style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
            <Field label="Mois du rapport" htmlFor="fl-month">
              <input id="fl-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </Field>
            <div className="btn-row">
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}><Icon name="file" size={18} />Imprimer</button>
              <button type="button" className="btn btn-ghost" onClick={() => setReport(false)}>Fermer</button>
            </div>
          </div>
          <CompanyHeader title={`Rapport flotte — ${new Date(`${month}-02`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`}
            sub={`${repRows.length} interventions · coût ${fcfa(repCost)} · ${addedRows.length} ajouts · généré le ${new Date().toLocaleDateString('fr-FR')} (mensuel auto le 25)`} />
          <h3 style={{ marginTop: 8 }}>Engins ajoutés ce mois-ci</h3>
          <div className="list" style={{ marginTop: 8 }}>
            {addedRows.map((v) => (
              <div className="leader" key={v.id}>
                <span className="num">{v.created_at ? new Date(v.created_at).toLocaleDateString('fr-FR') : '—'} · {v.plate} · {v.model}</span>
                <span className="dots" aria-hidden="true" />
                <strong>{v.site_name}</strong>
              </div>
            ))}
            {addedRows.length === 0 && <p>Aucun ajout ce mois-ci.</p>}
          </div>
          <h3 style={{ marginTop: 12 }}>Interventions du mois</h3>
          <div className="list" style={{ marginTop: 8 }}>
            {repRows.map((m) => (
              <div className="leader" key={m.id}>
                <span className="num">{new Date(m.date).toLocaleDateString('fr-FR')} · {m.plate} · {maintLabel(m)}</span>
                <span className="dots" aria-hidden="true" />
                <strong className="num">{fcfa(m.cost)}</strong>
              </div>
            ))}
            {repRows.length === 0 && <p>Aucune intervention ce mois-ci.</p>}
          </div>
          <h3 style={{ marginTop: 12 }}>État du parc fin de mois</h3>
          <div className="list">
            {items.map((v) => {
              const last = lastMaintBefore(v.id);
              return (
                <div className="leader" key={v.id}>
                  <span className="num">{v.plate} · {v.model}</span>
                  <span className="dots" aria-hidden="true" />
                  <strong>{STATUS[v.status]?.label}{last ? ` · dern. ${new Date(last.date).toLocaleDateString('fr-FR')}` : ''}</strong>
                </div>
              );
            })}
          </div>
          <CompanyFooter />
        </section>
      )}
      <div className="card no-print">
        <div className="form-2">
          <Field label="Site" htmlFor="fl-site">
            <select id="fl-site" value={fSite} onChange={(e) => setFSite(e.target.value)}>
              <option value="all">Tous les sites</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="État" htmlFor="fl-status">
            <select id="fl-status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="all">Tous les états</option>
              <option value="en_service">En service</option>
              <option value="maintenance">En maintenance</option>
              <option value="hors_service">Hors service</option>
            </select>
          </Field>
        </div>
      </div>
      {loading && <SkeletonList n={4} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && inService === 0 && (
        <div className="banner banner-warning" role="alert">
          <Icon name="alert" size={20} />
          <div><strong>Flotte non inventoriée.</strong>
            <div className="small">Ajoutez les quads et vélos en service : sans eux, les nouvelles réservations sont bloquées par la disponibilité réelle.</div></div>
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState icon="quad" title="Aucun engin" text="Enregistrez le premier quad de la flotte." />
      )}
      {!loading && !error && (
        <div className="fleet-grid">
          {rows.map((v) => (
            <article className="row-card fleet-card" key={v.id}>
              <div className="fleet-top">
                {v.photo
                  ? <img src={mediaUrl(v.photo)} alt={v.model} className="fleet-photo" width={44} height={44} />
                  : <span className="vicon" aria-hidden="true"><Icon name={typeIcon(v.type)} size={26} /></span>}
                <span className="fleet-id">
                  <span className="stub num">{v.plate}</span>
                  <span className="small muted">{v.model} · {v.site_name}</span>
                </span>
                <span className={`badge ${STATUS[v.status]?.cls ?? 'badge-completed'}`}>{STATUS[v.status]?.label}</span>
              </div>
              <div className="row-meta">
                <span>{typeLabel(v.type)}</span>
                {v.color && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className="cdot" style={{ background: colorHex(v.color) }} aria-hidden="true" />
                    {COLORS.find((c) => c.v === v.color)?.label ?? v.color}
                  </span>
                )}
                {v.created_at && <span className="num">Depuis le {new Date(v.created_at).toLocaleDateString('fr-FR')}</span>}
              </div>
              {maintOf(v.id).length > 0 && (
                <div className="small muted">
                  {maintOf(v.id).map((m) => (
                    <div key={m.id} className="num">{new Date(m.date).toLocaleDateString('fr-FR')} · {maintLabel(m)}{m.cost > 0 ? ` · ${fcfa(m.cost)}` : ''}{m.notes ? ` · ${m.notes}` : ''}</div>
                  ))}
                </div>
              )}
              {mayEdit && (
                <div className="btn-row">
                    <button type="button" className="btn btn-sm" onClick={() => { setOpenM(v); setMDate(new Date().toISOString().slice(0, 10)); setMKind('vidange'); setMPart(''); setMSerial(''); setMOil(''); setMQty(''); }}>
                      <Icon name="plus" size={16} />Maintenance
                    </button>
                  <IconButton icon="x" label={`Retirer ${v.plate}`} className="danger plain" onClick={() => setToDelete(v)} />
                </div>
              )}
              {toDelete && toDelete.id === v.id && (
                <ConfirmDialog
                  title={`Retirer ${v.plate} ?`}
                  text="Possible seulement sans historique ni créneau lié — sinon passez-le hors service."
                  confirmLabel="Retirer l’engin" danger busy={busy}
                  onConfirm={doDelete} onClose={() => !busy && setToDelete(null)}
                />
              )}
            </article>
          ))}
        </div>
      )}

      {/* Stock de pièces de rechange : les pièces consommées restent visibles,
          grisées, avec l'engin et la date de la maintenance. */}
      {!loading && !error && (
      <section className="card parts-stock" aria-label="Stock de pièces de rechange">
        <div className="page-row">
          <div className="page-head">
            <h2>Stock de pièces de rechange</h2>
            <p>Chaque pièce achetée porte un numéro de série unique. Une pièce utilisée reste ici, grisée, avec l’engin entretenu.</p>
          </div>
          {mayEdit && (
            <div className="btn-row" style={{ minWidth: 180 }}>
              <button type="button" className="btn btn-accent" onClick={openPartModal}>
                <Icon name="plus" size={18} />Pièce
              </button>
            </div>
          )}
        </div>
        <div className="search">
          <Icon name="search" size={18} />
          <input value={partQ} onChange={(e) => setPartQ(e.target.value)}
            placeholder="Rechercher nom, numéro de série, engin…" aria-label="Rechercher une pièce" />
        </div>
        {partRows.length === 0 && (
          <p className="small muted" role="status">
            {parts.length === 0
              ? 'Aucune pièce en stock : enregistrez la première pièce achetée pour la suivre jusqu’à son montage.'
              : 'Aucune pièce ne correspond à la recherche.'}
          </p>
        )}
        {partRows.length > 0 && (
          <div className="list">
            {partRows.map((p) => {
              const used = p.status === 'used';
              return (
                <article className={`row-card part-card${used ? ' part-used' : ''}`} key={p.id}>
                  <div className="row-top">
                    <span className="stub num">{p.serial_number}</span>
                    <strong>{p.name}</strong>
                    <span className={`badge ${used ? 'badge-completed' : 'badge-confirmed'}`}>
                      {used ? 'Utilisée' : 'En stock'}
                    </span>
                  </div>
                  <div className="row-meta">
                    {p.color && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="cdot" style={{ background: colorHex(p.color) }} aria-hidden="true" />
                        {COLORS.find((c) => c.v === p.color)?.label ?? p.color}
                      </span>
                    )}
                    <span className="num">Achetée le {new Date(p.bought_on).toLocaleDateString('fr-FR')}</span>
                    <span>{p.site_name}</span>
                    {p.added_by_name && <span>Ajoutée par {p.added_by_name}</span>}
                  </div>
                  {p.reason && <div className="small">Raison : {p.reason}</div>}
                  {used && (
                    <div className="small part-use">
                      Utilisée pour la maintenance de <strong>{p.used_vehicle_model || 'cet engin'}</strong>
                      {p.used_vehicle_plate && <> — N° <strong className="num">{p.used_vehicle_plate}</strong></>}
                      {p.used_on && <> le <span className="num">{new Date(p.used_on).toLocaleDateString('fr-FR')}</span></>}.
                    </div>
                  )}
                  {mayEdit && !used && (
                    <div className="btn-row">
                      <IconButton icon="x" label={`Supprimer ${p.serial_number}`} className="danger plain"
                        onClick={() => setPartToDelete(p)} />
                    </div>
                  )}
                  {partToDelete?.id === p.id && (
                    <ConfirmDialog
                      title={`Retirer ${p.name} ?`}
                      text={`La pièce N° ${p.serial_number} sera retirée du stock. Une pièce déjà utilisée ne peut jamais être supprimée.`}
                      confirmLabel="Retirer la pièce" danger busy={busy}
                      onConfirm={doDeletePart} onClose={() => !busy && setPartToDelete(null)}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}

      {openV && (
        <div className="modal-backdrop" onClick={() => !busy && setOpenV(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Nouvel engin" onClick={(e) => e.stopPropagation()}>
            <h2>Nouvel engin</h2>
            <div className="form-2">
              <Field label="Site" required htmlFor="v-site">
                <select id="v-site" value={vSite} onChange={(e) => setVSite(e.target.value)}>
                  <option value="">Choisir…</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Type" required htmlFor="v-type">
                <select id="v-type" value={vType} onChange={(e) => setVType(e.target.value)}>
                  {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Modèle" required htmlFor="v-model"><input id="v-model" value={vModel} onChange={(e) => setVModel(e.target.value)} placeholder="Ex. Yamaha Grizzly 350" /></Field>
            <div className="form-2">
              <Field label="Immatriculation" required htmlFor="v-plate"><input id="v-plate" value={vPlate} onChange={(e) => setVPlate(e.target.value)} placeholder="Ex. Q-012" style={{ textTransform: 'uppercase' }} /></Field>
              <Field label="Couleur" htmlFor="v-color">
                <select id="v-color" value={vColor} onChange={(e) => setVColor(e.target.value)}>
                  <option value="">Choisir…</option>
                  {COLORS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Photo de l’engin (facultatif — compressée automatiquement)" htmlFor="v-photo" hint="Choisissez une image prise au téléphone : elle est rétrécie et convertie en WebP par le Hub.">
              <input id="v-photo" type="file" accept="image/*" onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setVPhoto(f);
                setVPhotoUrl(f ? URL.createObjectURL(f) : '');
              }} />
            </Field>
            {vPhotoUrl && (
              <img src={vPhotoUrl} alt={`Aperçu de l’engin`} style={{ height: 92, borderRadius: 12, border: '2px solid var(--border-strong)' }} />
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpenV(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submitVehicle} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
      {openPart && (
        <div className="modal-backdrop" onClick={() => !busy && setOpenPart(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Nouvelle pièce de rechange" onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle pièce de rechange</h2>
            <div className="form-2">
              <Field label="Site" required htmlFor="p-site">
                <select id="p-site" value={pSite} onChange={(e) => setPSite(e.target.value)}>
                  <option value="">Choisir…</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Date d’achat" required htmlFor="p-date">
                <input id="p-date" type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Nom de la pièce" required htmlFor="p-name" hint="Ex. kit embrayage, plaquettes avant, filtre à air.">
              <input id="p-name" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Nom de la pièce achetée" />
            </Field>
            <div className="form-2">
              <Field label="Numéro de série" required htmlFor="p-serial" hint="Unique : il sera saisi en maintenance pour sortir la pièce du stock.">
                <input id="p-serial" value={pSerial} onChange={(e) => setPSerial(e.target.value)} placeholder="Ex. KE-2026-0042" />
              </Field>
              <Field label="Couleur" htmlFor="p-color">
                <select id="p-color" value={pColor} onChange={(e) => setPColor(e.target.value)}>
                  <option value="">Choisir…</option>
                  {COLORS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Raison de l’achat" required htmlFor="p-reason" hint="Ex. remplacement de l’embrayage du quad Q-012.">
              <input id="p-reason" value={pReason} onChange={(e) => setPReason(e.target.value)} placeholder="Pourquoi cette pièce a-t-elle été achetée ?" />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpenPart(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submitPart} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
      {openM && (
        <div className="modal-backdrop" onClick={() => !busy && setOpenM(null)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label={`Maintenance ${openM.plate}`} onClick={(e) => e.stopPropagation()}>
            <h2>Maintenance — {openM.plate}</h2>
            <div className="form-2">
              <Field label="Intervention" required htmlFor="m-kind">
                <select id="m-kind" value={mKind} onChange={(e) => setMKind(e.target.value)}>
                  {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
                </select>
              </Field>
              <Field label="Date" required htmlFor="m-date"><input id="m-date" type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} /></Field>
            </div>
            <div className="form-2">
              <Field label="Coût (FCFA, 0 = sans coût)" htmlFor="m-cost"><input id="m-cost" inputMode="numeric" value={mCost} onChange={(e) => setMCost(e.target.value)} placeholder="0" /></Field>
              <Field label="État après (vide = inchangé)" htmlFor="m-status">
                <select id="m-status" value={mStatus} onChange={(e) => setMStatus(e.target.value)}>
                  <option value="">Inchangé</option>
                  <option value="en_service">En service</option>
                  <option value="maintenance">En maintenance</option>
                  <option value="hors_service">Hors service</option>
                </select>
              </Field>
            </div>
            <Field label="Notes" htmlFor="m-notes" hint={KIND_HINT[mKind]}><input id="m-notes" value={mNotes} onChange={(e) => setMNotes(e.target.value)} placeholder="Détail de l’intervention" /></Field>
            {mKind === 'vidange' && (
              <Field label="Quantité d’huile (litres)" required htmlFor="m-oil" hint="Huile moteur versée, ex. 1.5 L.">
                <input id="m-oil" inputMode="decimal" value={mOil} onChange={(e) => setMOil(e.target.value)} placeholder="Ex. 1.5" />
              </Field>
            )}
            {mKind === 'piece' && (
              <>
                <Field label="Nom de la pièce" required htmlFor="m-part" hint="Ex. kit embrayage, plaquettes avant.">
                  <input id="m-part" value={mPart} onChange={(e) => setMPart(e.target.value)} placeholder="Nom de la pièce changée" />
                </Field>
                <Field label="Numéro de série de la pièce" required htmlFor="m-serial"
                  hint="Obligatoire : la pièce doit exister dans le stock du même site.">
                  <input id="m-serial" value={mSerial} onChange={(e) => setMSerial(e.target.value)} placeholder="Ex. KE-2026-0042" />
                </Field>
                {mSerial.trim() !== '' && (
                  partMatch ? (
                    partMatch.status !== 'available' ? (
                      <div className="alert-error" role="alert">
                        <Icon name="alert" size={18} />
                        Pièce déjà utilisée{partMatch.used_vehicle_plate ? ` sur l’engin ${partMatch.used_vehicle_plate}` : ''}.
                      </div>
                    ) : partMatch.site !== openM.site ? (
                      <div className="alert-error" role="alert">
                        <Icon name="alert" size={18} />
                        Cette pièce appartient au site {partMatch.site_name}, pas à celui de l’engin.
                      </div>
                    ) : (
                      <div className="part-match" role="status">
                        <Icon name="check" size={18} />
                        <span>
                          <strong>{partMatch.name}</strong> · N° {partMatch.serial_number}
                          {partMatch.color ? ` · ${COLORS.find((c) => c.v === partMatch.color)?.label ?? partMatch.color}` : ''}
                          {' — '}<strong>en stock</strong> ({partMatch.site_name})
                        </span>
                      </div>
                    )
                  ) : (
                    <div className="small muted" role="status">
                      Aucune pièce en stock avec ce numéro de série. Enregistrez-la d’abord dans le stock ci-dessous.
                    </div>
                  )
                )}
                <Field label="Nombre" htmlFor="m-qty" hint="Pièces changées, ex. 2 plaquettes.">
                  <input id="m-qty" inputMode="numeric" value={mQty} onChange={(e) => setMQty(e.target.value)} placeholder="Ex. 1" />
                </Field>
              </>
            )}
            {mKind === 'pneus' && (
              <Field label="Nombre de pneus" required htmlFor="m-qty" hint="Ex. 1 (avant), 2 (les deux).">
                <input id="m-qty" inputMode="numeric" value={mQty} onChange={(e) => setMQty(e.target.value)} placeholder="Ex. 2" />
              </Field>
            )}
            {mKind === 'autre' && (
              <Field label="Précision de l’intervention" required htmlFor="m-part" hint="Écrivez en une phrase ce qui a été fait, ex. soudure du porte-bagage.">
                <input id="m-part" value={mPart} onChange={(e) => setMPart(e.target.value)} placeholder="Qu’est-ce qui a été fait ?" />
              </Field>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpenM(null)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submitMaint} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
