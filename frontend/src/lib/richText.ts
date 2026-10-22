/* Texte des documents RH : bascule entre ancien texte simple et HTML de
   l'éditeur enrichi. Le serveur nettoie le HTML avant stockage ; ici on ne
   fait que préserver les paragraphes des documents déjà enregistrés. */

const HTML_TAG = /<\/?[a-z][^>]*>/i;

export function looksLikeHtml(value: string): boolean {
  return HTML_TAG.test(value || '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function plainTextToHtml(value: string): string {
  if (!value) return '';
  return value
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export function toEditorHtml(value: string): string {
  if (!value) return '';
  return looksLikeHtml(value) ? value : plainTextToHtml(value);
}

export function richTextIsEmpty(value: string): boolean {
  return !value
    || !value
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\u00a0/g, ' ')
      .trim();
}
