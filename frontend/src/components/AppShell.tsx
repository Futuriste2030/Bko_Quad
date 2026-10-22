import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, useAuth, type Role } from '../lib/auth';
import { useAvatar } from '../lib/avatar';
import Icon, { type IconName } from '../lib/icons';
import { useNotify } from '../lib/notify';
import { siteBase, useSiteLink } from '../lib/sitepath';
import { useSync } from '../lib/sync';
import { ThemeSwitch } from './ui';

export interface NavItem { to: string; label: string; icon: IconName; roles: Role[] }
export interface NavSection { title: string; items: NavItem[] }

const ALL: Role[] = ['agent', 'guide', 'responsable', 'admin', 'superadmin', 'comptable', 'client'];

/* Rubriques par thème (PRD §4 : la barre latérale est organisée par
   département, les entrées visibles dépendent du rôle). */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Exploitation',
    items: [
      { to: '/', label: 'Accueil', icon: 'home', roles: ALL },
      { to: '/calendrier', label: 'Calendrier', icon: 'calendar', roles: ['agent', 'guide', 'responsable', 'admin'] },
      { to: '/reservations', label: 'Réservations', icon: 'ticket', roles: ['agent', 'responsable', 'admin', 'comptable'] },
      { to: '/clients', label: 'Clients', icon: 'users', roles: ['agent', 'responsable', 'admin'] },
      { to: '/creneaux', label: 'Créneaux', icon: 'clock', roles: ['agent', 'guide', 'responsable', 'admin'] },
      { to: '/appels', label: 'Appels', icon: 'phone', roles: ['agent', 'responsable', 'admin'] },
      { to: '/synchronisation', label: 'Synchronisation', icon: 'refresh', roles: ALL },
      { to: '/scanner', label: 'Scanner', icon: 'check', roles: ['guide', 'responsable', 'admin'] },
    ],
  },
  {
    title: 'Flotte',
    items: [
      { to: '/flotte', label: 'Flotte', icon: 'quad', roles: ['guide', 'responsable', 'admin'] },
      { to: '/maintenance', label: 'Maintenance', icon: 'plus', roles: ['responsable', 'admin'] },
    ],
  },
  {
    title: 'Caisse & Finance',
    items: [
      { to: '/cloture', label: 'Clôture du jour', icon: 'close', roles: ['agent', 'responsable', 'admin', 'comptable'] },
      { to: '/caisse', label: 'Caisse', icon: 'wallet', roles: ['responsable', 'admin', 'comptable'] },
      { to: '/banque', label: 'Banque', icon: 'cash', roles: ['responsable', 'admin', 'comptable'] },
      { to: '/depenses', label: 'Dépenses', icon: 'cash', roles: ['responsable', 'admin'] },
      { to: '/factures', label: 'Factures', icon: 'file', roles: ['agent', 'responsable', 'admin', 'comptable'] },
      { to: '/recette', label: 'Recette mensuelle', icon: 'chart', roles: ['responsable', 'admin', 'comptable'] },
      { to: '/exports', label: 'Rapports & exports', icon: 'download', roles: ['agent', 'responsable', 'admin', 'comptable'] },
      { to: '/paie', label: 'Paie', icon: 'users', roles: ['admin', 'comptable'] },
    ],
  },
  {
    title: 'Équipe',
    items: [
      { to: '/mes-documents', label: 'Mes documents', icon: 'file', roles: ALL },
      { to: '/rh', label: 'Contrats & courriers', icon: 'users', roles: ['responsable', 'admin'] },
    ],
  },
  {
    title: 'Communication',
    items: [
      { to: '/communication', label: 'Communication', icon: 'send', roles: ALL },
    ],
  },
  {
    title: 'Compte',
    items: [
      { to: '/applications', label: 'Applications', icon: 'download', roles: ALL },
      { to: '/profil', label: 'Profil', icon: 'user', roles: ALL },
      { to: '/parametres', label: 'Paramètres', icon: 'settings', roles: ALL },
    ],
  },
];

export const NAV: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export function visibleNav(role: Role | null, items: NavItem[]): NavItem[] {
  return items.filter((i) => (role ? (i.roles.includes(role) || role === 'admin' || role === 'superadmin') : false));
}

const MOBILE_TABS: NavItem[] = [
  { to: '/', label: 'Accueil', icon: 'home', roles: ALL },
  { to: '/calendrier', label: 'Calendrier', icon: 'calendar', roles: ['agent', 'guide', 'responsable', 'admin'] },
  { to: '/reservations', label: 'Réservations', icon: 'ticket', roles: ['agent', 'responsable', 'admin', 'comptable'] },
  { to: '/appels', label: 'Appels', icon: 'phone', roles: ['agent', 'responsable', 'admin'] },
  { to: '/menu', label: 'Menu', icon: 'menu', roles: ALL },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? 'B') + (parts[1]?.[0] ?? 'Q')).toUpperCase();
}

