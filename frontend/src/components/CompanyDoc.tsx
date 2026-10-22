import { useCompany } from '../lib/company';

/* En-tête et pied institutionnels des documents (reçu, facture, rapports),
   aux couleurs du Hub, depuis la fiche entreprise (Paramètres). */
export function CompanyHeader({ title, sub }: { title: string; sub?: string }) {
  const { company } = useCompany();
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <img src="/android-chrome-192x192.png" alt="BKO Quad" style={{ height: 44, width: 44, objectFit: 'contain' }} />
        <div>
          <strong style={{ fontSize: 'var(--text-xl)' }}>{company.name}</strong>
          <div className="small muted">
            {[company.address, company.phone, company.email].filter(Boolean).join(' · ')}
          </div>
          {(company.nif || company.rccm) && (
            <div className="small muted num">NIF : {company.nif || '—'} · RCCM : {company.rccm || '—'}</div>
          )}
        </div>
      </div>
      <h2 style={{ marginTop: 12 }}>{title}</h2>
      {sub && <p className="small muted">{sub}</p>}
    </div>
  );
}

export function CompanyFooter({ showConditions = true }: { showConditions?: boolean }) {
  const { company } = useCompany();
  return (
    <div style={{ marginTop: 16 }}>
      <hr className="divider" />
      {showConditions && company.conditions && <p className="small muted">{company.conditions}</p>}
      <div className="row-top" style={{ marginTop: 8 }}>
        <em className="small">{company.thanks}</em>
        {company.signature_name && <strong className="small">Le responsable : {company.signature_name}</strong>}
      </div>
    </div>
  );
}
