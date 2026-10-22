import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { TotpRequiredError } from '../lib/api';
import Icon, { type IconName } from '../lib/icons';
import { useToast } from '../lib/toast';
import { ThemeSwitch } from '../components/ui';

const POINTS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'ticket',
    title: 'Réservations intégralement tracées',
    text: 'Sept statuts officiels, toute modification exige un motif — aucune suppression n’est possible.',
  },
  {
    icon: 'phone',
    title: 'Chaque appel rapproché',
    text: 'Un appel non lié à une réservation reste signalé comme anomalie jusqu’à justification.',
  },
  {
    icon: 'wallet',
    title: 'Argent suivi dès l’origine',
    text: 'Paiements, caisse et bordereau de clôture sont rattachés à la réservation dès l’encaissement.',
  },
];

const inputCls =
  'h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [otp, setOtp] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();
  const { notify } = useToast();

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    if (!username.trim()) { setError('Saisissez votre identifiant pour continuer.'); return; }
    if (!password) { setError('Saisissez votre mot de passe pour continuer.'); return; }
    setBusy(true);
    try {
      await login(username.trim(), password, otp.replace(/\s/g, ''));
      notify('success', 'Connexion réussie', 'Bienvenue sur le Hub BKO Quad.');
      nav('/');
    } catch (err) {
      if (err instanceof TotpRequiredError) {
        setTotpRequired(true);
        setOtp('');
        setError('Code de double authentification obligatoire. Ouvrez votre application de codes, puis saisissez les 6 chiffres.');
      } else if (err instanceof TotpRequiredError || /code/i.test(err instanceof Error ? err.message : '')) {
        setTotpRequired(true);
        setError(err instanceof Error ? err.message : 'Code invalide.');
      } else {
        setError(err instanceof Error ? err.message : 'Connexion impossible.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-dvh bg-[var(--bg)] text-[var(--ink)]">
      <div className="absolute right-4 top-4">
        <ThemeSwitch compact />
      </div>

      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-center gap-10 px-4 py-14 sm:px-6 lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-center">
        {/* Marque */}
        <div className="anim-rise">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-black bg-[var(--accent)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-black">
            Espace agence
          </span>
          <div className="mt-4 flex items-center gap-4">
            <img
              src="/android-chrome-192x192.png"
              alt="Logo BKO Quad"
              className="h-16 w-16 rounded-2xl border border-[var(--border)] object-contain sm:h-20 sm:w-20"
            />
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-[var(--ink-muted)]">Bamako · Quad</p>
              <h1 className="typewrite text-3xl font-extrabold leading-tight sm:text-4xl">BKO Quad Hub</h1>
            </div>
          </div>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--ink-muted)]">
            Plateforme officielle de gestion des réservations BKO Quad : paiements,
            appels, caisse et clôture du jour, centralisés et synchronisés avec l’API.
          </p>
          <ul className="mt-6 grid max-w-md gap-3">
            {POINTS.map((p) => (
              <li
                key={p.title}
                className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <span className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-[var(--border-strong)]">
                  <Icon name={p.icon} size={20} />
                </span>
                <span>
                  <strong className="block text-base">{p.title}</strong>
                  <span className="block text-sm text-[var(--ink-muted)]">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Carte de connexion */}
        <form
          onSubmit={submit}
          aria-label="Connexion au Hub"
          style={{ animationDelay: '70ms' }}
          className="anim-rise w-full rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-[3px_3px_0_var(--ink)] sm:p-8"
        >
          <h2 className="text-2xl font-bold">Connexion</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Réservée au personnel de l’agence.</p>

          {error && (
            <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--danger)] p-3 text-sm font-semibold text-white">
              <Icon name="alert" size={18} />
              {error}
            </div>
          )}

          <div className="mt-5 grid gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="login-u" className="text-sm font-semibold">
                Identifiant <span aria-hidden="true" className="text-[var(--danger)]">*</span>
              </label>
              <input
                id="login-u" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" placeholder="Ex. agent.bamako" disabled={busy}
                className={inputCls}
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="login-p" className="text-sm font-semibold">
                Mot de passe <span aria-hidden="true" className="text-[var(--danger)]">*</span>
              </label>
              <div className="relative">
                <input
                  id="login-p" type={showPw ? 'text' : 'password'}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" placeholder="Votre mot de passe" disabled={busy}
                  className={`${inputCls} pr-12`}
                />
            {totpRequired && (
              <div className="grid gap-1.5">
                <label htmlFor="login-otp" className="text-sm font-semibold">
                  Code de double authentification <span aria-hidden="true" className="text-[var(--danger)]">*</span>
                </label>
                <input
                  id="login-otp" value={otp} onChange={(e) => setOtp(e.target.value)}
                  inputMode="numeric" autoComplete="one-time-code"
                  placeholder="6 chiffres" disabled={busy} maxLength={6}
                  className={`${inputCls} tracking-[0.4em] text-center`}
                />
              </div>
            )}

            <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  aria-pressed={showPw}
                  className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  {showPw ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-[var(--ink)] bg-[var(--ink)] text-base font-bold text-[var(--bg)] shadow-[3px_3px_0_var(--border-strong)] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-60"
            >
              {busy && <span aria-hidden="true" className="caret on-ink" />}
              Se connecter
            </button>

            <p className="text-center text-sm text-[var(--ink-muted)]">
              {totpRequired
                ? 'Ouvrez votre application d’authentification, le code change toutes les 30 secondes.'
                : 'Compte créé par votre responsable. La vérification en deux étapes sera exigée avant le pilote.'}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
