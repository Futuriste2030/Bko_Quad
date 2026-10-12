import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, useAuth, type Role } from '../lib/auth';
import Icon, { type IconName } from '../lib/icons';
import { ThemeSwitch } from './ui';

export interface NavItem { to: string; label: string; icon: IconName; roles: Role[]; badge?: number }

export const NAV: NavItem[] = [
  { to: '/', label: 'Accueil', icon: 'home', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable', 'client'] },
  { to: '/calendrier', label: 'Calendrier', icon: 'calendar', roles: ['agent', 'guide', 'responsable', 'admin'] },
  { to: '/reservations', label: 'Réservations', icon: 'ticket', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable'] },
  { to: '/appels', label: 'Appels', icon: 'phone', roles: ['agent', 'responsable', 'admin'] },
  { to: '/cloture', label: 'Clôture du jour', icon: 'close', roles: ['agent', 'responsable', 'admin', 'comptable'] },
  { to: '/caisse', label: 'Caisse', icon: 'wallet', roles: ['responsable', 'admin', 'comptable'] },
];

const MOBILE_TABS: NavItem[] = [
  { to: '/', label: 'Accueil', icon: 'home', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable', 'client'] },
  { to: '/calendrier', label: 'Calendrier', icon: 'calendar', roles: ['agent', 'guide', 'responsable', 'admin'] },
  { to: '/reservations', label: 'Réservations', icon: 'ticket', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable'] },
  { to: '/appels', label: 'Appels', icon: 'phone', roles: ['agent', 'responsable', 'admin'] },
  { to: '/menu', label: 'Menu', icon: 'menu', roles: ['agent', 'guide', 'responsable', 'admin', 'comptable', 'client'] },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? 'B') + (parts[1]?.[0] ?? 'Q')).toUpperCase();
}

export default function AppShell({ children, anomalies = 0 }: { children: ReactNode; anomalies?: number }) {
  const { user, role, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setOffline(!navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);

  useEffect(() => { setMenu(false); }, [loc.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, []);

  const visible = (items: NavItem[]) => items.filter((i) => (role ? (i.roles.includes(role) || role === 'admin') : false));
  const name = user?.username ?? 'Utilisateur';
  const roleLabel = role ? ROLE_LABELS[role] : '';

  function doLogout() {
    logout();
    setMenu(false);
    nav('/connexion');
  }

  return (
    <div className="shell">
      {/* Barre latérale (ordinateur) */}
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="side-brand">
          <img src="/android-chrome-192x192.png" alt="BKO Quad" />
          <div><strong>BKO QUAD</strong><small>Hub agence</small></div>
        </div>
        <div className="side-section">Pilotage</div>
        {visible(NAV).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <Icon name={i.icon} size={20} />
            {i.label}
            {i.to === '/appels' && anomalies > 0 && <span className="count num">{anomalies}</span>}
          </NavLink>
        ))}
        <div className="side-foot">
          <div className="side-section">Compte</div>
          <NavLink to="/profil" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <Icon name="user" size={20} />Profil
          </NavLink>
          <NavLink to="/parametres" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <Icon name="settings" size={20} />Paramètres
          </NavLink>
          <span className="role-chip"><span className="dot" aria-hidden="true" />{roleLabel}</span>
        </div>
      </aside>

      {/* Barre supérieure */}
      <header className="topbar">
        <div className="brand">
          <img src="/android-chrome-192x192.png" alt="" aria-hidden="true" />
          <div><strong>BKO QUAD</strong></div>
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <ThemeSwitch compact />
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button type="button" className="avatar-btn" onClick={() => setMenu((m) => !m)}
              aria-haspopup="menu" aria-expanded={menu} title="Ouvrir le menu du compte">
              <span className="avatar" aria-hidden="true">{initials(name)}</span>
              <span className="small" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            </button>
            {menu && (
              <div className="menu" role="menu" style={{ position: 'fixed' }}>
                <div style={{ padding: '8px 12px' }}>
                  <strong>{name}</strong>
                  <div className="small muted">{roleLabel}</div>
                </div>
                <hr />
                <Link to="/profil" role="menuitem" onClick={() => setMenu(false)}><Icon name="user" size={18} />Profil</Link>
                <Link to="/parametres" role="menuitem" onClick={() => setMenu(false)}><Icon name="settings" size={18} />Paramètres</Link>
                <hr />
                <button type="button" role="menuitem" onClick={doLogout}><Icon name="logout" size={18} />Se déconnecter</button>
              </div>
            )}
          </div>
        </div>
      </header>
      {offline && <div className="offline-bar" role="status">Hors ligne — vos saisies sont conservées</div>}

      <div className="shell-body">
        <main className="content">{children}</main>
      </div>

      {/* Onglets bas (mobile, 5 entrées max — guide §5) */}
      <nav className="tabs" aria-label="Navigation principale">
        {visible(MOBILE_TABS).map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} title={t.label} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={t.icon} size={22} />
            <span className="lbl">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
