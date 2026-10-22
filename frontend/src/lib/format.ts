/* Formats guide section 7 : FCFA, dates jj/mm/aaaa, téléphone +223. */

export const fcfa = (n: number): string =>
  `${Math.round(n).toLocaleString('fr-FR').replace(/\s/g, '\u202F')} FCFA`;

/* Durée en clair pour le client (H) : « 1 heure », « 2 heures », « 2 jours », « 15 min ». */
export const dureeLibelle = (minutes: number): string => {
  const m = Math.max(0, Math.floor(minutes || 0));
  if (m >= 1440) {
    const d = Math.floor(m / 1440);
    const rem = m % 1440;
    const h = Math.floor(rem / 60);
    return `${d} jour${d > 1 ? 's' : ''}${h ? ` ${h}H` : ''}`;
  }
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (r === 0) return `${h} heure${h > 1 ? 's' : ''}`;
  return `${h}H${String(r).padStart(2, '0')}`;
};

/* Fuseau règle B : stockage UTC, affichage Africa/Bamako (jamais l'heure locale de l'appareil). */

export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Bamako' });
};

export const fmtSlot = (iso: string): string => {
  const d = new Date(iso);
  const days = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Bamako' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Bamako' });
  const bamako = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Bamako' }));
  return `${days[bamako.getDay()]} ${date} ${time}`;
};

/* Direction d'appel : codes API -> français (Entrant = décroché,
   Manqué = non décroché / refusé / bloqué, Sortant = passé depuis la ligne). */
export const fmtDirection = (d: string): string =>
  d === 'inbound' ? 'Entrant' : d === 'outbound' ? 'Sortant'
  : d === 'missed' ? 'Manqué' : d;

export const fmtPhone = (e164: string): string => {
  const digits = e164.replace(/\D/g, '').replace(/^223/, '');
  if (digits.length !== 8) return e164;
  return `+223 ${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)}`;
};

/* Comparaison insensible aux accents (données multi-sources). */
export const norm = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const codePart = (v: string, len: number): string => {
  const ascii = v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (ascii || 'X').slice(0, len);
};

/* N° affiché facture : BKO-{SITE}-{CLIENT}-{JJMMAAAA}-{NNNN}.
   Le compteur (NNNN) vient du serveur (compteur unique, sans doublon). */
export const factureNumber = (seq: number, site: string, client: string, at: Date = new Date()): string => {
  const d = `${String(at.getDate()).padStart(2, '0')}${String(at.getMonth() + 1).padStart(2, '0')}${at.getFullYear()}`;
  return `BKO-${codePart(site, 12)}-${codePart(client, 8)}-${d}-${String(seq).padStart(4, '0')}`;
};
