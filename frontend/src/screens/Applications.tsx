import AppShell from '../components/AppShell';
import { PageHeader } from '../components/ui';
import Icon, { type IconName } from '../lib/icons';

interface Apk {
  name: string;
  file: string;
  icon: IconName;
  audience: string;
  description: string;
  details: string[];
  note?: string;
  version: string;
  bytes: number;
}

const APKS: Apk[] = [
  {
    name: 'BKO Hub Standard',
    file: 'bko-hub-standard-v2.0.apk',
    icon: 'quad',
    audience: 'Agents & guides',
    description: 'Ouvre le Hub BKO Quad en plein écran sur Android, comme une application.',
    details: [
      'Connexion Internet requise',
      'Même compte que le Hub',
      'Installation directe ou via le Play Store',
    ],
    version: '1.0',
    bytes: 89279,
  },
  {
    name: 'BKO Hub Collecteur',
    file: 'bko-hub-collecteur-v2.0.apk',
    icon: 'phone',
    audience: 'Téléphone d’entreprise',
    description: 'Remonte le journal d’appels du téléphone et synchronise les appels en arrière-plan.',
    details: [
      'Mali +223 et Côte d’Ivoire +225',
      'Accès au journal d’appels et à l’état du téléphone',
      'Installation hors Play Store (sideload)',
    ],
    note: 'Un seul téléphone collecteur par pays. Désactivez l’optimisation de batterie après l’installation.',
    version: '1.0',
    bytes: 91680,
  },
];

function sizeLabel(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} Ko`;
}

export default function Applications() {
  return (
    <AppShell>
      <PageHeader title="Applications" sub="Téléchargez l’APK adapté à votre usage sur Android." />

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', alignItems: 'start' }}>
        {APKS.map((app) => (
          <article className="card" key={app.file}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                display: 'grid', placeItems: 'center', width: 48, height: 48, flex: 'none',
                border: '2px solid var(--ink)', borderRadius: 'var(--radius-md)',
              }}>
                <Icon name={app.icon} size={26} />
              </span>
              <div style={{ display: 'grid', gap: 4 }}>
                <h2 style={{ margin: 0, padding: 0, border: 0 }}>{app.name}</h2>
                <span className="small muted">Version {app.version} · {sizeLabel(app.bytes)}</span>
              </div>
            </div>

            <p style={{ marginTop: 12 }}>{app.description}</p>
            <span className="badge badge-completed">{app.audience}</span>
            <ul style={{ margin: '12px 0', paddingLeft: 20 }}>
              {app.details.map((detail) => <li key={detail} className="small">{detail}</li>)}
            </ul>
            {app.note && (
              <p className="small">
                <Icon name="alert" size={16} /> {app.note}
              </p>
            )}

            <div className="btn-row" style={{ marginTop: 12 }}>
              <a className="btn btn-primary" href={`/apks/${app.file}`} download={app.file}>
                <Icon name="download" size={18} />Télécharger l’APK
              </a>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>{app.file}</p>
          </article>
        ))}
      </div>

      <p className="small muted" style={{ marginTop: 16 }}>
        Android uniquement. Si le téléphone bloque l’installation, autorisez temporairement les applications de cette source, puis revenez au réglage normal.
      </p>
    </AppShell>
  );
}
