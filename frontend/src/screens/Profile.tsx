import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { ConfirmDialog, PageHeader } from '../components/ui';
import { ROLE_LABELS, useAuth } from '../lib/auth';
import Icon from '../lib/icons';

export default function Profile() {
  const { user, role, logout } = useAuth();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState(false);

  function doLogout() {
    logout();
    nav('/connexion');
  }

  return (
    <AppShell>
      <PageHeader title="Profil" sub="Votre compte agent sur le Hub. Les droits suivent votre rôle, vérifié par le serveur." />
      <section className="card">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span className="avatar" style={{ width: 56, height: 56, fontSize: 'var(--text-xl)' }} aria-hidden="true">
            {(user?.username ?? 'B').slice(0, 2).toUpperCase()}
          </span>
          <div>
            <h2 style={{ margin: 0 }}>{user?.username ?? '—'}</h2>
            <p style={{ margin: 0 }}>{role ? ROLE_LABELS[role] : 'Rôle inconnu'} · {user?.phone ?? '—'}</p>
          </div>
        </div>
        <hr className="divider" />
        <div className="stack">
          <div className="leader"><span className="muted">Double authentification (TOTP)</span><span className="dots" aria-hidden="true" /><strong>{user?.totp_enabled ? 'Activée' : 'Prévue avant le pilote'}</strong></div>
          <div className="leader"><span className="muted">Fuseau d’affichage</span><span className="dots" aria-hidden="true" /><strong>Africa/Bamako</strong></div>
        </div>
      </section>
      <section className="card">
        <h2>Session</h2>
        <p>Fermez la session sur un téléphone partagé à chaque fin de service.</p>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => setConfirm(true)}>
            <Icon name="logout" size={18} />Se déconnecter
          </button>
        </div>
      </section>
      {confirm && (
        <ConfirmDialog
          title="Se déconnecter ?"
          text="Vous devrez saisir à nouveau votre identifiant et votre mot de passe."
          confirmLabel="Se déconnecter" danger
          onConfirm={doLogout} onClose={() => setConfirm(false)}
        />
      )}
    </AppShell>
  );
}
