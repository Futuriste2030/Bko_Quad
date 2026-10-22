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
  createHRLetter, downloadPdf, listContracts, listEmployees, listHRLetters, todayISO,
  updateHRLetter, type Contract, type Employee, type HRLetter, type HRLetterInput,
} from '../lib/api';
import { fcfa } from '../lib/format';

const LETTER_KINDS: Array<{ value: HRLetter['kind']; label: string }> = [
  { value: 'promotion', label: 'Promotion' },
  { value: 'augmentation', label: 'Augmentation de salaire' },
  { value: 'prime', label: 'Prime spéciale' },
  { value: 'attestation', label: 'Attestation de travail' },
  { value: 'autre', label: 'Autre courrier' },
];

type Draft = {
  id?: number;
  reference: string;
  employee: string;
  contract: string;
  kind: HRLetter['kind'];
  title: string;
  date: string;
  amount: string;
  new_salary: string;
  new_job_title: string;
  effective_date: string;
  content: string;
  original_content: string;
};

function toDraft(letter?: HRLetter, firstEmployee?: Employee): Draft {
  const content = toEditorHtml(letter?.content ?? '');
  return {
    id: letter?.id,
    reference: letter?.reference ?? 'Brouillon',
    employee: letter ? String(letter.employee) : (firstEmployee ? String(firstEmployee.id) : ''),
    contract: letter?.contract ? String(letter.contract) : '',
    kind: letter?.kind ?? 'augmentation',
    title: letter?.title ?? '',
    date: letter?.date ?? todayISO(),
    amount: letter?.amount ? String(letter.amount) : '',
    new_salary: letter?.new_salary ? String(letter.new_salary) : '',
    new_job_title: letter?.new_job_title ?? '',
    effective_date: letter?.effective_date ?? '',
    content,
    original_content: content,
  };
}

function kindLabel(value: HRLetter['kind']): string {
  return LETTER_KINDS.find((kind) => kind.value === value)?.label ?? value;
}

/* Page dédiée à la rédaction d'un courrier RH : formulaire et éditeur riche
   à gauche, aperçu papier à droite, sur le modèle du Hub Digi. */
