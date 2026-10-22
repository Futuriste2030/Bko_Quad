import { richTextIsEmpty, toEditorHtml } from '../lib/richText';

/* Rendu en lecture du contenu RH. Les anciens textes simples sont convertis
   en paragraphes ; le HTML enregistré a déjà été nettoyé par le serveur. */
export default function RichTextView({ value, className = '', label }: {
  value: string; className?: string; label?: string;
}) {
  if (richTextIsEmpty(value)) return null;
  return (
    <div
      className={`rich ${className}`.trim()}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: toEditorHtml(value) }}
    />
  );
}
