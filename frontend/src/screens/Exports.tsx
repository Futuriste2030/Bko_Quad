import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { Field, PageHeader } from '../components/ui';
import { useAuth, type Role } from '../lib/auth';
import {
  downloadExport, listActivities, listSites, todayISO,
  type Activity, type ExportFormat, type Site,
} from '../lib/api';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';

interface Dataset {
  key: string;
  label: string;
  roles: Role[];
  detail: string;
  columns: number;
  site: boolean;
  activity: boolean;
  agent: boolean;
  agentLabel?: string;
}

const DATASETS: Dataset[] = [
  {
    key: 'reservations',
    label: 'Réservations',
    roles: ['agent', 'responsable', 'admin', 'comptable'],
    detail: 'Créneau, formule, client, montants, statut, source et agent ayant saisi la réservation.',
    columns: 19, site: true, activity: true, agent: true,
  },
  {
    key: 'paiements',
    label: 'Paiements',
    roles: ['responsable', 'admin', 'comptable'],
    detail: 'Mouvements espèces ou agrégateur, référence, montant, statut et agent encaisseur.',
    columns: 12, site: true, activity: true, agent: true,
  },
  {
    key: 'caisse',
    label: 'Caisse',
    roles: ['responsable', 'admin', 'comptable'],
    detail: 'Livre de caisse : bordereau, sens, catégorie, justificatif et verrouillage du mois.',
    columns: 12, site: true, activity: true, agent: true,
  },
  {
    key: 'banque',
    label: 'Banque',
    roles: ['responsable', 'admin', 'comptable'],
    detail: 'Versements, retraits et virements reçus, avec bordereau ou référence de chèque.',
    columns: 13, site: true, activity: false, agent: true,
  },
  {
    key: 'factures',
    label: 'Factures',
    roles: ['agent', 'responsable', 'admin', 'comptable'],
    detail: 'Factures émises sur la période, rattachées à leur réservation et à leur site.',
    columns: 8, site: true, activity: true, agent: true,
  },
  {
    key: 'paie',
    label: 'Paie',
    roles: ['admin', 'comptable'],
    detail: 'Fiches mensuelles : base, brut, retenues, net, versements et reste à payer.',
    columns: 12, site: true, activity: false, agent: true,
    agentLabel: 'Employé (nom ou compte)',
  },
  {
    key: 'appels',
    label: 'Appels',
    roles: ['agent', 'responsable', 'admin'],
    detail: 'Journal universel : sens, durée, source et justification des anomalies.',
    columns: 9, site: false, activity: false, agent: false,
  },
];

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function visibleFor(dataset: Dataset, role: Role | null): boolean {
  if (!role) return false;
  return dataset.roles.includes(role) || role === 'admin' || role === 'superadmin';
}

