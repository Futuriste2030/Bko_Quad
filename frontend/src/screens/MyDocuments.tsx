import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import RichTextView from '../components/RichTextView';
import SignaturePad from '../components/SignaturePad';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import {
  downloadPdf, myHRDocuments, signHRDocument,
  type Contract, type HRLetter, type MyHRDocuments,
} from '../lib/api';
import { fcfa, fmtDate } from '../lib/format';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';

type Document = { type: 'contract'; data: Contract } | { type: 'letter'; data: HRLetter };

function title(doc: Document): string {
  return doc.type === 'contract' ? `Contrat ${doc.data.reference}` : (doc.data.title || doc.data.kind_label);
}

function dateLabel(value: string | null): string {
  return value ? fmtDate(value) : '—';
}

function details(doc: Document): string[] {
  if (doc.type === 'contract') {
    const c = doc.data;
    return [
      `Poste : ${c.job_title || c.employee_role}`,
      `Salaire de base : ${fcfa(c.base_salary)}`,
      `Début : ${dateLabel(c.start)}`,
      c.end ? `Fin : ${dateLabel(c.end)}` : 'Durée indéterminée',
    ];
  }
  const letter = doc.data;
  const rows = [`Type : ${letter.kind_label}`, `Date : ${dateLabel(letter.date)}`];
  if (letter.effective_date) rows.push(`Effet : ${dateLabel(letter.effective_date)}`);
  if (letter.amount) rows.push(`Prime : ${fcfa(letter.amount)}`);
  if (letter.new_salary) rows.push(`Nouveau salaire : ${fcfa(letter.new_salary)}`);
  if (letter.new_job_title) rows.push(`Nouveau poste : ${letter.new_job_title}`);
  return rows;
}

/* Espace salarié : uniquement les documents envoyés par la direction.
   La signature exige le nom complet, un tracé et le consentement. */
