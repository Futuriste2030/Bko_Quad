import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import { createCustomer, listBookings, listCustomers, type Customer } from '../lib/api';
import { fmtPhone } from '../lib/format';

/* Base clients : constituée à chaque réservation (nom, téléphone, WhatsApp).
   Recherche, création, et réservation directe depuis la fiche. */
export default function Clients() {
  const link = useSiteLink();
  const { notify } = useToast();
  const [items, setItems] = useState<Customer[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
  setLoading(true); setError('');
    Promise.all([listCustomers(), listBookings().catch(() => [])])
      .then(([c, b]) => {
        setItems(c);
        const m: Record<number, number> = {};
        for (const r of b) m[r.customer] = (m[r.customer] ?? 0) + 1;
        setCounts(m);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const rows = useMemo(() => items.filter((c) =>
    !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')),
  ), [items, q]);

  async function submit() {
  setError('');
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) { notify('warning', 'Prénom, nom et téléphone requis', 'Le téléphone identifie le client (unique).'); return; }
    setBusy(true);
    try {
      const c = await createCustomer({ name: `${firstName.trim()} ${lastName.trim()}`, phone: phone.trim(), whatsapp: whatsapp.trim() || undefined });
      notify('success', 'Client enregistré', c.name);
      setOpen(false); setFirstName(''); setLastName(''); setPhone(''); setWhatsapp('');
      load();
    } catch (e) { notify('error', 'Création impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Clients"
        sub={`${items.length} clients au fichier. Chaque réservation alimente cette base.`}
        actions={<button type="button" className="btn btn-accent" onClick={() => setOpen(true)}><Icon name="plus" size={18} />Nouveau client</button>}
      />
      <div className="card">
        <div className="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher nom ou numéro…" aria-label="Rechercher un client" />
        </div>
      </div>
      {loading && <SkeletonList n={4} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState icon="users" title="Aucun client" text="Les clients créés pendant les réservations apparaîtront ici." />
      )}
      {!loading && !error && (
        <div className="list">
          {rows.map((c) => (
            <article className="row-card" key={c.id}>
              <div className="row-top">
                <span className="row-title">{c.name}</span>
                <span className="badge badge-completed"><Icon name="ticket" size={14} />{counts[c.id] ?? 0} rés.</span>
              </div>
              <div className="row-meta">
                <span className="num">{fmtPhone(c.phone)}</span>
                {c.whatsapp && <span className="num">WhatsApp : {fmtPhone(c.whatsapp)}</span>}
                {c.site_name && <span>Site : {c.site_name}</span>}
              </div>
              <div className="btn-row">
                <Link to={link(`/reservations/nouvelle?phone=${encodeURIComponent(c.phone)}`)} className="btn btn-sm btn-accent">
                  <Icon name="plus" size={16} />Réserver
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Nouveau client" onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau client</h2>
            <div className="form-2">
              <Field label="Prénom" required htmlFor="cl-first"><input id="cl-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom du client" autoComplete="given-name" /></Field>
              <Field label="Nom" required htmlFor="cl-name"><input id="cl-name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom du client" autoComplete="family-name" /></Field>
            </div>
            <Field label="Téléphone" required htmlFor="cl-phone" hint="Format international, unique par client."><input id="cl-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+223…" autoComplete="tel" /></Field>
            <Field label="WhatsApp (si différent)" htmlFor="cl-wa"><input id="cl-wa" type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+223…" autoComplete="tel" /></Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