export default function Exports() {
  const { user, role } = useAuth();
  const { notify } = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [dataset, setDataset] = useState('reservations');
  const [start, setStart] = useState(monthStart);
  const [end, setEnd] = useState(todayISO);
  const [site, setSite] = useState('');
  const [activity, setActivity] = useState('');
  const [agent, setAgent] = useState('');
  const [busy, setBusy] = useState<ExportFormat | ''>('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      listSites().catch(() => [] as Site[]),
      listActivities().catch(() => [] as Activity[]),
    ]).then(([s, a]) => { setSites(s); setActivities(a); });
  }, []);

  const visibleDatasets = useMemo(
    () => DATASETS.filter((d) => visibleFor(d, role)),
    [role],
  );
  const current = visibleDatasets.find((d) => d.key === dataset) ?? visibleDatasets[0];

  useEffect(() => {
    if (visibleDatasets.length && !visibleDatasets.some((d) => d.key === dataset)) {
      setDataset(visibleDatasets[0].key);
    }
  }, [dataset, visibleDatasets]);

  const siteLocked = Boolean(user?.site)
    && (role === 'agent' || role === 'guide' || role === 'responsable');

  const activityOptions = useMemo(
    () => activities.filter((a) => !site || String(a.site) === site),
    [activities, site],
  );

  useEffect(() => {
    if (activity && site && !activities.some(
      (a) => String(a.id) === activity && String(a.site) === site,
    )) {
      setActivity('');
    }
  }, [activity, activities, site]);

  async function download(format: ExportFormat) {
    if (!current) return;
    if (!start || !end) {
      setError('Indiquez la date de début et la date de fin.');
      return;
    }
    if (start > end) {
      setError('La date de début doit précéder la date de fin.');
      return;
    }
    setError(''); setBusy(format);
    try {
      await downloadExport({
        dataset: current.key,
        start,
        end,
        site: current.site && !siteLocked && site ? site : undefined,
        activity: current.activity && activity ? activity : undefined,
        agent: current.agent ? agent : undefined,
      }, format);
      notify('success', 'Export téléchargé', `${current.label} — ${start} au ${end}.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Export indisponible.';
      setError(message);
      notify('error', 'Export impossible', message);
    } finally {
      setBusy('');
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Rapports & exports"
        sub="Extrayez les données de la période en CSV ou Excel, selon vos droits et votre site."
      />

      <div className="card form">
        <Field label="Jeu de données" required htmlFor="export-dataset">
          <select
            id="export-dataset"
            value={current?.key ?? ''}
            onChange={(e) => { setDataset(e.target.value); setError(''); }}
          >
            {visibleDatasets.map((d) => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </select>
        </Field>

        <div className="form-2">
          <Field label="Du" required htmlFor="export-start">
            <input
              id="export-start" type="date" value={start}
              onChange={(e) => { setStart(e.target.value); setError(''); }}
            />
          </Field>
          <Field label="Au" required htmlFor="export-end">
            <input
              id="export-end" type="date" value={end}
              onChange={(e) => { setEnd(e.target.value); setError(''); }}
            />
          </Field>
        </div>

        {current?.site && (
          siteLocked ? (
            <Field label="Site" htmlFor="export-site-locked" hint="Site imposé par votre compte.">
              <input id="export-site-locked" value={user?.site_name ?? ''} disabled />
            </Field>
          ) : (
            <Field label="Site" htmlFor="export-site" hint="Laissez vide pour tous les sites.">
              <select
                id="export-site" value={site}
                onChange={(e) => { setSite(e.target.value); setError(''); }}
              >
                <option value="">Tous les sites</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )
        )}

        {current?.activity && (
          <Field label="Activité" htmlFor="export-activity" hint="Laissez vide pour toutes les formules.">
            <select
              id="export-activity" value={activity}
              onChange={(e) => { setActivity(e.target.value); setError(''); }}
            >
              <option value="">Toutes les activités</option>
              {activityOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        )}

        {current?.agent && (
          <Field
            label={current.agentLabel ?? 'Agent'}
            htmlFor="export-agent"
            hint="Nom, prénom ou identifiant. Laissez vide pour tous."
          >
            <input
              id="export-agent" value={agent} maxLength={80}
              onChange={(e) => { setAgent(e.target.value); setError(''); }}
              placeholder="Ex. Awa ou agentA"
            />
          </Field>
        )}

        <div className="btn-row">
          <button
            type="button" className="btn btn-primary"
            onClick={() => download('csv')} disabled={Boolean(busy) || !current}
          >
            {busy === 'csv'
              ? <span className="caret" aria-hidden="true" />
              : <Icon name="download" size={18} />}
            Télécharger CSV
          </button>
          <button
            type="button" className="btn btn-ghost"
            onClick={() => download('xlsx')} disabled={Boolean(busy) || !current}
          >
            {busy === 'xlsx'
              ? <span className="caret" aria-hidden="true" />
              : <Icon name="file" size={18} />}
            Télécharger Excel
          </button>
        </div>

        {error && <div className="alert-error" role="alert">{error}</div>}
        <p className="small muted">
          Fuseau Africa/Bamako, montants FCFA entiers. Un export ne modifie aucune donnée.
        </p>
      </div>

      {current && (
        <div className="card">
          <div className="row-top">
            <span className="row-title">{current.label}</span>
            <span className="badge">{current.columns} colonnes</span>
          </div>
          <p>{current.detail}</p>
          <p className="small muted">
            Les reçus, factures et rapports bancaires PDF restent disponibles dans
            leurs écrans respectifs.
          </p>
        </div>
      )}
    </AppShell>
  );
}
