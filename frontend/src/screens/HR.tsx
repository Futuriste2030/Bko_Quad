import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { ConfirmDialog, EmptyState, Field, PageHeader, Portal, SkeletonList } from '../components/ui';
import Icon, { type IconName } from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useSiteLink } from '../lib/sitepath';
import { useToast } from '../lib/toast';
import {
  createEmployee, deleteHRDocument, downloadPdf, listContracts, listEmployees,
  listHRLetters, listHRUsers, listSites, sendHRDocument, updateEmployee,
  type Contract, type Employee, type HRLetter, type HRUser, type Site,
} from '../lib/api';
import { fcfa, fmtDate } from '../lib/format';

type Tab = 'contracts' | 'letters' | 'employees';
type DocumentKind = 'contracts' | 'hr-letters';

interface EmployeeDraft {
  id?: number; name: string; role: string; site: string; user: string; active: boolean;
}

const STATUS_RANK: Record<string, number> = {
  pending_signature: 0, draft: 1, signed: 2, cancelled: 3,
};

function StatusBadge({ status, label }: { status: string; label: string }) {
  const icon: IconName = status === 'signed' ? 'check'
    : status === 'pending_signature' ? 'clock'
    : status === 'cancelled' ? 'x' : 'file';
  return (
    <span className={`badge badge-${status}`}>
      <Icon name={icon} size={14} />{label}
    </span>
  );
}

function dateLabel(value: string | null): string {
  return value ? fmtDate(value) : '—';
}

function letterTitle(letter: HRLetter): string {
  return letter.title || letter.kind_label;
}

/* RH : employés, contrats et courriers. La rédaction des contrats et
   courriers se fait sur une page dédiée avec éditeur de texte enrichi. */
