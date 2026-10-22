import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '../components/AppShell';
import { CompanyFooter, CompanyHeader } from '../components/CompanyDoc';
import { ConfirmDialog, EmptyState, Field, PageHeader, Portal, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import {
  addPayslipLine, closeSheet, createSheet, deleteSheet,
  fillTeam, generatePayslip, getSheet, listSheets, listUsers, mediaUrl,
  payPayslip, removeStamp, setSlipBase, uploadStamp,
  type AdminUser, type PayrollSheet, type Payslip,
} from '../lib/api';
import { fcfa } from '../lib/format';

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function sheetLabel(monthIso: string): string {
  const [a, m] = monthIso.split('-').map(Number);
  return `${MOIS[(m || 1) - 1]} ${a}`;
}

function userLabel(u: AdminUser): string {
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* Paie façon Hub Digi : UNE fiche mensuelle d'équipe, saisie tableur
   (clic, libellé + montant, Entrée = enregistré), cachet exigé avant
   clôture, versements décaissés en caisse. Écriture : admin seul. */
export default function Payroll() {
  const { can } = useAuth();
  const { notify } = useToast();
  const mayWrite = can('admin');
  const [sheets, setSheets] = useState<PayrollSheet[]>([]);
  const [sheet, setSheet] = useState<PayrollSheet | null>(null);
  // Comptes utilisateurs (prénom + nom) : la paie reprend les comptes existants.
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Création fiche
  const now = new Date();
  const [newMonth, setNewMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [openNew, setOpenNew] = useState(false);
  const [toDelete, setToDelete] = useState<PayrollSheet | null>(null);
  // Ligne nouvelle (compte)
  const [addUser, setAddUser] = useState('');
  // Saisie tableur : cellule {slip, nature} + libellé/montant (base : montant seul)
  const [cell, setCell] = useState<{ slip: number; kind: 'gain' | 'deduction' | 'base' } | null>(null);
  const [qLabel, setQLabel] = useState('');
  const [qAmount, setQAmount] = useState('');
  // Détail lignes (gains/retenues) déplié par fiche
  const [openRows, setOpenRows] = useState<Record<number, boolean>>({});
  // Versement
  const [payTarget, setPayTarget] = useState<Payslip | null>(null);
  const [payAmount, setPayAmount] = useState('');
  // Clôture
  const [confirmClose, setConfirmClose] = useState(false);
  const [warn, setWarn] = useState('');
  // Cachet
  const stampInput = useRef<HTMLInputElement | null>(null);

  function loadList() {
    setLoading(true); setError('');
    Promise.all([listSheets().catch(() => [] as PayrollSheet[]), listUsers().catch(() => [] as AdminUser[])])
      .then(([sh, u]) => { setSheets(sh); setUsers(u.filter((x) => x.is_active)); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(loadList, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openSheet(id: number) {
    setBusy(true);
    try { setSheet(await getSheet(id)); }
    catch (e) { notify('error', 'Ouverture impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function refreshSheet() {
    if (!sheet) return;
    try { setSheet(await getSheet(sheet.id)); } catch { /* ignore */ }
    loadList();
  }

  async function submitNew() {
    const [y, m] = newMonth.split('-').map(Number);
    if (!y || !m) { notify('warning', 'Mois invalide', 'Choisissez le mois de la fiche.'); return; }
    const exist = sheets.find((s) => s.month.startsWith(`${y}-${String(m).padStart(2, '0')}`));
    if (exist) {
      setOpenNew(false);
      notify('info', 'Fiche existante', `${sheetLabel(exist.month)} déjà créée, ouverture.`);
      await openSheet(exist.id);
      return;
    }
    setBusy(true);
    try {
      const s = await createSheet(y, m);
      notify('success', 'Fiche créée', `${sheetLabel(s.month)} — vierge.`);
      setOpenNew(false);
      setSheet(s);
      loadList();
    } catch (e) { notify('error', 'Création impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function doDelete() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await deleteSheet(toDelete.id);
      notify('success', 'Fiche supprimée', `${sheetLabel(toDelete.month)} — brouillon effacé.`);
      setToDelete(null);
      if (sheet?.id === toDelete.id) setSheet(null);
      loadList();
    } catch (e) { notify('error', 'Suppression impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function doFillTeam() {
    if (!sheet) return;
    setBusy(true);
    try {
      const s = await fillTeam(sheet.id);
      notify('success', 'Équipe pré-remplie', `${s.created} ligne(s) depuis les comptes.`);
      await refreshSheet();
    } catch (e) { notify('error', 'Pré-remplissage impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function submitAddUser() {
    if (!sheet || !addUser) return;
    setBusy(true);
    try {
      await generatePayslip({ sheet: sheet.id, user: Number(addUser) });
      notify('success', 'Ligne ajoutée', 'Base reprise du contrat si présent, avances déduites.');
      setAddUser('');
      await refreshSheet();
    } catch (e) { notify('error', 'Ajout impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function submitCell(e?: React.FormEvent) {
    e?.preventDefault();
    if (!cell || !qAmount.trim()) {
      notify('warning', 'Montant requis', 'Chaque Entrée enregistre la saisie.');
      return;
    }
    if (cell.kind !== 'base' && !qLabel.trim()) {
      notify('warning', 'Libellé et montant requis', 'Chaque Entrée enregistre la ligne.');
      return;
    }
    setBusy(true);
    try {
      if (cell.kind === 'base') {
        await setSlipBase(cell.slip, Math.round(Number(qAmount)));
        notify('success', 'Base enregistrée', `${fcfa(Number(qAmount))}.`);
      } else {
        await addPayslipLine(cell.slip, { kind: cell.kind, label: qLabel.trim(), amount: Math.round(Number(qAmount)) });
        notify('success', 'Ligne enregistrée', `${qLabel.trim()} — ${fcfa(Number(qAmount))}.`);
      }
      setCell(null); setQLabel(''); setQAmount('');
      await refreshSheet();
    } catch (err) { notify('error', 'Saisie impossible', err instanceof Error ? err.message : ''); }
    finally { setBusy(false); }
  }

  async function doClose() {
    if (!sheet) return;
    setBusy(true);
    try {
      const s = await closeSheet(sheet.id);
      setSheet(s); setConfirmClose(false); setWarn('');
      notify('success', 'Fiche clôturée', 'Saisie verrouillée, versements possibles.');
      loadList();
    } catch (e) { notify('error', 'Clôture impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  function askClose() {
    if (!sheet) return;
    if (!sheet.stamp) {
      setWarn('Cachet du directeur manquant : importez le cachet avant de clôturer la fiche.');
      notify('warning', 'Clôture bloquée', 'Importez le cachet du directeur pour clôturer.');
      stampInput.current?.focus();
      return;
    }
    setConfirmClose(true);
  }

  async function importStamp(file: File | undefined) {
    if (!sheet || !file) return;
    if (!file.type.startsWith('image/')) { setWarn('Fichier refusé : image uniquement (PNG, JPG).'); return; }
    if (file.size > 2 * 1024 * 1024) { setWarn('Image trop lourde : 2 Mo maximum.'); return; }
    setBusy(true);
    try {
      const s = await uploadStamp(sheet.id, file);
      setSheet(s); setWarn('');
      notify('success', 'Cachet importé', 'Clôture désormais possible.');
    } catch (e) { setWarn(e instanceof Error ? e.message : 'Import impossible.'); }
    finally { setBusy(false); }
  }

  async function dropStamp() {
    if (!sheet) return;
    setBusy(true);
    try {
      setSheet(await removeStamp(sheet.id));
      setWarn('');
      notify('info', 'Cachet retiré', 'La clôture est de nouveau bloquée.');
    } catch (e) { notify('error', 'Retrait impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function doPay() {
    if (!payTarget) return;
    const n = Math.round(Number(payAmount));
    if (!n || n < 1) { notify('warning', 'Montant invalide', 'Saisissez le montant versé.'); return; }
    setBusy(true);
    try {
      await payPayslip(payTarget.id, n);
      notify('success', 'Versement enregistré', `${fcfa(n)} — décaissé en caisse.`);
      setPayTarget(null); setPayAmount('');
      await refreshSheet();
    } catch (e) { notify('error', 'Versement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  const locked = sheet?.status === 'closed';
  // Comptes déjà dans la fiche (par user lié, ou nom pour les lignes historiques).
  const inSheetUsers = useMemo(() => new Set((sheet?.slips ?? []).map((s) => s.user).filter(Boolean)), [sheet]);
  const inSheetNames = useMemo(() => new Set((sheet?.slips ?? []).map((s) => s.employee_name)), [sheet]);
  const freeUsers = useMemo(
    () => users.filter((u) => !inSheetUsers.has(u.id) && !inSheetNames.has(userLabel(u))),
    [users, inSheetUsers, inSheetNames]);
  const stampUrl = sheet?.stamp ? mediaUrl(sheet.stamp) : '';

  function cellGains(s: Payslip): number { return s.lines.filter((l) => l.kind === 'gain').reduce((t, l) => t + l.amount, 0); }
  function cellDeds(s: Payslip): number { return s.lines.filter((l) => l.kind === 'deduction').reduce((t, l) => t + l.amount, 0); }

  function baseCell(s: Payslip) {
    const editing = cell?.slip === s.id && cell.kind === 'base';
    if (editing) {
      return (
        <form onSubmit={submitCell} className="cell-edit">
          <input value={qAmount} onChange={(e) => setQAmount(e.target.value)} inputMode="numeric" placeholder="FCFA" aria-label={`Base de ${s.employee_name}`} className="num" autoFocus />
          <div className="btn-row">
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>OK (Entrée)</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setCell(null); setQAmount(''); }}>Annuler</button>
          </div>
        </form>
      );
    }
    return (
      <button
        type="button" className="cell" disabled={!mayWrite || locked}
        title="Base saisie librement (contrat repris à l’ajout)"
        onClick={() => { setCell({ slip: s.id, kind: 'base' }); setQLabel(''); setQAmount(String(s.base_amount)); }}
        aria-label={`Saisir la base de ${s.employee_name}`}
      >
        <span className="num">{s.base_amount ? fcfa(s.base_amount) : <span className="muted">Saisir…</span>}</span>
      </button>
    );
  }

  function moneyCell(s: Payslip, kind: 'gain' | 'deduction') {
    const total = kind === 'gain' ? cellGains(s) : cellDeds(s);
    const n = s.lines.filter((l) => l.kind === kind).length;
    const labels = s.lines.filter((l) => l.kind === kind).map((l) => `${l.label} (${l.amount.toLocaleString('fr-FR')})`).join(' · ');
    const editing = cell?.slip === s.id && cell.kind === kind;
    if (editing) {
      return (
        <form onSubmit={submitCell} className="cell-edit">
          <input value={qLabel} onChange={(e) => setQLabel(e.target.value)} placeholder="Libellé" aria-label={`Libellé ${kind}`} autoFocus />
          <input value={qAmount} onChange={(e) => setQAmount(e.target.value)} inputMode="numeric" placeholder="FCFA" aria-label={`Montant ${kind}`} className="num" />
          <div className="btn-row">
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>OK (Entrée)</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setCell(null); setQLabel(''); setQAmount(''); }}>Annuler</button>
          </div>
        </form>
      );
    }
    return (
      <button
        type="button" className="cell" disabled={!mayWrite || locked}
        title={labels || 'Aucune ligne'}
        onClick={() => { setCell({ slip: s.id, kind }); setQLabel(''); setQAmount(''); }}
        aria-label={`Saisir ${kind === 'gain' ? 'prime' : 'retenue'} pour ${s.employee_name}`}
      >
        <span className="num">{total ? fcfa(total) : <span className="muted">Saisir…</span>}</span>
        {n > 0 && <span className="small muted"> · {n} ligne{n > 1 ? 's' : ''}</span>}
      </button>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Paie"
        sub="Une fiche par mois pour toute l’équipe. Saisie tableur, cachet, clôture, versements en caisse."
        actions={mayWrite ? (
          <button type="button" className="btn btn-accent" onClick={() => setOpenNew(true)}><Icon name="plus" size={18} />Fiche du mois</button>
        ) : undefined}
      />

      {!sheet && (
        <>
          {loading && <SkeletonList n={3} />}
          {error && <div className="alert-error" role="alert">{error}</div>}
          {!loading && !error && sheets.length === 0 && (
            <EmptyState icon="users" title="Aucune fiche de paie" text="Créez la fiche du mois, puis pré-remplissez l’équipe depuis les contrats." />
          )}
          {!loading && !error && (
            <div className="list">
              {sheets.map((s) => {
                const paid = s.slips.filter((l) => l.status === 'paye').length;
                return (
                  <article className="row-card" key={s.id}>
                    <div className="row-top">
                      <span className="row-title">{sheetLabel(s.month)}</span>
                      <span className={`badge ${s.status === 'closed' ? 'badge-confirmed' : 'badge-pending_deposit'}`}>
                        {s.status === 'closed' ? 'Clôturée' : 'Brouillon'}
                      </span>
                    </div>
                    <div className="row-meta">
                      <span className="num">{s.slips.length} lignes · {paid} payées</span>
                      <span className="num">Total {fcfa(s.total)}</span>
                    </div>
                    <div className="btn-row">
                      <button type="button" className="btn btn-sm btn-accent" onClick={() => openSheet(s.id)} disabled={busy}>
                        Ouvrir la fiche<Icon name="scan" size={16} />
                      </button>
                      {mayWrite && s.status !== 'closed' && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setToDelete(s)}>Supprimer</button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {sheet && (
        <section aria-label={`Fiche de paie ${sheetLabel(sheet.month)}`}>
          <div className="no-print">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setSheet(null); setCell(null); setPayTarget(null); }}>
              ← Paie des employés
            </button>
            <div className="row-top" style={{ marginTop: 8 }}>
              <h2 style={{ margin: 0 }}>Fiche {sheetLabel(sheet.month)}</h2>
              <span className={`badge ${locked ? 'badge-confirmed' : 'badge-pending_deposit'}`}>{locked ? 'Clôturée' : 'Brouillon'}</span>
              <span className="badge">Total : {fcfa(sheet.total)}</span>
            </div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              {mayWrite && !locked && (
                <>
                  <button type="button" className="btn btn-ghost" onClick={doFillTeam} disabled={busy}>
                    <Icon name="users" size={18} />Pré-remplir l’équipe
                  </button>
                  <button type="button" className="btn btn-accent" onClick={askClose} disabled={busy} title={sheet.stamp ? 'Clôturer la fiche' : 'Cachet requis pour clôturer'}>
                    <Icon name="close" size={18} />Clôturer la fiche
                  </button>
                </>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
                <Icon name="download" size={18} />Imprimer
              </button>
            </div>
            {warn && !locked && <div className="alert-error" role="alert" style={{ marginTop: 8 }}>{warn}</div>}
          </div>

          <div className="card doc" style={{ marginTop: 12 }}>
            <CompanyHeader title={`Fiche de paie — ${sheetLabel(sheet.month)}`} sub={locked ? 'clôturée' : 'brouillon'} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>N°</th><th>Employé</th><th>Poste</th><th>Site</th><th>Base</th>
                    <th>Primes</th><th>Retenues</th><th>Net</th><th>Statut</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.slips.map((s) => (
                    <Fragment key={s.id}>
                      <tr>
                        <td className="num small muted">{s.number}</td>
                        <td>
                          <button
                            type="button" className="cell" style={{ fontWeight: 700 }}
                            onClick={() => setOpenRows((o) => ({ ...o, [s.id]: !o[s.id] }))}
                            aria-label={`Détail des lignes de ${s.employee_name}`}
                            title="Voir le détail gains / retenues"
                          >
                            {s.employee_name}
                          </button>
                        </td>
                        <td>{s.position || '—'}</td>
                        <td>{s.site_name || '—'}</td>
                        <td>{baseCell(s)}</td>
                        <td>{moneyCell(s, 'gain')}</td>
                        <td>{moneyCell(s, 'deduction')}</td>
                        <td className="num"><strong>{fcfa(s.net)}</strong></td>
                        <td>
                          <span className={`badge ${s.status === 'paye' ? 'badge-confirmed' : 'badge-pending_deposit'}`}>
                            {s.status === 'paye' ? 'Payé' : 'En attente'}
                          </span>
                          {mayWrite && locked && s.status !== 'paye' && (
                            <><br /><button type="button" className="btn btn-sm btn-ghost no-print" onClick={() => { setPayTarget(s); setPayAmount(String(s.net - s.paid)); }}>Verser</button></>
                          )}
                        </td>
                        <td className="num small">{fmtDate(s.paid_at)}</td>
                      </tr>
                      {openRows[s.id] && (
                        <tr key={`${s.id}-detail`}>
                          <td />
                          <td colSpan={9}>
                            {s.lines.length === 0 && <span className="small muted">Aucune prime ni retenue. Saisissez la base, les primes et les retenues.</span>}
                            {s.lines.map((l) => (
                              <div className="leader" key={l.id}>
                                <span>{l.kind === 'gain' ? 'Gain' : 'Retenue'} — {l.label}</span>
                                <span className="dots" aria-hidden="true" />
                                <strong className="num">{fcfa(l.amount)}</strong>
                              </div>
                            ))}
                            {s.payments.length > 0 && (
                              <div className="small muted" style={{ marginTop: 4 }}>
                                Versements : {s.payments.map((p) => `${p.amount.toLocaleString('fr-FR')} FCFA (${p.entry_ref})`).join(' · ')}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {mayWrite && !locked && (
                    <tr>
                      <td className="num small muted">Auto</td>
                      <td colSpan={4}>
                        <select className="select" value={addUser} onChange={(e) => setAddUser(e.target.value)} aria-label="Compte à ajouter à la fiche">
                          <option value="">Ajouter un compte (prénom — nom)…</option>
                          {freeUsers.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                        </select>
                      </td>
                      <td colSpan={5}>
                        <button type="button" className="btn btn-sm btn-primary" onClick={submitAddUser} disabled={busy || !addUser}>
                          Ajouter la ligne
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {sheet.slips.length === 0 && (
              <EmptyState icon="users" title="Fiche vierge" text="Pré-remplissez l’équipe depuis les comptes, ou ajoutez les lignes une par une." />
            )}
            <div className="row-top" style={{ marginTop: 8 }}>
              <strong>Total masse salariale</strong>
              <strong className="num">{fcfa(sheet.total)}</strong>
            </div>
            <div className="no-print" style={{ marginTop: 8 }}>
              <p>Signature Finance : <em><strong>La Direction</strong></em></p>
              {stampUrl ? (
                <img src={stampUrl} alt="Cachet du directeur" style={{ height: 96, width: 'auto', objectFit: 'contain' }} />
              ) : (
                <p className="small muted">Aucun cachet — la clôture est bloquée.</p>
              )}
              {mayWrite && !locked && (
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <input ref={stampInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => importStamp(e.target.files?.[0])} aria-label="Importer le cachet du directeur" />
                  {sheet.stamp && <button type="button" className="btn btn-sm btn-ghost" onClick={dropStamp} disabled={busy}>Retirer</button>}
                </div>
              )}
            </div>
            <CompanyFooter />
          </div>

          {payTarget && (
            <div className="card form no-print" style={{ marginTop: 12 }}>
              <h3>Verser — {payTarget.employee_name} (reste {fcfa(payTarget.net - payTarget.paid)})</h3>
              <Field label="Montant versé (FCFA)" htmlFor="pa-pay">
                <input id="pa-pay" inputMode="numeric" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Montant" />
              </Field>
              <div className="btn-row">
                <button type="button" className="btn btn-ghost" onClick={() => setPayTarget(null)}>Revenir</button>
                <button type="button" className="btn btn-primary" onClick={doPay} disabled={busy}>
                  {busy && <span className="caret" aria-hidden="true" />}Enregistrer le versement
                </button>
              </div>
              <p className="small muted">Décaissé en caisse (catégorie salaire), bordereau tracé.</p>
            </div>
          )}
        </section>
      )}

      {openNew && (
        <Portal><div className="modal-backdrop" onClick={() => !busy && setOpenNew(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Créer une fiche de paie" onClick={(e) => e.stopPropagation()}>
            <h2>Créer une fiche de paie</h2>
            <p className="small muted">Une fiche par mois. Doublon = ouverture de l’existante.</p>
            <Field label="Mois" required htmlFor="pa-new-month">
              <input id="pa-new-month" type="month" value={newMonth} onChange={(e) => e.target.value && setNewMonth(e.target.value)} />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpenNew(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submitNew} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Créer la fiche
              </button>
            </div>
          </div>
        </div></Portal>
      )}

      {toDelete && (
        <ConfirmDialog
          title={`Supprimer la fiche ${sheetLabel(toDelete.month)} ?`}
          text="Brouillon seul, sans versement. Suppression définitive."
          confirmLabel="Supprimer" danger busy={busy}
          onConfirm={doDelete} onClose={() => !busy && setToDelete(null)}
        />
      )}
      {confirmClose && sheet && (
        <ConfirmDialog
          title={`Clôturer la fiche ${sheetLabel(sheet.month)} ?`}
          text={`Net total ${fcfa(sheet.total)}. La saisie sera verrouillée, seuls les versements resteront possibles. Clôture tracée.`}
          confirmLabel="Clôturer" busy={busy}
          onConfirm={doClose} onClose={() => !busy && setConfirmClose(false)}
        />
      )}

    </AppShell>
  );
}
