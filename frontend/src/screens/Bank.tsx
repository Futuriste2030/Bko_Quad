import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { CompanyFooter, CompanyHeader } from '../components/CompanyDoc';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import {
  bankSummary, createDeposit, createTransfer, createWithdrawal, downloadPdf, monthSummary, todayISO,
  type BankRow, type BankSummary, type BankType,
} from '../lib/api';
import { fcfa } from '../lib/format';

/* Banque : compte distinct de la caisse. Versements (bordereau), retraits
   (chèque/référence) et virements reçus (banques, sans référence).
   Banque BKO saisie à chaque opération, filtre par banque, rapport PDF
   filtrable. Écritures jamais supprimées, solde jamais négatif. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type TxKind = BankType;
type TypeFilter = '' | TxKind;

const TYPE_LABEL: Record<TxKind, string> = { deposit: 'Versement', withdrawal: 'Retrait', transfer: 'Virement' };
const TYPE_BADGE: Record<TxKind, string> = { deposit: 'badge-confirmed', withdrawal: 'badge-pending_deposit', transfer: 'badge-no_show' };
const TYPE_ARROW: Record<TxKind, string> = { deposit: '↗', withdrawal: '↙', transfer: '⇄' };

export default function Bank() {
  const { notify } = useToast();
  const { role } = useAuth();
  const mayWrite = role === 'responsable' || role === 'admin' || role === 'superadmin';
  const [month, setMonth] = useState(monthKey(new Date()));
  const [bankFilter, setBankFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [summary, setSummary] = useState<BankSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<TxKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [fDate, setFDate] = useState(todayISO());
  const [fFirst, setFFirst] = useState('');
  const [fLast, setFLast] = useState('');
  const [fReason, setFReason] = useState('');
  const [fAmount, setFAmount] = useState('');
  const [fRef, setFRef] = useState('');
  const [fBank, setFBank] = useState('');
  const [fCounterBank, setFCounterBank] = useState('');
  const [fees, setFees] = useState('5850');
  const [statement, setStatement] = useState('');

  function load() {
    const [y, m] = month.split('-').map(Number);
    setLoading(true); setError('');
    bankSummary(y, m, bankFilter || undefined)
      .then(setSummary)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [month, bankFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: BankRow[] = useMemo(() => summary?.rows ?? [], [summary]);
  const banks = useMemo(() => {
    const s = new Set(rows.map((r) => r.bank).filter(Boolean));
    if (bankFilter && !s.has(bankFilter)) s.add(bankFilter);
    return [...s].sort();
  }, [rows, bankFilter]);
  const visible = useMemo(
    () => (typeFilter ? rows.filter((r) => r.type === typeFilter) : rows),
    [rows, typeFilter],
  );
  const sumDeposit = visible.filter((r) => r.type === 'deposit').reduce((s, r) => s + r.credit, 0);
  const sumTransfer = visible.filter((r) => r.type === 'transfer').reduce((s, r) => s + r.credit, 0);
  const sumDebit = visible.reduce((s, r) => s + r.debit, 0);

  /* Story 3 : la recette nette de la caisse pré-remplit le versement. */
  async function prefillNet() {
    const [y, m] = month.split('-').map(Number);
    try {
      const s = await monthSummary(y, m);
      setOpen('deposit');
      setFDate(todayISO());
      setFReason('Versement recette nette fin de mois');
      setFAmount(String(s.balance));
      setFRef('');
      setFFirst(''); setFLast(''); setFBank(bankFilter);
      notify('info', 'Recette nette reprise', `Caisse de ${month} : ${fcfa(s.balance)}. Saisissez le bordereau et la banque.`);
    } catch (e) { notify('error', 'Caisse indisponible', e instanceof Error ? e.message : ''); }
  }

  async function submit() {
    if (!open) return;
    const n = Math.round(Number(fAmount));
    if (!fFirst.trim() || (open !== 'transfer' && !fLast.trim())) {
      notify('warning', 'Personne requise', open === 'transfer' ? 'Nom de l’entreprise ou de la personne.' : 'Indiquez le nom et le prénom.');
      return;
    }
    if (!fReason.trim()) { notify('warning', 'Motif requis', 'Décrivez l’opération en une phrase.'); return; }
    if (!fBank.trim()) { notify('warning', 'Banque requise', 'Saisissez la banque BKO Quad concernée.'); return; }
    if (!n || n < 1) { notify('warning', 'Montant invalide', 'Saisissez le montant en FCFA.'); return; }
    if (open === 'transfer' && !fCounterBank.trim()) {
      notify('warning', 'Banque du client requise', 'Saisissez la banque émettrice du virement.'); return;
    }
    if (open !== 'transfer' && !fRef.trim()) {
      notify('warning', open === 'deposit' ? 'Bordereau requis' : 'Chèque requis',
        open === 'deposit' ? 'Saisissez le numéro du bordereau de versement.' : 'Saisissez le numéro de chèque / référence.');
      return;
    }
    setBusy(true);
    try {
      const base = {
        date: fDate, reason: fReason.trim(), amount: n, bank: fBank.trim(),
        person_first_name: fFirst.trim(), person_last_name: fLast.trim(),
      };
      const r = open === 'deposit'
        ? await createDeposit({ ...base, receipt_number: fRef.trim() })
        : open === 'withdrawal'
          ? await createWithdrawal({ ...base, check_number: fRef.trim() })
          : await createTransfer({ date: fDate, reason: fReason.trim(), amount: n, bank: fBank.trim(), counterparty_bank: fCounterBank.trim(), person_first_name: fFirst.trim() });
      notify('success', `${TYPE_LABEL[open]} enregistré`, `Solde bancaire : ${fcfa(r.balance)}.`);
      setOpen(null); setFFirst(''); setFLast(''); setFReason(''); setFAmount(''); setFRef(''); setFBank(''); setFCounterBank('');
      load();
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  const feeN = Math.round(Number(fees)) || 0;
  const statN = statement.trim() === '' ? null : Math.round(Number(statement));
  const gap = statN === null || !summary ? null : statN - (summary.balance - feeN);

  async function report() {
    if (!summary) return;
    const [y, m] = month.split('-').map(Number);
    const q = `?year=${y}&month=${m}${bankFilter ? `&bank=${encodeURIComponent(bankFilter)}` : ''}${feeN ? `&fees=${feeN}` : ''}${statN !== null ? `&statement=${statN}` : ''}`;
    setBusy(true);
    try {
      await downloadPdf(`/bank/report/${q}`,
        `rapprochement-banque-${month}${bankFilter ? `-${bankFilter}` : ''}.pdf`);
      notify('success', 'Rapport téléchargé', 'PDF prêt à envoyer.');
    } catch (e) { notify('error', 'Rapport impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  const modalTitle = open === 'deposit' ? 'Nouveau versement' : open === 'withdrawal' ? 'Nouveau retrait bancaire' : 'Nouveau virement reçu';

  return (
    <AppShell>
      <PageHeader
        title="Banque"
        sub="Compte bancaire du GIE, distinct de la caisse : versements, retraits et virements tracés."
        actions={(
          <>
            <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}><Icon name="file" size={18} />Imprimer</button>
            <button type="button" className="btn btn-ghost no-print" onClick={report} disabled={!summary || busy}><Icon name="download" size={18} />Rapport PDF</button>
            {mayWrite && (
              <>
                <button type="button" className="btn btn-accent" onClick={() => { setOpen('deposit'); setFDate(todayISO()); setFBank(bankFilter); }}><Icon name="plus" size={18} />Versement</button>
                <button type="button" className="btn btn-primary" onClick={() => { setOpen('withdrawal'); setFDate(todayISO()); setFBank(bankFilter); }}><Icon name="cash" size={18} />Retrait</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setOpen('transfer'); setFDate(todayISO()); setFBank(bankFilter); }}><Icon name="send" size={18} />Virement</button>
              </>
            )}
          </>
        )}
      />
      <div className="card form no-print">
        <div className="form-2">
          <Field label="Mois" htmlFor="bk-month">
            <input id="bk-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </Field>
          <Field label="Verser la recette nette de caisse" htmlFor="bk-net">
            <button id="bk-net" type="button" className="btn btn-ghost" onClick={prefillNet} disabled={!mayWrite}>
              <Icon name="wallet" size={18} />Reprendre la recette nette
            </button>
          </Field>
        </div>
        <div className="form-2">
          <Field label="Filtrer par banque" htmlFor="bk-bankf" hint="Rapport et totaux suivent ce filtre.">
            <select id="bk-bankf" className="select" value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}>
              <option value="">Toutes les banques</option>
              {banks.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Type d’opération" htmlFor="bk-typef">
            <div className="segmented" role="group" aria-label="Filtrer par type">
              {(['' , 'deposit', 'withdrawal', 'transfer'] as TypeFilter[]).map((t) => (
                <button key={t || 'all'} type="button" className="chip" aria-pressed={typeFilter === t}
                  onClick={() => setTypeFilter(t)}>
                  {t ? TYPE_LABEL[t] : 'Tous'}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>
      {loading && <SkeletonList n={3} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && summary && (
        <>
          <div className="kpi-grid">
            <div className="kpi featured">
              <span className="kpi-top">Solde bancaire{summary.site_name ? ` · ${summary.site_name}` : ''}</span>
              <span className="kpi-value num">{fcfa(summary.site != null ? (summary.site_balance ?? 0) : summary.balance)}</span>
              <span className="kpi-sub">
                {summary.site != null
                  ? 'Mouvements du site · versements + virements − retraits'
                  : 'Toutes banques · versements + virements − retraits'}
              </span>
            </div>
            <div className="kpi"><span className="kpi-top">Versements{bankFilter ? ` · ${bankFilter}` : ''}</span><span className="kpi-value num">{fcfa(sumDeposit)}</span></div>
            <div className="kpi"><span className="kpi-top">Virements reçus{bankFilter ? ` · ${bankFilter}` : ''}</span><span className="kpi-value num">{fcfa(sumTransfer)}</span></div>
            <div className="kpi"><span className="kpi-top">Retraits{bankFilter ? ` · ${bankFilter}` : ''}</span><span className="kpi-value num">{fcfa(sumDebit)}</span><span className="kpi-sub">{visible.length} opération(s)</span></div>
          </div>
          {bankFilter && <p className="small muted">Filtre actif : {bankFilter} — le Rapport PDF reprendra ce filtre.</p>}
          {visible.length === 0 && (
            <EmptyState icon="wallet" title="Aucune opération ce mois-ci" text="Enregistrez un versement, un retrait ou un virement — jamais supprimé ensuite." />
          )}
          {visible.length > 0 && (
            <section className="card">
              <CompanyHeader title={`Rapprochement bancaire — ${new Date(`${month}-02`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}${bankFilter ? ` · ${bankFilter}` : ''}`} sub="Historique avec solde progressif." />
              <div className="list" style={{ marginTop: 8 }}>
                {visible.map((r) => (
                  <article className="row-card" key={r.id}>
                    <div className="row-top">
                      <span className="row-title num">{new Date(r.date).toLocaleDateString('fr-FR')} · {r.ref}</span>
                      <span className={`badge ${TYPE_BADGE[r.type]}`}>
                        {TYPE_ARROW[r.type]} {TYPE_LABEL[r.type]}
                      </span>
                    </div>
                    <div>{r.reason}</div>
                    <div className="row-meta">
                      <span>{r.person_first_name} {r.person_last_name}</span>
                      <span className="num">{r.bank}</span>
                      {summary.site == null && r.site_name && <span>{r.site_name}</span>}
                      {r.type === 'transfer' && r.counterparty_bank && <span className="num">← {r.counterparty_bank}</span>}
                      {r.debit > 0 && <span className="num">Débit {fcfa(r.debit)}</span>}
                      {r.credit > 0 && <span className="num">Crédit {fcfa(r.credit)}</span>}
                    </div>
                    <div className="row-top"><strong className="num">Solde {fcfa(r.running)}</strong></div>
                  </article>
                ))}
              </div>
              <h3 style={{ marginTop: 12 }}>Rapprochement avec le relevé</h3>
              <div className="form-2" style={{ marginTop: 8 }}>
                <Field label="Frais et agios (FCFA)" htmlFor="bk-fees">
                  <input id="bk-fees" inputMode="numeric" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="Ex. 5850" />
                </Field>
                <Field label="Solde du relevé bancaire (FCFA)" htmlFor="bk-stat">
                  <input id="bk-stat" inputMode="numeric" value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Ex. 250000" />
                </Field>
              </div>
              {gap !== null && (
                <div className="leader" style={{ marginTop: 8 }}>
                  <span>Écart à justifier (relevé − logiciel + frais)</span>
                  <span className="dots" aria-hidden="true" />
                  <strong className="num">{fcfa(gap)}</strong>
                </div>
              )}
              <p className="small muted" style={{ marginTop: 8 }}>Astuce : frais de tenue de compte mensuels autour de 5 850 FCFA (BIM).</p>
              <CompanyFooter />
            </section>
          )}
        </>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(null)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label={modalTitle} onClick={(e) => e.stopPropagation()}>
            <h2>{modalTitle}</h2>
            {open === 'transfer'
              ? (
                <>
                  <Field label="Nom (entreprise ou personne concernée)" required htmlFor="bk-first">
                    <input id="bk-first" value={fFirst} onChange={(e) => setFFirst(e.target.value)} placeholder="Ex. Orange Money, ETS Diallo" />
                  </Field>
                  <div className="form-2">
                    <Field label="Banque du client" required htmlFor="bk-cbank">
                      <input id="bk-cbank" value={fCounterBank} onChange={(e) => setFCounterBank(e.target.value)} placeholder="Ex. Orange, Moov" />
                    </Field>
                    <Field label="Banque BKO Quad" required htmlFor="bk-bank">
                      <input id="bk-bank" value={fBank} onChange={(e) => setFBank(e.target.value)} placeholder="Ex. BIM, BOA" list="bk-banks" />
                    </Field>
                  </div>
                </>
              )
              : (
                <div className="form-2">
                  <Field label="Prénom" required htmlFor="bk-first">
                    <input id="bk-first" value={fFirst} onChange={(e) => setFFirst(e.target.value)}
                      placeholder={open === 'deposit' ? 'Prénom du versant' : 'Prénom du bénéficiaire'} />
                  </Field>
                  <Field label="Nom" required htmlFor="bk-last">
                    <input id="bk-last" value={fLast} onChange={(e) => setFLast(e.target.value)}
                      placeholder={open === 'deposit' ? 'Nom du versant' : 'Nom du bénéficiaire'} />
                  </Field>
                </div>
              )}
            <div className="form-2">
              <Field label="Date" required htmlFor="bk-date">
                <input id="bk-date" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
              </Field>
              <Field label="Montant (FCFA)" required htmlFor="bk-amount">
                <input id="bk-amount" inputMode="numeric" value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="Ex. 300000" />
              </Field>
            </div>
            {open !== 'transfer' && (
              <Field label="Banque BKO Quad" required htmlFor="bk-bank">
                <input id="bk-bank" value={fBank} onChange={(e) => setFBank(e.target.value)} placeholder="Ex. BIM, BOA" list="bk-banks" />
              </Field>
            )}
            <Field label="Motif" required htmlFor="bk-reason">
              <input id="bk-reason" value={fReason} onChange={(e) => setFReason(e.target.value)}
                placeholder={open === 'deposit' ? 'Ex. versement recette nette fin de mois' : open === 'withdrawal' ? 'Ex. paiement fournisseur par chèque' : 'Ex. virement client TRA-9'} />
            </Field>
            {open !== 'transfer' && (
              <Field label={open === 'deposit' ? 'N° du bordereau de versement' : 'N° de chèque / référence'} required htmlFor="bk-ref">
                <input id="bk-ref" value={fRef} onChange={(e) => setFRef(e.target.value)}
                  placeholder={open === 'deposit' ? 'Ex. BV-2026-010' : 'Ex. CHQ-000123'} />
              </Field>
            )}
            <datalist id="bk-banks">{banks.map((b) => <option key={b} value={b} />)}</datalist>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(null)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