export default function HR() {
  const { user } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const link = useSiteLink();
  const [tab, setTab] = useState<Tab>('contracts');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [letters, setLetters] = useState<HRLetter[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [users, setUsers] = useState<HRUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EmployeeDraft | null>(null);
  const [toSend, setToSend] = useState<{ kind: DocumentKind; document: Contract | HRLetter } | null>(null);
  const [toDelete, setToDelete] = useState<{ kind: DocumentKind; document: Contract | HRLetter } | null>(null);

  function load() {
    setLoading(true); setError('');
    Promise.all([
      listContracts().catch(() => [] as Contract[]),
      listHRLetters().catch(() => [] as HRLetter[]),
      listEmployees().catch(() => [] as Employee[]),
      listSites().catch(() => [] as Site[]),
      listHRUsers().catch(() => [] as HRUser[]),
    ]).then(([c, l, e, s, u]) => {
      setContracts(c); setLetters(l); setEmployees(e); setSites(s);
      setUsers(u.filter((x) => !x.is_superuser && x.role !== 'client'));
    }).catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedContracts = useMemo(() => [...contracts].sort((a, b) => {
    const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    return rank || b.start.localeCompare(a.start);
  }), [contracts]);

  const sortedLetters = useMemo(() => [...letters].sort((a, b) => {
    const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    return rank || b.date.localeCompare(a.date);
  }), [letters]);

  const pendingContracts = contracts.filter((c) => c.status === 'pending_signature').length;
  const pendingLetters = letters.filter((l) => l.status === 'pending_signature').length;

  function openEmployee(employee?: Employee) {
    setEditor({
      id: employee?.id,
      name: employee?.name ?? '',
      role: employee?.role ?? 'agent',
      site: employee?.site ? String(employee.site) : (user?.site ? String(user.site) : ''),
      user: employee?.user ? String(employee.user) : '',
      active: employee?.active ?? true,
    });
  }

  async function saveEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!editor) return;
    if (!editor.name.trim()) { notify('warning', 'Nom requis', 'Écrivez le nom du salarié.'); return; }
    setBusy(true);
    try {
      const payload = {
        name: editor.name.trim(), role: editor.role.trim() || 'agent',
        site: editor.site ? Number(editor.site) : null,
        user: editor.user ? Number(editor.user) : null, active: editor.active,
      };
      if (editor.id) await updateEmployee(editor.id, payload);
      else await createEmployee(payload);
      notify('success', editor.id ? 'Salarié modifié' : 'Salarié ajouté',
        editor.user ? 'Il pourra signer ses documents depuis son espace.' : 'Liez un compte pour la signature électronique.');
      setEditor(null);
      setTab('employees');
      load();
    } catch (err) {
      notify('error', 'Enregistrement impossible', err instanceof Error ? err.message : '');
    } finally { setBusy(false); }
  }

  async function confirmSend() {
    if (!toSend) return;
    setBusy(true);
    try {
      await sendHRDocument(toSend.kind, toSend.document.id);
      notify('success', 'Envoyé en signature',
        `${toSend.document.reference} — l'entreprise a signé, le salarié doit signer.`);
      setToSend(null);
      load();
    } catch (err) {
      notify('error', 'Envoi impossible', err instanceof Error ? err.message : '');
    } finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await deleteHRDocument(toDelete.kind, toDelete.document.id);
      notify('success', 'Brouillon supprimé', toDelete.document.reference);
      setToDelete(null);
      load();
    } catch (err) {
      notify('error', 'Suppression impossible', err instanceof Error ? err.message : '');
    } finally { setBusy(false); }
  }

  async function preview(kind: DocumentKind, document: Contract | HRLetter) {
    try {
      await downloadPdf(`/${kind}/${document.id}/pdf/`,
        `${document.reference}${document.has_pdf ? '' : '-apercu'}.pdf`);
    } catch (err) {
      notify('error', 'PDF indisponible', err instanceof Error ? err.message : '');
    }
  }

  function contractActions(contract: Contract) {
    return (
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={() => void preview('contracts', contract)}>
          <Icon name="download" size={18} />{contract.has_pdf ? 'PDF signé' : 'Aperçu'}
        </button>
        {contract.status === 'draft' && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => navigate(link(`/rh/contrats/${contract.id}`))}>
              Modifier
            </button>
            <button type="button" className="btn btn-primary" disabled={!contract.employee_user || busy}
              title={contract.employee_user ? '' : 'Liez un compte de connexion à ce salarié.'}
              onClick={() => setToSend({ kind: 'contracts', document: contract })}>
              Envoyer en signature
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setToDelete({ kind: 'contracts', document: contract })}>
              Supprimer
            </button>
          </>
        )}
      </div>
    );
  }

  function letterActions(letter: HRLetter) {
    return (
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={() => void preview('hr-letters', letter)}>
          <Icon name="download" size={18} />{letter.has_pdf ? 'PDF signé' : 'Aperçu'}
        </button>
        {letter.status === 'draft' && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => navigate(link(`/rh/courriers/${letter.id}`))}>
              Modifier
            </button>
            <button type="button" className="btn btn-primary" disabled={!letter.employee_user || busy}
              title={letter.employee_user ? '' : 'Liez un compte de connexion à ce salarié.'}
              onClick={() => setToSend({ kind: 'hr-letters', document: letter })}>
              Envoyer en signature
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setToDelete({ kind: 'hr-letters', document: letter })}>
              Supprimer
            </button>
          </>
        )}
      </div>
    );
  }

  const linkedUsers = new Set(employees
    .filter((e) => e.user && e.id !== editor?.id)
    .map((e) => e.user as number));
  const availableUsers = users.filter((u) => !linkedUsers.has(u.id));

  const newContract = () => navigate(link('/rh/contrats/nouveau'));
  const newLetter = () => navigate(link('/rh/courriers/nouveau'));

  return (
    <AppShell>
      <PageHeader
        title="Contrats & courriers"
        sub="Rédigez, envoyez en signature et conservez les documents RH signés."
        actions={tab === 'contracts'
          ? <button type="button" className="btn btn-primary" onClick={newContract}><Icon name="plus" size={18} />Nouveau contrat</button>
          : tab === 'letters'
            ? <button type="button" className="btn btn-primary" onClick={newLetter}><Icon name="plus" size={18} />Nouveau courrier</button>
            : <button type="button" className="btn btn-primary" onClick={() => openEmployee()}><Icon name="plus" size={18} />Nouveau salarié</button>}
      />

      <div className="segmented" role="tablist" aria-label="Rubriques RH">
        <button type="button" role="tab" className="chip" aria-pressed={tab === 'contracts'} onClick={() => setTab('contracts')}>
          Contrats {pendingContracts > 0 && <span className="count num">{pendingContracts}</span>}
        </button>
        <button type="button" role="tab" className="chip" aria-pressed={tab === 'letters'} onClick={() => setTab('letters')}>
          Courriers {pendingLetters > 0 && <span className="count num">{pendingLetters}</span>}
        </button>
        <button type="button" role="tab" className="chip" aria-pressed={tab === 'employees'} onClick={() => setTab('employees')}>
          Salariés <span className="count num">{employees.length}</span>
        </button>
      </div>

      {loading && <SkeletonList />}
      {!loading && error && <div className="card"><p className="error" role="alert">{error}</p></div>}

      {!loading && !error && tab === 'contracts' && (
        <>
          {sortedContracts.length === 0 && (
            <EmptyState icon="file" title="Aucun contrat"
              text="Créez un contrat pour un salarié, puis envoyez-le en signature depuis son espace."
              action={<button type="button" className="btn btn-primary" onClick={newContract}>Nouveau contrat</button>} />
          )}
          {sortedContracts.map((c) => (
            <article className="card hr-doc" key={c.id}>
              <div className="row-top">
                <div>
                  <strong>{c.employee_name}</strong>
                  <div className="small muted">{c.reference} — {c.contract_type_label}</div>
                </div>
                <StatusBadge status={c.status} label={c.status_label} />
              </div>
              <ul className="hr-meta">
                <li>Poste : {c.job_title || c.employee_role}</li>
                <li>Salaire : {fcfa(c.base_salary)}</li>
                <li>Début : {dateLabel(c.start)}{c.end ? ` — fin : ${dateLabel(c.end)}` : ' — durée indéterminée'}</li>
                <li>Compte : {c.employee_user ? 'relié pour la signature' : 'non relié — signature impossible'}</li>
              </ul>
              {c.status === 'signed' && (
                <p className="small muted">Signé le {dateLabel(c.signed_at)} par {c.employee_signer_name || c.employee_name}.</p>
              )}
              {c.status === 'draft' && !c.employee_user && (
                <p className="small muted">Liez un compte de connexion au salarié avant l'envoi.</p>
              )}
              {contractActions(c)}
            </article>
          ))}
        </>
      )}

      {!loading && !error && tab === 'letters' && (
        <>
          {sortedLetters.length === 0 && (
            <EmptyState icon="file" title="Aucun courrier"
              text="Promotion, augmentation, prime spéciale ou attestation : rédigez puis envoyez en signature."
              action={<button type="button" className="btn btn-primary" onClick={newLetter}>Nouveau courrier</button>} />
          )}
          {sortedLetters.map((letter) => (
            <article className="card hr-doc" key={letter.id}>
              <div className="row-top">
                <div>
                  <strong>{letterTitle(letter)}</strong>
                  <div className="small muted">{letter.reference} — {letter.employee_name}</div>
                </div>
                <StatusBadge status={letter.status} label={letter.status_label} />
              </div>
              <ul className="hr-meta">
                <li>{letter.kind_label} — daté du {dateLabel(letter.date)}</li>
                {letter.effective_date && <li>Effet : {dateLabel(letter.effective_date)}</li>}
                {letter.amount ? <li>Prime : {fcfa(letter.amount)}</li> : null}
                {letter.new_salary ? <li>Nouveau salaire : {fcfa(letter.new_salary)}</li> : null}
                {letter.new_job_title ? <li>Nouveau poste : {letter.new_job_title}</li> : null}
                {letter.contract_reference && <li>Contrat : {letter.contract_reference}</li>}
              </ul>
              {letter.status === 'signed' && (
                <p className="small muted">Signé le {dateLabel(letter.signed_at)} par {letter.employee_signer_name || letter.employee_name}.</p>
              )}
              {letter.status === 'draft' && !letter.employee_user && (
                <p className="small muted">Liez un compte de connexion au salarié avant l'envoi.</p>
              )}
              {letterActions(letter)}
            </article>
          ))}
        </>
      )}

      {!loading && !error && tab === 'employees' && (
        <>
          {employees.length === 0 && (
            <EmptyState icon="users" title="Aucun salarié"
              text="Ajoutez les membres de l'équipe, puis reliez chaque compte de connexion."
              action={<button type="button" className="btn btn-primary" onClick={() => openEmployee()}>Nouveau salarié</button>} />
          )}
          {employees.map((e) => (
            <article className="card hr-doc" key={e.id}>
              <div className="row-top">
                <div>
                  <strong>{e.name}</strong>
                  <div className="small muted">{e.role}{e.site_name ? ` — ${e.site_name}` : ''}</div>
                </div>
                <span className={`badge ${e.active ? 'badge-signed' : 'badge-cancelled'}`}>
                  <Icon name={e.active ? 'check' : 'x'} size={14} />{e.active ? 'Actif' : 'Inactif'}
                </span>
              </div>
              <ul className="hr-meta">
                <li>Compte : {e.has_account ? e.user_name : 'non lié (signature impossible)'}</li>
              </ul>
              <div className="btn-row">
                <button type="button" className="btn btn-ghost" onClick={() => openEmployee(e)}>Modifier</button>
              </div>
            </article>
          ))}
        </>
      )}

      {editor && (
        <Portal>
          <div className="modal-backdrop" onClick={() => !busy && setEditor(null)}>
            <form className="modal form" role="dialog" aria-modal="true" aria-label="Salarié"
              onClick={(ev) => ev.stopPropagation()} onSubmit={saveEmployee}>
              <h2>{editor.id ? 'Modifier le salarié' : 'Nouveau salarié'}</h2>
              <Field label="Nom complet" required htmlFor="hr-e-name">
                <input id="hr-e-name" value={editor.name} onChange={(ev) => setEditor({ ...editor, name: ev.target.value })} autoComplete="name" />
              </Field>
              <Field label="Poste / rôle" htmlFor="hr-e-role">
                <input id="hr-e-role" value={editor.role} onChange={(ev) => setEditor({ ...editor, role: ev.target.value })} placeholder="agent, guide, responsable…" />
              </Field>
              <Field label="Site" htmlFor="hr-e-site">
                <select id="hr-e-site" value={editor.site} onChange={(ev) => setEditor({ ...editor, site: ev.target.value })}>
                  <option value="">Aucun</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Compte de connexion" hint="Obligatoire pour que le salarié signe depuis son espace." htmlFor="hr-e-user">
                <select id="hr-e-user" value={editor.user} onChange={(ev) => setEditor({ ...editor, user: ev.target.value })}>
                  <option value="">Aucun compte</option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.username} - {u.role_label}</option>
                  ))}
                </select>
              </Field>
              <label className="checkline">
                <input type="checkbox" checked={editor.active} onChange={(ev) => setEditor({ ...editor, active: ev.target.checked })} />
                <span>Salarié actif</span>
              </label>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setEditor(null)} disabled={busy}>Revenir</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy && <span className="caret" aria-hidden="true" />}
                  {editor.id ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </Portal>
      )}

      {toSend && (
        <ConfirmDialog
          title="Envoyer en signature ?"
          text={`${toSend.document.reference} — l'entreprise appose sa signature et le document part dans l'espace du salarié. Il ne sera plus modifiable.`}
          confirmLabel="Envoyer" busy={busy}
          onConfirm={confirmSend} onClose={() => !busy && setToSend(null)}
        />
      )}
      {toDelete && (
        <ConfirmDialog
          title="Supprimer ce brouillon ?"
          text={`${toDelete.document.reference} — suppression définitive, tracée.`}
          confirmLabel="Supprimer" danger busy={busy}
          onConfirm={confirmDelete} onClose={() => !busy && setToDelete(null)}
        />
      )}
    </AppShell>
  );
}
