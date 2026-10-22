import { useMemo } from 'react';
import { encodeQR } from '@paulmillr/qr';

/* QR du talon à présenter : `BKO:<code>:<jeton>`. Rendu en SVG pur,
   fond blanc permanent (comme un ticket imprimé, lisible en thème sombre). */
export function qrValue(code: string, token: string): string {
  return `BKO:${code}:${token}`;
}

/* Chaîne SVG brute : pour le téléchargement du document (impression pro). */
export function qrSvg(value: string): string {
  return encodeQR(value, 'svg');
}

export default function QrCode({ value, label, size = 148 }: { value: string; label: string; size?: number }) {
  const svg = useMemo(() => encodeQR(value, 'svg'), [value]);
  return (
    <span className="qr-box" style={{ width: size, height: size }} role="img" aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

/* Extrait le code de réservation d'un QR scanné (`BKO:CODE:jeton` ou code brut). */
export function parseScanned(text: string): string {
  const m = text.trim().match(/^BKO:([^:]+):.+$/);
  return (m ? m[1] : text.trim()).toUpperCase();
}
