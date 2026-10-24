import { useEffect, useState } from 'react';
import Icon, { type IconName } from '../lib/icons';

const KEY = 'bko.tutorial.seen';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'home', title: 'Accueil', text: 'Le tableau de bord résume la journée : départs à venir, appels à rapprocher, anomalies en rouge.' },
  { icon: 'ticket', title: 'Réservations', text: 'Créez une réservation en 4 étapes (client, créneau, formule, récap). Le talon et le QR sont générés automatiquement.' },
  { icon: 'phone', title: 'Appels', text: 'Rapprochez chaque appel à une réservation. Un appel non rapproché reste une anomalie persistante.' },
  { icon: 'file', title: 'Factures', text: 'Encaissez les espèces, la facture est émise automatiquement. Téléchargez le PDF pour l’envoyer au client.' },
  { icon: 'settings', title: 'Paramètres', text: 'Gérez les sites, les formules, les utilisateurs et la sécurité (2FA) selon votre rôle.' },
];

export function loadTutorialSeen(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}

export function TutorialGate({ children }: { children: JSX.Element }) {
  const [done, setDone] = useState(loadTutorialSeen);
  if (done) return children;
  return (
    <>
      {children}
      <Tutorial onDone={() => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setDone(true); }} />
    </>
  );
}

export default function Tutorial({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Tutoriel">
      <div className="modal">
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>Passer</button>
        </div>
        <div key={step} className="anim-rise">
          <span className="grid h-14 w-14 place-items-center rounded-xl border-2 border-[var(--border-strong)]">
            <Icon name={STEPS[step].icon} size={28} />
          </span>
          <h2 className="mt-4 text-xl font-bold">{STEPS[step].title}</h2>
          <p className="mt-2 text-base leading-relaxed text-[var(--ink-muted)]">{STEPS[step].text}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '16px 0' }} aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} style={{
              width: 24, height: 6, borderRadius: 3,
              background: i === step ? 'var(--accent)' : 'var(--surface-2)',
              border: '1px solid var(--border-strong)',
            }} />
          ))}
        </div>
        <div className="btn-row">
          {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>Retour</button>}
          {!last
            ? <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>Suivant</button>
            : <button type="button" className="btn btn-accent" onClick={onDone}>Commencer</button>}
        </div>
      </div>
    </div>
  );
}