export default function AppShell({ children, anomalies = 0 }: { children: ReactNode; anomalies?: number }) {
  const { user, role, logout } = useAuth();
  const avatar = useAvatar();
  const { items: notifs, unread, readAll } = useNotify();
  const nav = useNavigate();
  const loc = useLocation();
  /* Contexte site courant dans l'URL (/s/{id/ou}reseau) : tous les liens
   * de navigation restent dans le même site. */
  const base = siteBase(loc.pathname);
  const link = useSiteLink();
  const toSite = (p: string) => (p === '/' ? base : link(p));
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  /* J : nombre de saisies en attente de rejeu (hors ligne). */
  const { pending } = useSync();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setOffline(!navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);

  useEffect(() => { setMenu(false); setBell(false); }, [loc.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, []);

  const name = user?.username ?? 'Utilisateur';
  const roleLabel = role ? ROLE_LABELS[role] : '';
  const mayScan = role === 'admin' || role === 'superadmin' || role === 'guide' || role === 'responsable';

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
        {NAV_SECTIONS.map((s) => {
          const items = visibleNav(role, s.items);
          if (items.length === 0) return null;
          return (
            <div key={s.title}>
              <div className="side-section">{s.title}</div>
              {items.map((i) => (
                <NavLink key={i.to} to={toSite(i.to)} end={i.to === '/'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                  <Icon name={i.icon} size={20} />
                  {i.label}
                  {i.to === '/appels' && anomalies > 0 && <span className="count num">{anomalies}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div className="side-foot">
          <span className="role-chip"><span className="dot" aria-hidden="true" />{roleLabel}</span>
        </div>
      </aside>

      {/* Barre supérieure */}
      <header className="topbar no-print">
        <div className="brand">
          <img src="/android-chrome-192x192.png" alt="" aria-hidden="true" />
          <div><strong>BKO QUAD</strong></div>
        </div>
        {/* Site du contexte URL : nom réel pour un compte de terrain, réseau sinon. */}
        <span className="badge badge-confirmed" title="Site affiché (définit côté serveur par votre compte)">
          <Icon name={base === '/s/reseau' ? 'chart' : 'calendar'} size={14} />
          {base === '/s/reseau' ? 'Tout le réseau' : (user?.site_name || `Site ${base.slice(3)}`)}
        </span>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <ThemeSwitch compact />
          <div style={{ position: 'relative' }}>
            <button type="button" className="icon-btn plain" aria-label={`Notifications${unread > 0 ? `, ${unread} non lues` : ''}`} title="Notifications"
              aria-expanded={bell} onClick={() => setBell((b) => !b)} style={{ position: 'relative' }}>
              <Icon name="bell" size={20} />
              {unread > 0 && (
                <span className="num" aria-hidden="true" style={{
                  position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, padding: '0 4px',
                  borderRadius: 999, background: 'var(--danger)', color: '#fff',
                  fontSize: 11, fontWeight: 800, display: 'grid', placeContent: 'center',
                }}>{unread}</span>
              )}
            </button>
            {bell && (
              <div className="menu" role="menu" aria-label="Notifications" style={{ position: 'fixed', minWidth: 300 }}>
                <div style={{ padding: '8px 12px' }}><strong>Notifications</strong></div>
                <hr />
                {notifs.length === 0 && <div style={{ padding: '8px 12px' }} className="small muted">Rien de nouveau pour le moment.</div>}
                {notifs.slice(0, 8).map((n, i) => (
                  <Link key={`${n.at}-${i}`} to={toSite(n.link)} role="menuitem" onClick={() => setBell(false)}>
                    <Icon name={n.kind === 'anomaly' ? 'alert' : n.kind === 'call' ? 'phone' : n.kind === 'part' ? 'quad' : n.kind === 'hr' ? 'file' : 'ticket'} size={18} />
                    <span><strong>{n.title}</strong><br /><span className="small muted">{n.body}</span></span>
                  </Link>
                ))}
                {notifs.length > 0 && (
                  <>
                    <hr />
                    <button type="button" role="menuitem" onClick={() => { readAll(); setBell(false); }}>
                      <Icon name="check" size={18} />Tout marquer comme lu
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {mayScan && (
            <Link to={toSite('/scanner')} className="icon-btn plain" aria-label="Scanner un talon" title="Scanner un talon">
              <Icon name="scan" size={20} />
            </Link>
          )}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button type="button" className="avatar-btn" onClick={() => setMenu((m) => !m)}
              aria-haspopup="menu" aria-expanded={menu} title="Ouvrir le menu du compte">
              {avatar ? (
                <img src={avatar} alt="" aria-hidden="true" className="avatar" style={{ objectFit: 'cover' }} />
              ) : (
                <span className="avatar" aria-hidden="true">{initials(name)}</span>
              )}
              <span className="small" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            </button>
            {menu && (
              <div className="menu" role="menu" style={{ position: 'fixed' }}>
                <div style={{ padding: '8px 12px' }}>
                  <strong>{name}</strong>
                  <div className="small muted">{roleLabel}</div>
                </div>
                <hr />
                <Link to={toSite('/profil')} role="menuitem" onClick={() => setMenu(false)}><Icon name="user" size={18} />Profil</Link>
                <Link to={toSite('/parametres')} role="menuitem" onClick={() => setMenu(false)}><Icon name="settings" size={18} />Paramètres</Link>
                <hr />
                <button type="button" role="menuitem" onClick={doLogout}><Icon name="logout" size={18} />Se déconnecter</button>
              </div>
            )}
          </div>
        </div>
      </header>
      {offline && (
        <div className="offline-bar" role="status">
          Hors ligne — {pending > 0
            ? `${pending} saisie${pending > 1 ? 's' : ''} en attente de synchronisation`
            : 'vos saisies sont conservées'}
        </div>
      )}
      {!offline && pending > 0 && (
        <div className="offline-bar sync" role="status">
          {pending} saisie{pending > 1 ? 's' : ''} à synchroniser
          <Link to={toSite('/synchronisation')} className="small">Synchroniser</Link>
        </div>
      )}

      <div className="shell-body">
        <main className="content">{children}</main>
      </div>

      {/* Onglets bas (mobile, 5 entrées max — guide §5) */}
      <nav className="tabs no-print" aria-label="Navigation principale">
        {visibleNav(role, MOBILE_TABS).map((t) => (
          <NavLink key={t.to} to={toSite(t.to)} end={t.to === '/'} title={t.label} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={t.icon} size={22} />
            <span className="lbl">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
