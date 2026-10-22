import { useEffect, useState } from 'react';
import Icon, { type IconName } from '../lib/icons';

type PStatus = 'unknown' | 'granted' | 'denied' | 'unavailable';

const SLIDES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'ticket',
    title: 'Bienvenue sur BKO Quad Hub',
    text: 'L’unique source de vérité des réservations : chaque réservation, chaque appel et chaque franc y sont tracés.',
  },
  {
    icon: 'scan',
    title: 'Talon et QR',
    text: 'Chaque réservation génère un talon avec QR. Le guide le scanne à l’arrivée : un code déjà utilisé est refusé.',
  },
  {
    icon: 'wallet',
    title: 'Argent tracé dès l’origine',
    text: 'Encaissements, factures à numéro unique, caisse et fiche de recette mensuelle — sans double comptabilisation.',
  },
];

const STATUS_LABEL: Record<PStatus, string> = {
  unknown: 'Demander',
  granted: 'Accordée',
  denied: 'Refusée — modifiable dans le navigateur',
  unavailable: 'Indisponible sur cet appareil',
};

/* Première utilisation : présentation puis autorisations
   (notifications, caméra pour le scanner, position). Tout est
   optionnel : on ne bloque jamais l’accès à la connexion. */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [notif, setNotif] = useState<PStatus>('unknown');
  const [cam, setCam] = useState<PStatus>('unknown');
  const [geo, setGeo] = useState<PStatus>('unknown');
  const last = step === SLIDES.length;

  useEffect(() => {
    try {
      if ('Notification' in window && Notification.permission === 'granted') setNotif('granted');
    } catch { /* ignore */ }
  }, []);

  async function askNotif() {
    try {
      if (!('Notification' in window)) { setNotif('unavailable'); return; }
      const p = await Notification.requestPermission();
      setNotif(p === 'granted' ? 'granted' : 'denied');
    } catch { setNotif('denied'); }
  }

  async function askCam() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) { setCam('unavailable'); return; }
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      s.getTracks().forEach((t) => t.stop());
      setCam('granted');
    } catch { setCam('denied'); }
  }

  function askGeo() {
    try {
      if (!('geolocation' in navigator)) { setGeo('unavailable'); return; }
      navigator.geolocation.getCurrentPosition(
        () => setGeo('granted'),
        () => setGeo('denied'),
        { timeout: 10000 },
      );
    } catch { setGeo('denied'); }
  }

  function Perm({ icon, title, text, status, ask }: {
    icon: IconName; title: string; text: string; status: PStatus; ask: () => void;
  }) {
    return (
      <div className="row-card">
        <div className="row-top">
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Icon name={icon} size={22} />
            <strong>{title}</strong>
          </span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>{text}</p>
        <div className="btn-row">
          {status === 'unknown'
            ? <button type="button" className="btn btn-sm btn-ghost" onClick={ask}>Autoriser</button>
            : <span className={`badge ${status === 'granted' ? 'badge-confirmed' : 'badge-expired'}`}>{STATUS_LABEL[status]}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4 py-10">
        <div className="anim-rise rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-[3px_3px_0_var(--ink)] sm:p-8">
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>Passer</button>
          </div>

          {!last ? (
            <div key={step} className="anim-rise">
              <span className="grid h-14 w-14 place-items-center rounded-xl border-2 border-[var(--border-strong)]">
                <Icon name={SLIDES[step].icon} size={28} />
              </span>
              <h1 className="mt-4 text-2xl font-bold">{SLIDES[step].title}</h1>
              <p className="mt-2 text-base leading-relaxed text-[var(--ink-muted)]">{SLIDES[step].text}</p>
            </div>
          ) : (
            <div key="perms" className="anim-rise">
              <h1 className="text-2xl font-bold">Autorisations</h1>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Pour profiter de tout le Hub. Refuser ne bloque rien — c’est modifiable plus tard.
              </p>
              <div className="stack" style={{ marginTop: 12 }}>
                <Perm icon="bell" title="Notifications" text="Alertes réservations, reçus, anomalies et appels." status={notif} ask={askNotif} />
                <Perm icon="scan" title="Caméra" text="Scanner les QR des talons à l’arrivée." status={cam} ask={askCam} />
                <Perm icon="info" title="Position" text="Situer l’agence et les sites lors des contrôles." status={geo} ask={askGeo} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '16px 0' }} aria-hidden="true">
            {[...Array(SLIDES.length + 1)].map((_, i) => (
              <span key={i} style={{
                width: 28, height: 6, borderRadius: 3,
                background: i === step ? 'var(--accent)' : 'var(--surface-2)',
                border: '1px solid var(--border-strong)',
              }} />
            ))}
          </div>

          <div className="btn-row">
            {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>Retour</button>}
            {!last
              ? <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>Continuer</button>
              : <button type="button" className="btn btn-accent" onClick={onDone}>Commencer</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
