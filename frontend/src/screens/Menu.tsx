import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell, { NAV_SECTIONS, visibleNav } from '../components/AppShell';
import { PageHeader } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useSync } from '../lib/sync';
import Icon from '../lib/icons';

export default function Menu() {
  const { user, role } = useAuth();
  const { pending, failed } = useSync(user?.id);
  const syncCount = pending + failed;
  const link = useSiteLink();

  return (
    <AppShell>
      <PageHeader title="Menu" sub="Rubriques par thème, selon votre rôle." />
      {NAV_SECTIONS.map((s) => {
        const items = visibleNav(role, s.items)
          .filter((i) => i.to !== '/synchronisation' || syncCount > 0);
        if (items.length === 0) return null;
        return (
          <section key={s.title} aria-label={s.title}>
            <h2 className="small muted" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{s.title}</h2>
            <div className="list">
              {items.map((i) => (
                <Link key={i.to} to={link(i.to)} className="row-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="row-top">
                    <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <Icon name={i.icon} size={22} />
                      <strong>{i.label}</strong>
                      {i.to === '/synchronisation' && syncCount > 0 && <span className="count num">{syncCount}</span>}
                    </span>
                    <Icon name="chevR" size={18} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </AppShell>
  );
}