export default function MyDocuments() {
  const { notify } = useToast();
  const [data, setData] = useState<MyHRDocuments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [signing, setSigning] = useState<Document | null>(null);
  const [fullName, setFullName] = useState('');
  const [signature, setSignature] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true); setError('');
    myHRDocuments()
      .then((d) => { setData(d); setFullName(d.employee?.name ?? ''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const documents = useMemo<Document[]>(() => {
    if (!data) return [];
    return [
      ...data.contracts.map((c) => ({ type: 'contract' as const, data: c })),
      ...data.letters.map((l) => ({ type: 'letter' as const, data: l })),
    ].sort((a, b) => {
      const pa = a.data.status === 'pending_signature' ? 0 : 1;
      const pb = b.data.status === 'pending_signature' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return b.data.created_at.localeCompare(a.data.created_at);
    });
  }, [data]);

  const pending = documents.filter((d) => d.data.status === 'pending_signature');

  function key(doc: Document): string { return `${doc.type}-${doc.data.id}`; }

  async function openPdf(doc: Document) {
    try {
      const label = doc.data.has_pdf ? '' : '-apercu';
      await downloadPdf(`/${doc.type === 'contract' ? 'contracts' : 'hr-letters'}/${doc.data.id}/pdf/`,
        `${doc.data.reference}${label}.pdf`);
    } catch (e) { notify('error', 'PDF indisponible', e instanceof Error ? e.message : ''); }
  }

  function startSign(doc: Document) {
    setSigning(doc);
    setOpen(key(doc));
    setFullName(data?.employee?.name ?? '');
    setSignature('');
    setConsent(false);
  }

  async function submitSign(e: React.FormEvent) {
    e.preventDefault();
    if (!signing) return;
    if (!fullName.trim()) { notify('warning', 'Nom requis', 'Écrivez votre nom complet.'); return; }
    if (!signature) { notify('warning', 'Signature requise', 'Dessinez votre signature.'); return; }
    if (!consent) { notify('warning', 'Consentement requis', 'Confirmez avoir lu et accepté le document.'); return; }
    setBusy(true);
    try {
      const collection = signing.type === 'contract' ? 'contracts' : 'hr-letters';
      await signHRDocument(collection, signing.data.id, {
        full_name: fullName.trim(), signature, consent,
      });
      notify('success', 'Document signé', `${title(signing)} — signature enregistrée.`);
      setSigning(null); setSignature(''); setConsent(false); setOpen(null);
      load();
    } catch (err) {
      notify('error', 'Signature impossible', err instanceof Error ? err.message : '');
    } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Mes documents"
        sub="Contrats et courriers envoyés par la direction : lisez, puis signez en ligne."
      />
      {loading && <SkeletonList />}
      {!loading && error && <div className="card"><p className="error" role="alert">{error}</p></div>}
      {!loading && !error && !data?.employee && (
        <EmptyState
          icon="file"
          title="Aucun dossier salarié"
          text="Votre compte n'est pas encore relié à un dossier salarié. Contactez la direction pour recevoir vos documents."
        />
      )}
      {!loading && !error && data?.employee && (
        <>
          <div className="card form" style={{ marginBottom: 12 }}>
            <div className="row-top">
              <div>
                <strong>{data.employee.name}</strong>
                <div className="small muted">
                  {data.employee.role}{data.employee.site_name ? ` — ${data.employee.site_name}` : ''}
                </div>
              </div>
              <span className={`badge ${pending.length ? 'badge-pending_signature' : 'badge-signed'}`}>
                <Icon name={pending.length ? 'clock' : 'check'} size={14} />
                {pending.length ? `${pending.length} à signer` : 'À jour'}
              </span>
            </div>
          </div>

          {documents.length === 0 && (
            <EmptyState
              icon="file"
              title="Aucun document"
              text="Vous n'avez encore reçu aucun contrat ni courrier. Ils apparaîtront ici dès leur envoi."
            />
          )}

          {documents.map((doc) => {
            const d = doc.data;
            const isOpen = open === key(doc);
            const maySign = d.status === 'pending_signature';
            return (
              <section className="card hr-doc" key={key(doc)}>
                <div className="row-top">
                  <div>
                    <strong>{title(doc)}</strong>
                    <div className="small muted">
                      {d.reference} — {d.employee_site_name || 'Bamako'}
                    </div>
                  </div>
                  <span className={`badge badge-${d.status}`}>
                    <Icon name={d.status === 'signed' ? 'check' : d.status === 'pending_signature' ? 'clock' : d.status === 'cancelled' ? 'x' : 'file'} size={14} />
                    {d.status_label}
                  </span>
                </div>
                <ul className="hr-meta">
                  {details(doc).map((row) => <li key={row}>{row}</li>)}
                </ul>
                {d.status === 'signed' && (
                  <p className="small muted">
                    Signé le {dateLabel(d.signed_at)} par {d.employee_signer_name || d.employee_name}.
                  </p>
                )}
                {isOpen && (
                  <RichTextView value={d.content} className="hr-content" label={`Texte de ${title(doc)}`} />
                )}
                <div className="btn-row">
                  <button type="button" className="btn btn-ghost" onClick={() => setOpen(isOpen ? null : key(doc))}>
                    <Icon name={isOpen ? 'x' : 'file'} size={18} />{isOpen ? 'Masquer' : 'Lire'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void openPdf(doc)}>
                    <Icon name="download" size={18} />{d.has_pdf ? 'PDF signé' : 'Aperçu PDF'}
                  </button>
                  {maySign && (
                    <button type="button" className="btn btn-primary" onClick={() => startSign(doc)} disabled={busy}>
                      Signer
                    </button>
                  )}
                </div>

                {signing && key(signing) === key(doc) && (
                  <form className="form" onSubmit={submitSign} style={{ marginTop: 12 }}>
                    <p className="small muted">
                      Signature électronique simple : votre nom, votre tracé et votre consentement sont horodatés.
                    </p>
                    <Field label="Nom complet" required htmlFor={`hr-name-${d.id}`}>
                      <input id={`hr-name-${d.id}`} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
                    </Field>
                    <Field label="Signature manuscrite" required hint="Au doigt sur téléphone, à la souris sur ordinateur.">
                      <SignaturePad value={signature} onChange={setSignature} disabled={busy} />
                    </Field>
                    <label className="checkline">
                      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                      <span>J'ai lu et j'accepte ce document.</span>
                    </label>
                    <div className="btn-row">
                      <button type="button" className="btn btn-ghost" onClick={() => { setSigning(null); setSignature(''); setConsent(false); }} disabled={busy}>
                        Annuler
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={busy || !consent || !signature || !fullName.trim()}>
                        {busy && <span className="caret" aria-hidden="true" />}Signer le document
                      </button>
                    </div>
                  </form>
                )}
              </section>
            );
          })}
        </>
      )}
    </AppShell>
  );
}