export default function HRLetterEditor() {
  const { id } = useParams();
  const editingId = id && id !== 'nouveau' ? Number(id) : null;
  const navigate = useNavigate();
  const link = useSiteLink();
  const { company } = useCompany();
  const { notify } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
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
    Promise.all([listHRLetters(), listEmployees(), listContracts()])
      .then(([letters, people, allContracts]) => {
        if (!alive) return;
        setEmployees(people);
        setContracts(allContracts);
        if (!editingId) {
          setDraft(toDraft(undefined, people[0]));
          return;
        }
        const found = letters.find((letter) => letter.id === editingId);
        if (!found) {
          setError('Courrier introuvable ou supprimé.');
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
  const employeeContracts = useMemo(
    () => contracts.filter((contract) => String(contract.employee) === draft?.employee),
    [contracts, draft?.employee],
  );

  const title = editingId ? 'Modifier le courrier' : 'Nouveau courrier';

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
    if (draft.kind === 'prime' && (!draft.amount || Number(draft.amount) <= 0)) {
      notify('warning', 'Montant requis', 'Indiquez le montant de la prime.');
      return;
    }
    if (draft.kind === 'augmentation' && (!draft.new_salary || Number(draft.new_salary) <= 0)) {
      notify('warning', 'Nouveau salaire requis', 'Indiquez le nouveau salaire de base.');
      return;
    }
    if (draft.kind === 'promotion' && !draft.new_job_title.trim()) {
      notify('warning', 'Nouveau poste requis', 'Indiquez le nouveau poste.');
      return;
    }
    setBusy(true);
    try {
      const payload: HRLetterInput = {
        employee: Number(draft.employee),
        contract: draft.contract ? Number(draft.contract) : null,
        kind: draft.kind,
        title: draft.title.trim(),
        date: draft.date,
        amount: draft.kind === 'prime' ? Math.round(Number(draft.amount)) : null,
        new_salary: draft.kind === 'augmentation' ? Math.round(Number(draft.new_salary)) : null,
        new_job_title: draft.kind === 'promotion' ? draft.new_job_title.trim() : '',
        effective_date: draft.effective_date || null,
      };
      if (!draft.id || draft.content !== draft.original_content) payload.content = draft.content;
      if (draft.id) {
        const saved = await updateHRLetter(draft.id, payload);
        setDraft(toDraft(saved));
        setEditorKey((key) => key + 1);
        notify('success', 'Courrier modifié', 'Le brouillon est à jour.');
      } else {
        const saved = await createHRLetter(payload);
        notify('success', 'Courrier créé', 'Le texte est généré automatiquement si laissé vide.');
        navigate(link(`/rh/courriers/${saved.id}`), { replace: true });
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
      await downloadPdf(`/hr-letters/${draft.id}/pdf/`, `${draft.reference}-apercu.pdf`);
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
          title={readOnly ? 'Courrier non modifiable' : 'Courrier indisponible'}
          text={readOnly
            ? 'Ce courrier est déjà envoyé en signature ou signé : son texte ne peut plus être modifié.'
            : (error || 'Courrier introuvable.')}
          action={<Link className="btn btn-primary" to={link('/rh')}>Retour aux courriers</Link>}
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
          text="Créez d'abord un salarié dans la rubrique RH, puis revenez rédiger son courrier."
          action={<Link className="btn btn-primary" to={link('/rh')}>Retour aux courriers</Link>}
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
            <button type="submit" form="hr-letter-form" className="btn btn-primary" disabled={busy}>
              {busy && <span className="caret" aria-hidden="true" />}
              <Icon name="check" size={18} />Enregistrer
            </button>
          </>
        )}
      />

      <div className="hr-editor-grid">
        <form id="hr-letter-form" className="card form hr-editor-form" onSubmit={save}>
          <div className="hr-editor-fields">
            <Field label="Salarié" required htmlFor="hr-l-employee">
              <select
                id="hr-l-employee"
                value={draft.employee}
                onChange={(event) => {
                  update('employee', event.target.value);
                  update('contract', '');
                }}
              >
                <option value="">Choisir…</option>
                {employees.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.has_account ? '' : ' (sans compte)'}</option>
                ))}
              </select>
            </Field>
            <Field label="Contrat lié" hint="Une augmentation ou une promotion avec contrat met à jour le salaire ou le poste après signature." htmlFor="hr-l-contract">
              <select id="hr-l-contract" value={draft.contract} onChange={(event) => update('contract', event.target.value)}>
                <option value="">Aucun</option>
                {employeeContracts.map((contract) => (
                  <option key={contract.id} value={contract.id}>{contract.reference} — {contract.contract_type_label}</option>
                ))}
              </select>
            </Field>
            <Field label="Type de courrier" htmlFor="hr-l-kind">
              <select id="hr-l-kind" value={draft.kind} onChange={(event) => update('kind', event.target.value as HRLetter['kind'])}>
                {LETTER_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
              </select>
            </Field>
            <Field label="Titre" hint="Laissez vide pour utiliser le type de courrier." htmlFor="hr-l-title">
              <input id="hr-l-title" value={draft.title} onChange={(event) => update('title', event.target.value)} />
            </Field>
            <Field label="Date du courrier" htmlFor="hr-l-date">
              <input id="hr-l-date" type="date" value={draft.date} onChange={(event) => update('date', event.target.value)} />
            </Field>
            <Field label="Date d'effet" htmlFor="hr-l-effective">
              <input id="hr-l-effective" type="date" value={draft.effective_date} onChange={(event) => update('effective_date', event.target.value)} />
            </Field>
            {draft.kind === 'prime' && (
              <Field label="Montant de la prime (FCFA)" required htmlFor="hr-l-amount">
                <input id="hr-l-amount" inputMode="numeric" value={draft.amount} onChange={(event) => update('amount', event.target.value)} />
              </Field>
            )}
            {draft.kind === 'augmentation' && (
              <Field label="Nouveau salaire de base (FCFA)" required htmlFor="hr-l-salary">
                <input id="hr-l-salary" inputMode="numeric" value={draft.new_salary} onChange={(event) => update('new_salary', event.target.value)} />
              </Field>
            )}
            {draft.kind === 'promotion' && (
              <Field label="Nouveau poste" required htmlFor="hr-l-job">
                <input id="hr-l-job" value={draft.new_job_title} onChange={(event) => update('new_job_title', event.target.value)} />
              </Field>
            )}
          </div>

          <Field label="Texte du courrier" hint="Sélectionnez le texte puis utilisez la barre d'outils. Laissez vide pour générer le modèle." htmlFor="hr-l-content">
            <RichTextEditor
              key={`letter-${draft.id ?? 'new'}-${editorKey}`}
              id="hr-l-content"
              value={draft.content}
              placeholder="Le modèle de courrier sera généré si ce champ reste vide."
              onChange={(content) => update('content', content)}
            />
          </Field>
        </form>

        <aside className="hr-editor-preview" aria-label="Aperçu du courrier">
          <div className="card hr-paper">
            <CompanyHeader
              title={draft.title.trim() || kindLabel(draft.kind)}
              sub={`${draft.id ? draft.reference : 'Brouillon'} — ${draft.date || 'date à définir'}`}
            />
            <div className="hr-paper-body">
              <p className="small muted">À l'attention de :</p>
              <p><strong>{employee?.name || 'Salarié à sélectionner'}</strong>{employee?.role ? ` — ${employee.role}` : ''}</p>
              <ul className="hr-meta">
                <li>Type : {kindLabel(draft.kind)}</li>
                {draft.effective_date && <li>Effet : {draft.effective_date}</li>}
                {draft.kind === 'prime' && draft.amount && <li>Prime : {fcfa(Number(draft.amount))}</li>}
                {draft.kind === 'augmentation' && draft.new_salary && <li>Nouveau salaire : {fcfa(Number(draft.new_salary))}</li>}
                {draft.kind === 'promotion' && draft.new_job_title && <li>Nouveau poste : {draft.new_job_title}</li>}
              </ul>
              <div className="hr-paper-title">{kindLabel(draft.kind)}</div>
              {!richTextIsEmpty(draft.content) ? (
                <RichTextView value={draft.content} className="hr-content" label="Texte du courrier" />
              ) : (
                <p className="small muted">
                  Le texte du courrier apparaîtra ici. Laissez le champ vide pour que le modèle soit généré à l'enregistrement.
                </p>
              )}
              <div className="hr-signatures">
                <div className="hr-sign-box">
                  <strong className="small">La direction</strong>
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
