import { useEffect, useRef, useState } from 'react';
import AppShell from '../components/AppShell';
import { CompanyFooter, CompanyHeader } from '../components/CompanyDoc';
import SiteFilter from '../components/SiteFilter';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { createNotice, listNotices, publishNotice, type Notice } from '../lib/api';

/* Communication : communiqués de la boîte + lettres officielles.
   Éditeur complet sans dépendance (commandes natives) : styles, titres,
   listes, alignements, citation, lien, nettoyage, annuler/rétablir. */
function Editor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cmd(c: string, v?: string) {
    ref.current?.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* ignore */ }
    document.execCommand(c, false, v);
    onChange(ref.current?.innerHTML ?? '');
    refresh();
  }

  function link() {
    setLinkUrl('https://');
    setLinkOpen(true);
  }

  function confirmLink() {
    const url = linkUrl.trim();
    if (!url || url === 'https://') { setLinkOpen(false); return; }
    if (!/^https?:\/\//i.test(url)) return;
    setLinkOpen(false);
    cmd('createLink', url);
  }

  const on = (c: string): boolean => {
    try { return document.queryCommandState(c); } catch { return false; }
  };

  const Btn = ({ label, active, onClick, children }: {
    label: string; active?: boolean; onClick: () => void; children: React.ReactNode;
  }) => (
    <button type="button" className="btn btn-sm btn-ghost" aria-label={label} title={label}
      aria-pressed={active ?? false}
      style={active ? { borderColor: 'var(--border-strong)', background: 'var(--surface-2)' } : undefined}
      onClick={onClick}>{children}</button>
  );

  return (
    <div>
      <div className="btn-row no-print" role="toolbar" aria-label="Mise en forme" style={{ marginBottom: 8 }}>
        <Btn label="Gras" active={on('bold')} onClick={() => cmd('bold')}><strong>B</strong></Btn>
        <Btn label="Italique" active={on('italic')} onClick={() => cmd('italic')}><em>I</em></Btn>
        <Btn label="Souligné" active={on('underline')} onClick={() => cmd('underline')}><span style={{ textDecoration: 'underline' }}>U</span></Btn>
        <Btn label="Barré" active={on('strikeThrough')} onClick={() => cmd('strikeThrough')}><span style={{ textDecoration: 'line-through' }}>S</span></Btn>
        <Btn label="Titre de section" onClick={() => cmd('formatBlock', 'h3')}>Titre</Btn>
        <Btn label="Texte normal" onClick={() => cmd('formatBlock', 'p')}>Texte</Btn>
        <Btn label="Liste à puces" active={on('insertUnorderedList')} onClick={() => cmd('insertUnorderedList')}>Puces</Btn>
        <Btn label="Liste numérotée" active={on('insertOrderedList')} onClick={() => cmd('insertOrderedList')}>1•2•3</Btn>
        <Btn label="Aligner à gauche" active={on('justifyLeft')} onClick={() => cmd('justifyLeft')}>⇤</Btn>
        <Btn label="Centrer" active={on('justifyCenter')} onClick={() => cmd('justifyCenter')}>⇔</Btn>
        <Btn label="Aligner à droite" active={on('justifyRight')} onClick={() => cmd('justifyRight')}>⇥</Btn>
        <Btn label="Justifier" active={on('justifyFull')} onClick={() => cmd('justifyFull')}>≣</Btn>
        <Btn label="Citation" onClick={() => cmd('formatBlock', 'blockquote')}>« »</Btn>
        <Btn label="Insérer un lien" onClick={link}>Lien</Btn>
        <Btn label="Retirer la mise en forme" onClick={() => cmd('removeFormat')}>Nettoyer</Btn>
        <Btn label="Annuler la frappe" onClick={() => cmd('undo')}>↩</Btn>
        <Btn label="Rétablir" onClick={() => cmd('redo')}>↪</Btn>
      </div>
      <div
        ref={ref} contentEditable role="textbox" aria-label="Contenu du document" aria-multiline="true"
        onInput={() => { onChange(ref.current?.innerHTML ?? ''); }}
        onMouseUp={refresh} onKeyUp={refresh}
        className="rich"
        style={{ minHeight: 180, border: '2px solid var(--border-strong)', borderRadius: 'var(--radius-md)', padding: 14, background: 'var(--surface)', lineHeight: 1.7 }}
      />
      {linkOpen && (
        <div className="modal-backdrop" onClick={() => setLinkOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Insérer un lien" onClick={(e) => e.stopPropagation()}>
            <h2>Insérer un lien</h2>
            <Field label="Adresse du lien (https://…)" required htmlFor="ed-link">
              <input id="ed-link" type="url" inputMode="url" value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setLinkOpen(false)}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={confirmLink}>Insérer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function downloadHtml(title: string, inner: string) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>`
    + `<style>body{font-family:monospace;max-width:640px;margin:24px auto;padding:0 16px;color:#0a0a0a}h1{font-size:20px}</style></head>`
    + `<body><h1>${title}</h1>${inner}</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${title}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function Communication() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [tab, setTab] = useState<'communique' | 'lettre'>('communique');
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Notice | null>(null);
  const mayWrite = can('responsable', 'admin');

  function load() {
    setLoading(true); setError('');
    listNotices().then(setItems).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  const rows = items.filter((n) => n.type === tab);

  async function submit(publish: boolean) {
    if (!title.trim() || !content.replace(/<[^>]*>/g, '').trim()) {
      notify('warning', 'Titre et contenu requis', 'Rédigez le document avant de l’enregistrer.');
      return;
    }
    setBusy(true);
    try {
      const n = await createNotice({ type: tab, title: title.trim(), content });
      if (publish) await publishNotice(n.id);
      notify('success', publish ? 'Publié' : 'Brouillon enregistré', title.trim());
      setOpen(false); setTitle(''); setContent('');
      load();
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function doPublish(n: Notice) {
    try {
      await publishNotice(n.id);
      notify('success', 'Publié', n.title);
      setView(null);
      load();
    } catch (e) { notify('error', 'Publication impossible', e instanceof Error ? e.message : ''); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Communication"
        sub="Communiqués de la boîte et lettres officielles, à l’en-tête de l’entreprise."
        actions={mayWrite ? <button type="button" className="btn btn-accent" onClick={() => setOpen(true)}><Icon name="plus" size={18} />Rédiger</button> : undefined}
      />
      <div className="card no-print">
        <SiteFilter hint="Affiche les documents du site et du réseau ; la rédaction suit le site actif." />
      </div>
      <div className="segmented no-print" role="group" aria-label="Type de document">
        <button type="button" className="chip" aria-pressed={tab === 'communique'} onClick={() => setTab('communique')}>Communiqués</button>
        <button type="button" className="chip" aria-pressed={tab === 'lettre'} onClick={() => setTab('lettre')}>Lettres officielles</button>
      </div>
      {loading && <SkeletonList n={3} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState icon="file" title="Aucun document" text="Les communiqués publiés apparaîtront ici et en tête d’affiche." />
      )}
      {!loading && !error && (
        <div className="list">
          {rows.map((n) => (
            <article className="row-card" key={n.id}>
              <div className="row-top">
                <span className="row-title">{n.title}</span>
                <span className={`badge ${n.status === 'published' ? 'badge-confirmed' : 'badge-expired'}`}>
                  {n.status === 'published' ? 'Publié' : 'Brouillon'}
                </span>
              </div>
              <div className="row-meta">
                <span>{n.site_name || 'Tout le réseau'}</span>
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView(n)}>Lire</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {view && (
        <div className="modal-backdrop" onClick={() => setView(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={view.title} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <CompanyHeader title={view.title} sub={`${view.type === 'lettre' ? 'Lettre officielle' : 'Communiqué'} · ${new Date(view.published_at ?? view.created_at).toLocaleDateString('fr-FR')}`} />
            <div dangerouslySetInnerHTML={{ __html: view.content }} style={{ marginTop: 8 }} />
            <CompanyFooter />
            <div className="modal-actions no-print">
              {view.status !== 'published' && mayWrite && (
                <button type="button" className="btn btn-primary" onClick={() => doPublish(view)}>Publier</button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => downloadHtml(view.title, view.content)}>
                <Icon name="download" size={18} />Télécharger
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Imprimer</button>
              <button type="button" className="btn btn-ghost" onClick={() => setView(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Rédiger" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>Rédiger — {tab === 'lettre' ? 'lettre officielle' : 'communiqué'}</h2>
            <Field label="Titre" required htmlFor="nc-title">
              <input id="nc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Fermeture exceptionnelle" />
            </Field>
            <Editor value={content} onChange={setContent} />
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-ghost" onClick={() => submit(false)} disabled={busy}>Brouillon</button>
              <button type="button" className="btn btn-primary" onClick={() => submit(true)} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Publier
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
