import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import RichTextEditor from '../components/RichTextEditor';
import RichTextView from '../components/RichTextView';
import { CompanyFooter, CompanyHeader } from '../components/CompanyDoc';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useCompany } from '../lib/company';
import { richTextIsEmpty, toEditorHtml } from '../lib/richText';
import { useSiteLink } from '../lib/sitepath';
import { useToast } from '../lib/toast';
import {
  createContract, downloadPdf, listContracts, listEmployees, todayISO, updateContract,
  type Contract, type ContractInput, type Employee,
} from '../lib/api';

const CONTRACT_TYPES = [
  { value: 'cdi', label: 'CDI — durée indéterminée' },
  { value: 'cdd', label: 'CDD — durée déterminée' },
  { value: 'stage', label: 'Stage' },
  { value: 'apprentissage', label: 'Apprentissage' },
  { value: 'autre', label: 'Autre' },
];

type Draft = {
  id?: number;
  reference: string;
  employee: string;
  contract_type: string;
  start: string;
  end: string;
  base_salary: string;
  job_title: string;
  workplace: string;
  weekly_hours: string;
  trial_months: string;
  content: string;
  original_content: string;
};

function toDraft(contract?: Contract, firstEmployee?: Employee): Draft {
  const content = toEditorHtml(contract?.content ?? '');
  return {
    id: contract?.id,
    reference: contract?.reference ?? 'Brouillon',
    employee: contract ? String(contract.employee) : (firstEmployee ? String(firstEmployee.id) : ''),
    contract_type: contract?.contract_type ?? 'cdi',
    start: contract?.start ?? todayISO(),
    end: contract?.end ?? '',
    base_salary: contract ? String(contract.base_salary) : '',
    job_title: contract?.job_title ?? '',
    workplace: contract?.workplace ?? '',
    weekly_hours: contract ? String(contract.weekly_hours) : '40',
    trial_months: contract ? String(contract.trial_months) : '0',
    content,
    original_content: content,
  };
}

function typeLabel(value: string): string {
  return CONTRACT_TYPES.find((type) => type.value === value)?.label ?? value;
}

/* Page dédiée à la rédaction d'un contrat, sur le modèle du Hub Digi :
   formulaire et éditeur riche à gauche, aperçu papier à droite. */
