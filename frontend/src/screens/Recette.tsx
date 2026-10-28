import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { CompanyFooter, CompanyHeader } from '../components/CompanyDoc';
import SiteFilter from '../components/SiteFilter';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { listBookings, listEntries, monthSummary, downloadPdf, closeMonth, type Booking, type Entry, type MonthSummary } from '../lib/api';
import { fcfa } from '../lib/format';
import { useToast } from '../lib/toast';
import { nativePrint } from '../lib/notifpref';
import { useAuth } from '../lib/auth';

/* Fiche de recette mensuelle : solde d'ouverture + entrées − sorties,
   recettes (mouvements) et dépenses, impayés attendus. Imprimable. */
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Recette() {
  const now = new Date();
  const { notify } = useToast();
  const { role } = useAuth();
  const mayClose = role === 'responsable' || role === 'admin' || role === 'comptable' || role === 'superadmin';
  const [month, setMonth] = useState(monthKey(now));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyClose, setBusyClose] = useState(false);
  const [exportYear, setExportYear] = useState(now.getFullYear());
  const [exportMonths, setExportMonths] = useState<Set<number>>(new Set([now.getMonth() + 1]));
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    const [y, m] = month.split('-').map(Number);
    setLoading(true); setError('');
    Promise.all([
      listEntries().catch(() => [] as Entry[]),
      listBookings().catch(() => [] as Booking[]),
      monthSummary(y, m).catch(() => null),
    ])
      .then(([e, b, s]) => { setEntries(e); setBookings(b); setSummary(s); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month]);

  const inMonth = useMemo(() => entries.filter((e) => e.date.slice(0, 7) === month), [entries, month]);
  const inn = inMonth.filter((e) => e.direction === 'in');
  const out = inMonth.filter((e) => e.direction === 'out');
  const sumIn = inn.reduce((s, e) => s + e.amount, 0);
  const sumOut = out.reduce((s, e) => s + e.amount, 0);
  const att = useMemo(() => bookings
    .filter((b) => b.status === 'pending_deposit' && monthKey(new Date(b.expires_at)) === month)
    .reduce((s, b) => s + b.deposit_due, 0), [bookings, month]);

  const label = new Date(`${month}-02`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const labelCap = label.charAt(0).toUpperCase() + label.slice(1);
  const empty = inMonth.length === 0 && att === 0;

  async function downloadRecettePdf() {
    const [y, m] = month.split('-').map(Number);
    setBusy(true);
    try {
      await downloadPdf(`/finance/recette/pdf/?year=${y}&month=${m}`,
        `recette-mensuelle-${month}.pdf`);
      notify('success', 'PDF téléchargé', 'Fiche de recette prête à envoyer.');
    } catch (e) {
      notify('error', 'Téléchargement impossible', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseMonth() {
    const [y, m] = month.split('-').map(Number);
    if (!window.confirm(`Clôturer le mois ${month} ? Les écritures seront verrouillées et le solde reporté.`)) return;
    setBusyClose(true);
    try {
      await closeMonth(y, m);
      const s = await monthSummary(y, m).catch(() => null);
      if (s) setSummary(s);
      notify('success', 'Mois clôturé', 'Le mois est verrouillé et le solde reporté.');
    } catch (e) {
      notify('error', 'Clôture impossible', e instanceof Error ? e.message : '');
    } finally {
      setBusyClose(false);
    }
  }

  function toggleExportMonth(m: number) {
    setExportMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  }
  function presetMonths(kind: 'single' | 'two' | 'quarter' | 'half' | 'year') {
    const cur = new Date().getMonth() + 1;
    const q = Math.ceil(cur / 3);
    const start = cur;
    let months: number[] = [];
    if (kind === 'single') months = [cur];
    else if (kind === 'two') months = [cur, cur === 12 ? 1 : cur + 1];
    else if (kind === 'quarter') months = [q * 3 - 2, q * 3 - 1, q * 3];
    else if (kind === 'half') {
      for (let i = 0; i < 6; i++) months.push(((start - 1 + i) % 12) + 1);
    } else {
      months = Array.from({ length: 12 }, (_, i) => i + 1);
    }
    setExportMonths(new Set(months));
  }
  async function downloadPeriodPdf() {
    const months = [...exportMonths].sort((a, b) => a - b);
    if (months.length === 0) { notify('warning', 'Mois requis', 'Sélectionnez au moins un mois.'); return; }
    const qs = months.map((m) => `${exportYear}-${String(m).padStart(2, '0')}`).join(',');
    setExportBusy(true);
    try {
      await downloadPdf(`/finance/recette/pdf/?months=${encodeURIComponent(qs)}`,
        `recette-${exportYear}${months.length > 1 ? '-periode' : ''}.pdf`);
      notify('success', 'PDF téléchargé', 'Fiche de recette prête.');
    } catch (e) { notify('error', 'Téléchargement impossible', e instanceof Error ? e.message : ''); }
    finally { setExportBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Recette mensuelle"
        sub={`Fiche de recette de ${labelCap}, à retirer en fin de mois.`}
        actions={(
          <>
            <button type="button" className="btn btn-ghost no-print" onClick={() => nativePrint()}><Icon name="file" size={18} />Imprimer</button>
            <button type="button" className="btn btn-ghost no-print" onClick={downloadRecettePdf} disabled={busy}><Icon name="download" size={18} />Télécharger en PDF</button>
            {mayClose && (
              summary?.locked
                ? <span className="small muted no-print">Mois déjà clôturé</span>
                : (
                  <button type="button" className="btn btn-accent no-print" onClick={handleCloseMonth} disabled={busyClose}>
                    <Icon name="close" size={18} />Clôturer le mois
                  </button>
                )
            )}
          </>
        )}
      />
      <div className="card form no-print">
        <div className="form-2">
          <Field label="Mois" htmlFor="rec-month">
            <input id="rec-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </Field>
          <SiteFilter />
        </div>
      </div>
      <div className="card form no-print">
        <h3 style={{ marginTop: 0 }}>Export PDF — période</h3>
        <div className="form-2">
          <Field label="Année" htmlFor="exp-year">
            <input id="exp-year" type="number" value={exportYear} onChange={(e) => setExportYear(Number(e.target.value) || now.getFullYear())} />
          </Field>
          <Field label="Préréglage" htmlFor="exp-preset">
            <div className="segmented" role="group">
              {(['single', 'two', 'quarter', 'half', 'year'] as const).map((p) => (
                <button key={p} type="button" className="chip" onClick={() => presetMonths(p)}>
                  {p === 'single' ? '1 mois' : p === 'two' ? '2 mois' : p === 'quarter' ? 'Trimestre' : p === 'half' ? 'Semestre' : 'Année'}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const on = exportMonths.has(m);
            const name = MOIS_FR[m - 1];
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleExportMonth(m)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--border-strong, #ccc)',
                  background: on ? 'var(--accent, #2563eb)' : 'transparent',
                  color: on ? '#fff' : 'inherit',
                  cursor: 'pointer',
                  fontSize: 13,
                  textTransform: 'capitalize',
                  fontWeight: on ? 600 : 400,
                }}
              >
                {name.slice(0, 3)}
              </button>
            );
          })}
        </div>
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={downloadPeriodPdf} disabled={exportBusy || exportMonths.size === 0}>
            {exportBusy && <span className="caret" aria-hidden="true" />}Télécharger PDF ({exportMonths.size} mois)
          </button>
        </div>
      </div>
      {loading && <SkeletonList n={3} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && empty && (
        <EmptyState icon="chart" title="Aucune recette ce mois-ci" text="Les règlements encaissés alimenteront cette fiche." />
      )}
      {!loading && !error && !empty && (
        <>
          <div className="kpi-grid">
            <div className="kpi"><span className="kpi-top">Ouverture</span><span className="kpi-value num">{fcfa(summary?.opening ?? 0)}</span><span className="kpi-sub">Report du mois précédent</span></div>
            <div className="kpi featured"><span className="kpi-top">Recettes (mouvements)</span><span className="kpi-value num">{fcfa(sumIn)}</span><span className="kpi-sub">{inn.length} écritures</span></div>
            <div className="kpi"><span className="kpi-top">Dépenses</span><span className="kpi-value num">{fcfa(sumOut)}</span><span className="kpi-sub">{out.length} écritures</span></div>
            <div className="kpi"><span className="kpi-top">Solde</span><span className="kpi-value num">{fcfa(summary?.balance ?? (sumIn - sumOut))}</span><span className="kpi-sub">{summary?.locked ? 'Mois clôturé (verrouillé)' : `Attendus : ${fcfa(att)}`}</span></div>
          </div>
          <section className="card">
            <CompanyHeader title={`Fiche de recette — ${labelCap}`} sub={summary?.locked ? 'Mois clôturé.' : 'Mois en cours.'} />
            <h3 style={{ marginTop: 12 }}>Recettes</h3>
            <div className="list" style={{ marginTop: 8 }}>
              {inn.map((e) => (
                <div className="leader" key={e.id}>
                  <span className="num">{new Date(e.date).toLocaleDateString('fr-FR')} · {e.voucher} · {e.label}</span>
                  <span className="dots" aria-hidden="true" />
                  <strong className="num">{fcfa(e.amount)}</strong>
                </div>
              ))}
              {inn.length === 0 && <p>Aucune recette sur la période.</p>}
            </div>
            <h3 style={{ marginTop: 12 }}>Dépenses</h3>
            <div className="list" style={{ marginTop: 8 }}>
              {out.map((e) => (
                <div className="leader" key={e.id}>
                  <span className="num">{new Date(e.date).toLocaleDateString('fr-FR')} · {e.voucher} · {e.label}</span>
                  <span className="dots" aria-hidden="true" />
                  <strong className="num">{fcfa(e.amount)}</strong>
                </div>
              ))}
              {out.length === 0 && <p>Aucune dépense sur la période.</p>}
            </div>
            <CompanyFooter />
          </section>
        </>
      )}
    </AppShell>
  );
}
