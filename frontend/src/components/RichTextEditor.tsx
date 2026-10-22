import { useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eraser,
  Highlighter, Indent, Italic, Link2, Link2Off, List, ListOrdered, Minus,
  Outdent, Redo2, Strikethrough, TextQuote, Underline, Undo2,
} from 'lucide-react';

const BLOCKS = [
  { value: 'p', label: 'Paragraphe' },
  { value: 'h2', label: 'Titre 1' },
  { value: 'h3', label: 'Titre 2' },
  { value: 'blockquote', label: 'Citation' },
];

function ToolButton({ label, active, onClick, children }: {
  label: string; active?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rich-tool"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/* Éditeur riche léger, sans dépendance (commandes natives du navigateur).
   Le HTML initial n'est posé qu'au montage : la frappe ne réinjecte jamais
   le contenu et le curseur reste en place. Le serveur nettoie le HTML. */
export default function RichTextEditor({
  value, onChange, id = 'rich-editor', placeholder = '',
}: {
  value: string; onChange: (value: string) => void;
  id?: string; placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [initialHtml] = useState(value);
  const [color, setColor] = useState('#0a0a0a');
  const [highlight, setHighlight] = useState('#fbf1df');
  const [, setTick] = useState(0);

  const refresh = () => setTick((tick) => tick + 1);

  function exec(command: string, argument?: string) {
    ref.current?.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* navigateur */ }
    try { document.execCommand(command, false, argument); } catch { /* commande ignorée */ }
    onChange(ref.current?.innerHTML ?? '');
    refresh();
  }

  function insertLink() {
    const selected = window.getSelection()?.toString().trim();
    if (!selected) {
      window.alert('Sélectionnez d’abord le texte à transformer en lien.');
      return;
    }
    const url = window.prompt('Adresse du lien (https://…)', 'https://');
    if (url && /^https?:\/\/.+\..+/i.test(url.trim())) {
      exec('createLink', url.trim());
    }
  }

  function pastePlainText(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    try {
      document.execCommand('insertText', false, text);
    } catch {
      ref.current?.append(document.createTextNode(text));
    }
    onChange(ref.current?.innerHTML ?? '');
    refresh();
  }

  const active = (command: string): boolean => {
    try { return document.queryCommandState(command); } catch { return false; }
  };

  return (
    <div className="rich-editor">
      <div className="rich-toolbar" role="toolbar" aria-label="Mise en forme du document">
        <span className="rich-group">
          <ToolButton label="Annuler" onClick={() => exec('undo')}><Undo2 size={18} /></ToolButton>
          <ToolButton label="Rétablir" onClick={() => exec('redo')}><Redo2 size={18} /></ToolButton>
        </span>
        <span className="rich-group">
          <select
            aria-label="Style de paragraphe"
            title="Style de paragraphe"
            className="rich-select"
            defaultValue="p"
            onChange={(event) => exec('formatBlock', event.target.value)}
          >
            {BLOCKS.map((block) => <option key={block.value} value={block.value}>{block.label}</option>)}
          </select>
        </span>
        <span className="rich-group">
          <ToolButton label="Gras" active={active('bold')} onClick={() => exec('bold')}><Bold size={18} /></ToolButton>
          <ToolButton label="Italique" active={active('italic')} onClick={() => exec('italic')}><Italic size={18} /></ToolButton>
          <ToolButton label="Souligné" active={active('underline')} onClick={() => exec('underline')}><Underline size={18} /></ToolButton>
          <ToolButton label="Barré" active={active('strikeThrough')} onClick={() => exec('strikeThrough')}><Strikethrough size={18} /></ToolButton>
        </span>
        <span className="rich-group">
          <label className="rich-color" title="Couleur du texte" aria-label="Couleur du texte">
            <span aria-hidden="true" style={{ color }}>A</span>
            <input type="color" value={color} onChange={(event) => {
              setColor(event.target.value);
              exec('foreColor', event.target.value);
            }} />
          </label>
          <label className="rich-color" title="Surlignage" aria-label="Surlignage">
            <Highlighter size={18} style={{ color: highlight }} />
            <input type="color" value={highlight} onChange={(event) => {
              setHighlight(event.target.value);
              exec('hiliteColor', event.target.value);
            }} />
          </label>
        </span>
        <span className="rich-group">
          <ToolButton label="Liste à puces" active={active('insertUnorderedList')} onClick={() => exec('insertUnorderedList')}><List size={18} /></ToolButton>
          <ToolButton label="Liste numérotée" active={active('insertOrderedList')} onClick={() => exec('insertOrderedList')}><ListOrdered size={18} /></ToolButton>
          <ToolButton label="Retrait" onClick={() => exec('indent')}><Indent size={18} /></ToolButton>
          <ToolButton label="Réduire le retrait" onClick={() => exec('outdent')}><Outdent size={18} /></ToolButton>
        </span>
        <span className="rich-group">
          <ToolButton label="Aligner à gauche" active={active('justifyLeft')} onClick={() => exec('justifyLeft')}><AlignLeft size={18} /></ToolButton>
          <ToolButton label="Centrer" active={active('justifyCenter')} onClick={() => exec('justifyCenter')}><AlignCenter size={18} /></ToolButton>
          <ToolButton label="Aligner à droite" active={active('justifyRight')} onClick={() => exec('justifyRight')}><AlignRight size={18} /></ToolButton>
          <ToolButton label="Justifier" active={active('justifyFull')} onClick={() => exec('justifyFull')}><AlignJustify size={18} /></ToolButton>
        </span>
        <span className="rich-group">
          <ToolButton label="Insérer un lien" onClick={insertLink}><Link2 size={18} /></ToolButton>
          <ToolButton label="Retirer le lien" onClick={() => exec('unlink')}><Link2Off size={18} /></ToolButton>
          <ToolButton label="Citation" onClick={() => exec('formatBlock', 'blockquote')}><TextQuote size={18} /></ToolButton>
          <ToolButton label="Ligne de séparation" onClick={() => exec('insertHorizontalRule')}><Minus size={18} /></ToolButton>
        </span>
        <span className="rich-group">
          <ToolButton label="Effacer la mise en forme" onClick={() => exec('removeFormat')}><Eraser size={18} /></ToolButton>
        </span>
      </div>
      <div
        ref={ref}
        id={id}
        className="rich rich-surface"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Contenu du document"
        data-placeholder={placeholder}
        spellCheck
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        onPaste={pastePlainText}
        onMouseUp={refresh}
        onKeyUp={refresh}
        dangerouslySetInnerHTML={{ __html: initialHtml }}
      />
    </div>
  );
}