export default function HRContractEditor() {
  const { id } = useParams();
  const editingId = id && id !== 'nouveau' ? Number(id) : null;
  const navigate = useNavigate();
  const link = useSiteLink();
  const { company } = useCompany();
  const { notify } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setReadOnly(false);
    Promise.all([listContracts(), listEmployees()])
      .then(([contracts, people]) => {
        if (!alive) return;
        setEmployees(people);
        if (!editingId) {
          setDraft(toDraft(undefined, people[0]));
          return;
        }
        const found = contracts.find((contract) => contract.id === editingId);
        if (!found) {
          setError('Contrat introuvable ou supprimé.');
          setDraft(null);
          return;
        }
        if (found.status !== 'draft') {
          setReadOnly(true);
          setDraft(null);
          return;
        }
        setDraft(toDraft(found));
        setEditorKey((key) => key + 1);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [editingId]);

  const employee = useMemo(
    () => employees.find((item) => String(item.id) === draft?.employee) ?? null,
    [employees, draft?.employee],
  );

  const title = editingId ? 'Modifier le contrat' : 'Nouveau contrat';

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.employee) {
      notify('warning', 'Salarié requis', 'Choisissez le salarié.');
      return;
    }
    if (!draft.start) {
      notify('warning', 'Date de début requise', 'Indiquez le début du contrat.');
      return;
    }
    if (!draft.base_salary || Number(draft.base_salary) <= 0) {
      notify('warning', 'Salaire requis', 'Indiquez un salaire de base en FCFA.');
      return;
    }
    setBusy(true);
    try {
      const payload: ContractInput = {
        employee: Number(draft.employee),
        start: draft.start,
        end: draft.end || null,
        base_salary: Math.round(Number(draft.base_salary)),
        contract_type: draft.contract_type,
        job_title: draft.job_title.trim(),
        workplace: draft.workplace.trim(),
        weekly_hours: Number(draft.weekly_hours) || 40,
        trial_months: Number(draft.trial_months) || 0,
      };
      if (!draft.id || draft.content !== draft.original_content) payload.content = draft.content;
      if (draft.id) {
        const saved = await updateContract(draft.id, payload);
        setDraft(toDraft(saved));
        setEditorKey((key) => key + 1);
        notify('success', 'Contrat modifié', 'Le brouillon est à jour.');
      } else {
        const saved = await createContract(payload);
        notify('success', 'Contrat créé', 'Le texte est généré automatiquement si laissé vide.');
        navigate(link(`/rh/contrats/${saved.id}`), { replace: true });
      }
    } catch (err) {
      notify('error', 'Enregistrement impossible', err instanceof Error ? err.message : '');
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!draft?.id) return;
    try {
      await downloadPdf(`/contracts/${draft.id}/pdf/`, `${draft.reference}-apercu.pdf`);
    } catch (err) {
      notify('error', 'PDF indisponible', err instanceof Error ? err.message : '');
    }
  }

  if (loading) {
    return <AppShell><PageHeader title={title} sub="Préparation du document…" /><SkeletonList /></AppShell>;
  }

  if (error || readOnly || !draft) {
    return (
      <AppShell>
        <PageHeader title={title} />
        <EmptyState
          icon="file"
          title={readOnly ? 'Contrat non modifiable' : 'Contrat indisponible'}
          text={readOnly
            ? 'Ce contrat est déjà envoyé en signature ou signé : son texte ne peut plus être modifié.'
            : (error || 'Contrat introuvable.')}
          action={<Link className="btn btn-primary" to={link('/rh')}>Retour aux contrats</Link>}
        />
      </AppShell>
    );
  }

  if (employees.length === 0) {
    return (
      <AppShell>
        <PageHeader title={title} />
        <EmptyState
          icon="users"
          title="Aucun salarié"
          text="Créez d'abord un salarié dans la rubrique RH, puis revenez rédiger son contrat."
          action={<Link className="btn btn-primary" to={link('/rh')}>Retour aux contrats</Link>}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title={title}
        sub={draft.id ? `${draft.reference} — le texte est figé dès l'envoi en signature.` : 'Le texte est généré automatiquement si vous le laissez vide.'}
        actions={(
          <>
            <Link className="btn btn-ghost" to={link('/rh')}>Retour</Link>
            {draft.id && (
              <button type="button" className="btn btn-ghost" onClick={() => void preview()}>
                <Icon name="download" size={18} />Aperçu PDF
              </button>
            )}
            <button type="submit" form="hr-contract-form" className="btn btn-primary" disabled={busy}>
              {busy && <span className="caret" aria-hidden="true" />}
              <Icon name="check" size={18} />Enregistrer
            </button>
          </>
        )}
      />

      <div className="hr-editor-grid">
        <form id="hr-contract-form" className="card form hr-editor-form" onSubmit={save}>
          <div className="hr-editor-fields">
            <Field label="Salarié" required htmlFor="hr-c-employee">
              <select id="hr-c-employee" value={draft.employee} onChange={(event) => update('employee', event.target.value)}>
                <option value="">Choisir…</option>
                {employees.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.has_account ? '' : ' (sans compte)'}</option>
                ))}
              </select>
            </Field>
            <Field label="Type de contrat" htmlFor="hr-c-type">
              <select id="hr-c-type" value={draft.contract_type} onChange={(event) => update('contract_type', event.target.value)}>
                {CONTRACT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </Field>
            <Field label="Date de début" required htmlFor="hr-c-start">
              <input id="hr-c-start" type="date" value={draft.start} onChange={(event) => update('start', event.target.value)} />
            </Field>
            <Field label="Date de fin" hint="Vide pour un CDI." htmlFor="hr-c-end">
              <input id="hr-c-end" type="date" value={draft.end} onChange={(event) => update('end', event.target.value)} />
            </Field>
            <Field label="Salaire de base (FCFA)" required htmlFor="hr-c-salary">
              <input id="hr-c-salary" inputMode="numeric" value={draft.base_salary} onChange={(event) => update('base_salary', event.target.value)} placeholder="150000" />
            </Field>
            <Field label="Poste" htmlFor="hr-c-job">
              <input id="hr-c-job" value={draft.job_title} onChange={(event) => update('job_title', event.target.value)} placeholder="Laissez vide pour reprendre le rôle" />
            </Field>
            <Field label="Lieu de travail" htmlFor="hr-c-place">
              <input id="hr-c-place" value={draft.workplace} onChange={(event) => update('workplace', event.target.value)} placeholder="Laissez vide pour reprendre le site" />
            </Field>
            <Field label="Heures par semaine" htmlFor="hr-c-hours">
              <input id="hr-c-hours" inputMode="numeric" value={draft.weekly_hours} onChange={(event) => update('weekly_hours', event.target.value)} />
            </Field>
            <Field label="Période d'essai (mois)" htmlFor="hr-c-trial">
              <input id="hr-c-trial" inputMode="numeric" value={draft.trial_months} onChange={(event) => update('trial_months', event.target.value)} />
            </Field>
          </div>

          <Field label="Texte du contrat" hint="Sélectionnez le texte puis utilisez la barre d'outils. Laissez vide pour générer le modèle." htmlFor="hr-c-content">
            <RichTextEditor
              key={`contract-${draft.id ?? 'new'}-${editorKey}`}
              id="hr-c-content"
              value={draft.content}
              placeholder="Le modèle de contrat sera généré si ce champ reste vide."
              onChange={(content) => update('content', content)}
            />
          </Field>
        </form>

        <aside className="hr-editor-preview" aria-label="Aperçu du contrat">
          <div className="card hr-paper">
            <CompanyHeader
              title="Contrat de travail"
              sub={`${typeLabel(draft.contract_type)}${draft.id ? ` — ${draft.reference}` : ' — brouillon'}`}
            />
            <div className="hr-paper-body">
              <p className="small muted">Entre les soussignés :</p>
              <p><strong>{company.name}</strong>{company.address ? `, ${company.address}` : ''}</p>
              <p><strong>{employee?.name || 'Salarié à sélectionner'}</strong>{employee?.role ? ` — ${employee.role}` : ''}</p>
              <p className="small muted">
                Début : {draft.start || 'à définir'}
                {draft.end ? ` — Fin : ${draft.end}` : ' — Durée indéterminée'}
                {draft.weekly_hours ? ` — ${draft.weekly_hours} h/semaine` : ''}
              </p>
              <div className="hr-paper-title">{typeLabel(draft.contract_type)}</div>
              {!richTextIsEmpty(draft.content) ? (
                <RichTextView value={draft.content} className="hr-content" label="Texte du contrat" />
              ) : (
                <p className="small muted">
                  Le texte du contrat apparaîtra ici. Laissez le champ vide pour que le modèle soit généré à l'enregistrement.
                </p>
              )}
              <div className="hr-signatures">
                <div className="hr-sign-box">
                  <strong className="small">L'employeur</strong>
                  <p className="small muted">{company.name}</p>
                </div>
                <div className="hr-sign-box">
                  <strong className="small">Le salarié</strong>
                  <p className="small muted">{employee?.name || '—'}</p>
                </div>
              </div>
            </div>
            <CompanyFooter showConditions={false} />
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
