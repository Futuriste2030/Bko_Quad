/* Formats guide section 7 : FCFA, dates jj/mm/aaaa, téléphone +223. */

export const fcfa = (n: number): string =>
  `${Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ')} FCFA`;

export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const fmtSlot = (iso: string): string => {
  const d = new Date(iso);
  const days = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${days[d.getDay()]} ${date} ${time}`;
};

export const fmtPhone = (e164: string): string => {
  const digits = e164.replace(/\D/g, '').replace(/^223/, '');
  if (digits.length !== 8) return e164;
  return `+223 ${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)}`;
};
