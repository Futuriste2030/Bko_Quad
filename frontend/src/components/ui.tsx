import { useEffect, useRef, type ReactNode } from 'react';
import Icon, { type IconName } from '../lib/icons';
import { useTheme } from '../lib/theme';

/* En-tête d'écran : titre + description + actions. */
export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="page-row">
      <div className="page-head">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="btn-row" style={{ minWidth: 200 }}>{actions}</div>}
    </div>
  );
}

/* Champ accessible : libellé au-dessus, 16px min, erreur avec conseil. */
export function Field({ label, required, hint, error, children, htmlFor }: {
  label: string; required?: boolean; hint?: string; error?: string; children: ReactNode; htmlFor?: string;
}) {
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error" role="alert"><Icon name="alert" size={15} />{error}</span>}
    </div>
  );
}

/* Bouton icône seul : toujours un libellé accessible. */
export function IconButton({ icon, label, ...rest }: {
  icon: IconName; label: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`icon-btn${rest.className ? ` ${rest.className}` : ''}`} title={label} aria-label={label} {...rest}>
      <Icon name={icon} size={20} />
    </button>
  );
}

/* Interrupteur jour / nuit. */
export function ThemeSwitch({ compact }: { compact?: boolean }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button" className="switch" role="switch" aria-checked={dark}
      onClick={toggle} title={dark ? 'Passer en thème clair' : 'Passer en thème sombre'}
      aria-label={dark ? 'Passer en thème clair' : 'Passer en thème sombre'}
    >
      <span className="track" aria-hidden="true"><span className="thumb" /></span>
      {!compact && (dark ? 'Sombre' : 'Clair')}
      <Icon name={dark ? 'moon' : 'sun'} size={16} />
    </button>
  );
}

/* État vide : pictogramme + phrase + action. */
export function EmptyState({ icon = 'quad', title, text, action }: {
  icon?: IconName; title: string; text?: string; action?: ReactNode;
}) {
  return (
    <div className="card empty">
      <Icon name={icon} size={40} />
      <strong className="strong">{title}</strong>
      {text && <p className="typed">{text}</p>}
      {action}
    </div>
  );
}

export function SkeletonList({ n = 3 }: { n?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Chargement en cours">
      {Array.from({ length: n }).map((_, i) => <div className="skeleton" key={i} />)}
    </div>
  );
}

/* Dialogue de confirmation : toute action destructive. */
export function ConfirmDialog({ title, text, confirmLabel, danger, busy, onConfirm, onClose }: {
  title: string; text: string; confirmLabel: string; danger?: boolean;
  busy?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title} ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Revenir</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy && <span className="caret" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
