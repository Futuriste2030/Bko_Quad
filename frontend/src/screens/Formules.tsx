import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { ConfirmDialog, EmptyState, Field, IconButton, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import {
  activeSiteId, createActivity, deleteActivity, listActivities, listSites, updateActivity,
  type Activity, type Site,
} from '../lib/api';
import { fcfa, norm } from '../lib/format';

function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes || 0));
  if (m >= 60 && m % 60 === 0) return `${m / 60} h`;
  if (m > 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${m} min`;
}

const isKids = (name: string): boolean => norm(name).includes('enfant') || norm(name).includes('kid');
const isVelo = (name: string): boolean => norm(name).includes('velo');

/* Catalogue des formules et tarifs : le prix saisi ici est celui appliqué
   par le Hub à la réservation. Un site sans formule ne peut pas être réservé. */
export default function Formules() {
  const { user, can } = useAuth();
  const { notify } = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [siteId, setSiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [busy, setBusy] = useState(false);
  const [delTarget, setDelTarget] = useState<Activity | null>(null);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('60');
  const [price, setPrice] = useState('25000');
  const [deposit, setDeposit] = useState('0');
  const [maxGroup, setMaxGroup] = useState('10');

  async function loadActivitiesFor(id: string) {
    if (!id) { setActivities([]); return; }
    setActivities(await listActivities(Number(id)));
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const siteList = await listSites();
      setSites(siteList);
      const active = activeSiteId();
      const hasActive = active !== null && siteList.some((s) => s.id === active);
      const next = siteId || String(hasActive ? active : (siteList[0]?.id ?? ''));
      setSiteId(next);
      await loadActivitiesFor(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Catalogue indisponible.');
    } finally {
      setLoading(false);
    }
  }

  async function chooseSite(id: string) {
    setSiteId(id);
    setError('');
    try {
      await loadActivitiesFor(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Catalogue indisponible.');
    }
  }

  useEffect(() => { void load(); }, []);

  const site = sites.find((s) => String(s.id) === siteId) ?? null;
  const current = useMemo(
    () => activities
      .filter((a) => String(a.site) === siteId)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [activities, siteId],
  );

  const siteHint = site
    ? norm(site.name).includes('orpheus')
      ? 'Hôtel Orpheus : quads enfants et vélos uniquement (pas de quad adulte).'
      : norm(site.name).includes('konibabougou')
        ? 'Konibabougou : quads adultes uniquement (pas de vélo ni de quad enfant).'
        : 'Une formule enfant ne peut être créée que sur le site Hôtel Orpheus.'
    : '';

  function openCreate() {
    setEditing(null);
    setName('');
    setDuration('60');
    setPrice('25000');
    setDeposit('0');
    setMaxGroup('10');
    setOpen(true);
  }

  function openEdit(a: Activity) {
    setEditing(a);
    setName(a.name);
    setDuration(String(a.duration_minutes));
    setPrice(String(a.base_price));
    setDeposit(String(a.deposit));
    setMaxGroup(String(a.max_group));
    setOpen(true);
  }

  async function submit() {
    const cleanName = name.trim();
    const mins = Number(duration);
    const basePrice = Number(price);
    const dep = Number(deposit || 0);
    const group = Number(maxGroup);
    if (!siteId) { notify('warning', 'Site requis', 'Choisissez le site de la formule.'); return; }
    if (cleanName.length < 2) { notify('warning', 'Nom requis', 'Saisissez le nom de la formule.'); return; }
    if (!Number.isInteger(mins) || mins < 1) { notify('warning', 'Durée invalide', 'La durée se saisit en minutes (1 minimum).'); return; }
    if (!Number.isInteger(basePrice) || basePrice < 0) { notify('warning', 'Tarif invalide', 'Le tarif est un montant entier en FCFA.'); return; }
    if (!Number.isInteger(dep) || dep < 0) { notify('warning', 'Acompte invalide', 'L’acompte est un montant entier en FCFA.'); return; }
    if (!Number.isInteger(group) || group < 1) { notify('warning', 'Capacité invalide', 'Le groupe maximum doit être au moins 1.'); return; }

    setBusy(true);
    try {
      if (editing) {
        await updateActivity(editing.id, {
          name: cleanName, duration_minutes: mins, base_price: basePrice,
          deposit: dep, max_group: group,
        });
        notify('success', 'Formule modifiée', `${cleanName} — ${fcfa(basePrice)}.`);
      } else {
        await createActivity({
          site: Number(siteId), name: cleanName, duration_minutes: mins,
          base_price: basePrice, deposit: dep, max_group: group,
        });
        notify('success', 'Formule créée', `${cleanName} — ${fcfa(basePrice)}.`);
      }
      setOpen(false);
      await loadActivitiesFor(siteId);
    } catch (e) {
      notify('error', editing ? 'Modification impossible' : 'Création impossible', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!delTarget) return;
    setBusy(true);
    try {
      await deleteActivity(delTarget.id);
      notify('success', 'Formule supprimée', delTarget.name);
      setDelTarget(null);
      await loadActivitiesFor(siteId);
    } catch (e) {
      notify('error', 'Suppression impossible', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  }

  if (!can('responsable', 'admin')) return <Navigate to=".." replace />;

  return (
    <AppShell>
      <PageHeader
        title="Formules & tarifs"
        sub="Le prix affiché ici est celui appliqué par le Hub. Chaque site doit avoir au moins une formule pour être réservé."
        actions={<button type="button" className="btn btn-accent" onClick={openCreate} disabled={!sites.length}>
          <Icon name="plus" size={18} />Nouvelle formule
        </button>}
      />

      {loading && <SkeletonList n={3} />}
      {error && <div className="alert-error" role="alert">{error}</div>}

      {!loading && !error && sites.length === 0 && (
        <EmptyState
          icon="settings"
          title="Aucun site"
          text="Créez d’abord un site dans Paramètres : le catalogue de formules s’y rattache."
        />
      )}

      {!loading && !error && sites.length > 0 && (
        <>
          <section className="card">
            <Field label="Site" htmlFor="fo-site" hint={siteHint || `Connecté : ${user?.username ?? ''}`}>
              <select id="fo-site" value={siteId} onChange={(e) => void chooseSite(e.target.value)}>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <p className="small muted" style={{ marginTop: 10 }}>
              Un site sans aucune formule reçoit automatiquement le catalogue standard au
              démarrage du Hub. Supprimer une formule déjà utilisée par des créneaux est refusé.
            </p>
          </section>

          {current.length === 0 ? (
            <EmptyState
              icon="quad"
              title="Aucune formule sur ce site"
              text="Créez une formule, ou redémarrez le Hub pour installer le catalogue standard."
              action={<button type="button" className="btn btn-primary" onClick={openCreate}>Créer une formule</button>}
            />
          ) : (
            <div className="list">
              {current.map((a) => (
                <article className="row-card" key={a.id}>
                  <div className="row-top">
                    <span className="row-title">{a.name}</span>
                    <span className="badge badge-confirmed">
                      <Icon name="clock" size={14} />{fmtDuration(a.duration_minutes)}
                    </span>
                  </div>
                  <div className="row-meta">
                    <span className="num">{a.base_price > 0 ? fcfa(a.base_price) : 'Sans tarif'}</span>
                    <span>Acompte {fcfa(a.deposit)}</span>
                    <span>Groupe max. {a.max_group}</span>
                  </div>
                  <div className="row-meta">
                    {isKids(a.name) && <span className="badge badge-pending">Enfant</span>}
                    {isVelo(a.name) && <span className="badge badge-confirmed">Vélo</span>}
                    {norm(a.name).startsWith('creneau') && <span className="badge">Créneau libre</span>}
                  </div>
                  <div className="btn-row">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => openEdit(a)}>Modifier</button>
                    <IconButton icon="x" label={`Supprimer ${a.name}`} className="danger plain" onClick={() => setDelTarget(a)} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label={editing ? 'Modifier la formule' : 'Nouvelle formule'} onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? 'Modifier la formule' : 'Nouvelle formule'}</h2>
            <p className="small muted">
              {editing ? `Site : ${site?.name ?? ''}.` : 'La formule et son tarif seront proposés à la réservation.'}
            </p>
            {!editing && (
              <Field label="Site" required htmlFor="fo-form-site" hint={siteHint}>
                <select id="fo-form-site" value={siteId} onChange={(e) => void chooseSite(e.target.value)}>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Nom de la formule" required htmlFor="fo-name">
              <input id="fo-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Quad 1H" />
            </Field>
            <div className="form-2">
              <Field label="Durée (minutes)" required htmlFor="fo-duration">
                <input id="fo-duration" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
              </Field>
              <Field label="Tarif (FCFA)" required htmlFor="fo-price">
                <input id="fo-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <Field label="Acompte (FCFA)" htmlFor="fo-deposit">
                <input id="fo-deposit" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              </Field>
              <Field label="Groupe maximum" htmlFor="fo-group">
                <input id="fo-group" inputMode="numeric" value={maxGroup} onChange={(e) => setMaxGroup(e.target.value)} />
              </Field>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}{editing ? 'Enregistrer' : 'Créer la formule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {delTarget && (
        <ConfirmDialog
          title={`Supprimer la formule « ${delTarget.name} » ?`}
          text="Impossible si des créneaux l’utilisent. La suppression ne touche pas aux réservations déjà enregistrées."
          confirmLabel="Supprimer la formule" danger busy={busy}
          onConfirm={remove}
          onClose={() => !busy && setDelTarget(null)}
        />
      )}
    </AppShell>
  );
}
