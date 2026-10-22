import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import QrCode from '../components/QrCode';
import { ConfirmDialog, Field, PageHeader, Portal } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth, type Role } from '../lib/auth';
import { useCompany } from '../lib/company';
import { useTheme } from '../lib/theme';
import { useToast } from '../lib/toast';
import {
  changePassword, createSite, createUser, getCompany, getVersion, listLines, listSites, listUsers, mediaUrl, resetUserPassword, saveCompany,
  toggleCollect, toggleUserActive, totpEnroll, totpVerify, type AdminUser, type Site, type TrackedLine,
} from '../lib/api';
import { currentPerm, setNotifyEnabled, useNotifyEnabled, type NotifPerm } from '../lib/notifpref';

const ROLES: { v: Role; label: string }[] = [
  { v: 'agent', label: 'Agent de réservation' },
  { v: 'guide', label: 'Guide' },
  { v: 'responsable', label: "Responsable d'agence" },
  { v: 'admin', label: 'Direction / admin' },
  { v: 'superadmin', label: 'Super administrateur (système)' },
  { v: 'comptable', label: 'Comptable' },
];

const SITE_ROLES: Role[] = ['agent', 'guide', 'responsable'];

export default function Settings() {
  const { theme, set } = useTheme();
  const { notify } = useToast();
  const { user, can, refresh: refreshMe } = useAuth();
  const { refresh } = useCompany();
  const mayManageUsers = user?.is_superuser === true || user?.role === 'superadmin';
  const mayManageSites = can('admin');
  const mayCollect = can('responsable', 'admin');
  const [lines, setLines] = useState<TrackedLine[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [sName, setSName] = useState('');
  const [sCity, setSCity] = useState('Bamako');
  const [uName, setUName] = useState('');
  const [uFirst, setUFirst] = useState('');
  const [uLast, setULast] = useState('');
  const [uPhone, setUPhone] = useState('');
  const [uRole, setURole] = useState<Role>('agent');
  const [uSite, setUSite] = useState('');
  const [uPass, setUPass] = useState('');
  const [openU, setOpenU] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cAddr, setCAddr] = useState('');
  const [cNif, setCNif] = useState('');
  const [cRccm, setCRccm] = useState('');
  const [cCond, setCCond] = useState('');
  const [cThanks, setCThanks] = useState('');
  const [cSign, setCSign] = useState('');
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [signFile, setSignFile] = useState<File | null>(null);
  const [stampUrl, setStampUrl] = useState('');
  const [signUrl, setSignUrl] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [totp, setTotp] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [version, setVersion] = useState('…');
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [toggleTarget, setToggleTarget] = useState<AdminUser | null>(null);
  const needsSite = SITE_ROLES.includes(uRole);

  useEffect(() => {
    if (mayManageUsers) {
      listUsers().then(setUsers).catch(() => undefined);
    }
    if (mayManageSites) {
      listSites().then(setSites).catch(() => undefined);
    }
    getVersion().then(setVersion).catch(() => setVersion('—'));
    if (can('responsable', 'admin')) {
      listLines().then(setLines).catch(() => undefined);
    }
    getCompany().then((c) => {
      setCName(c.name); setCPhone(c.phone); setCEmail(c.email); setCAddr(c.address);
      setCNif(c.nif); setCRccm(c.rccm); setCCond(c.conditions); setCThanks(c.thanks); setCSign(c.signature_name);
      setStampUrl(mediaUrl(c.stamp)); setSignUrl(mediaUrl(c.signature));
    }).catch(() => undefined);
  }, [mayManageUsers, mayManageSites, can]);

  /* Coupe-circuit collecte : désactive/réactive la remontée APK par ligne,
     la synchro auto reprend seule quand c'est réactivé. */
  async function flipCollect(l: TrackedLine) {
    setBusy(true);
    try {
      const upd = await toggleCollect(l.id, !l.collect_enabled);
      setLines((ls) => ls.map((x) => (x.id === upd.id ? upd : x)));
      notify(upd.collect_enabled ? 'success' : 'warning',
        upd.collect_enabled ? 'Collecte réactivée' : 'Collecte désactivée',
        `${upd.label} — la synchro auto ${upd.collect_enabled ? 'reprend' : 's’arrête'}.`);
    } catch (e) { notify('error', 'Modification impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function submitReset() {    if (!resetTarget) return;
    if (resetPw.length < 8) { notify('warning', 'Mot de passe trop court', '8 caractères minimum.'); return; }
    setBusy(true);
    try {
      await resetUserPassword(resetTarget.id, resetPw);
      notify('success', 'Mot de passe réinitialisé', resetTarget.username);
      setResetTarget(null); setResetPw('');
    } catch (e) { notify('error', 'Réinitialisation impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }
  /* Désactivation / réactivation : le compte est conservé (audit), seul l'accès est coupé.
     Un compte désactivé ne peut plus se connecter. Jamais sur son propre compte. */
  async function doToggleUser() {
    if (!toggleTarget) return;
    setBusy(true);
    try {
      const upd = await toggleUserActive(toggleTarget.id, !toggleTarget.is_active);
      setUsers((l) => l.map((x) => (x.id === upd.id ? upd : x)));
      notify(upd.is_active ? 'success' : 'warning',
        upd.is_active ? 'Compte réactivé' : 'Compte désactivé',
        `${upd.username} ${upd.is_active ? 'peut de nouveau se connecter.' : 'ne peut plus se connecter.'}`);
      setToggleTarget(null);
    } catch (e) { notify('error', 'Modification impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }
  async function submitUser() {
    if (!uName.trim() || !uPhone.trim() || uPass.length < 8) {
      notify('warning', 'Champs incomplets', 'Identifiant, téléphone et mot de passe (8 min) requis.');
      return;
    }
    if (needsSite && !uSite) {
      notify('warning', 'Site requis', 'Choisissez le site d’appartenance de ce rôle.');
      return;
    }
    setBusy(true);
    try {
      const u = await createUser({
        username: uName.trim(), phone: uPhone.trim(), role: uRole, password: uPass,
        first_name: uFirst.trim(), last_name: uLast.trim(),
        ...(needsSite && uSite ? { site: Number(uSite) } : {}),
      });
      notify('success', 'Utilisateur créé', `${u.username} — ${u.role}.`);
      setUsers((l) => [...l, u]);
      setUName(''); setUFirst(''); setULast(''); setUPhone(''); setUPass(''); setUSite('');
      setOpenU(false);
    } catch (e) { notify('error', 'Création impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function submitSite() {
    const name = sName.trim();
    if (!name) {
      notify('warning', 'Nom requis', 'Saisissez le nom du site.');
      return;
    }
    setBusy(true);
    try {
      const s = await createSite({ name, city: sCity.trim() || 'Bamako' });
      setSites((list) => [...list, s].sort((a, b) => a.name.localeCompare(b.name)));
      setSName('');
      setSCity('Bamako');
      notify('success', 'Site créé', `${s.name} — ${s.city}.`);
    } catch (e) { notify('error', 'Création impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function submitCompany() {
    setBusy(true);
    try {
      await saveCompany({
        name: cName.trim() || 'BKO Quad', phone: cPhone.trim(), email: cEmail.trim(),
        address: cAddr.trim(), nif: cNif.trim(), rccm: cRccm.trim(), conditions: cCond,
        thanks: cThanks.trim(), signature_name: cSign.trim(),
        ...(stampFile ? { stampFile } : {}), ...(signFile ? { signatureFile: signFile } : {}),
      });
      await refresh();
      setStampFile(null); setSignFile(null);
      notify('success', 'Fiche entreprise enregistrée', 'En-têtes et pieds des documents mis à jour.');
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function submitPassword() {
    if (newPw.length < 8) { notify('warning', 'Mot de passe trop court', '8 caractères minimum.'); return; }
    setBusy(true);
    try {
      await changePassword(oldPw, newPw);
      notify('success', 'Mot de passe modifié', 'Utilisez-le à la prochaine connexion.');
      setOldPw(''); setNewPw('');
    } catch (e) { notify('error', 'Modification impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function enroll() {
    setBusy(true);
    try {
      const t = await totpEnroll();
      setTotp(t);
      notify('info', 'Secret généré', 'Scannez le QR dans votre application d’authentification.');
    } catch (e) { notify('error', 'Enrôlement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true);
    try {
      await totpVerify(totpCode.trim());
      await refreshMe();
      notify('success', 'Double authentification activée', 'Le code à 6 chiffres sera demandé à chaque connexion.');
      setTotp(null); setTotpCode('');
    } catch (e) { notify('error', 'Code invalide', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  const [notifPerm, setNotifPerm] = useState<NotifPerm>(() => currentPerm());
  const notifOn = useNotifyEnabled();
  const notifActive = notifPerm === 'granted' && notifOn;

  /* Retour des réglages système : l'autorisation a peut-être changé. */
  useEffect(() => {
    const sync = () => setNotifPerm(currentPerm());
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  async function askNotif() {
    try {
      if (!('Notification' in window)) {
        notify('warning', 'Notifications indisponibles', 'Ce navigateur ne les prend pas en charge.');
        return;
      }
      /* Demande d'autorisation à l'appareil (dialogue système). */
      const p = await Notification.requestPermission();
      setNotifPerm(p);
      if (p === 'granted') {
        setNotifyEnabled(true);
        notify('success', 'Notifications activées', 'Réservations, fins de course, appels : vous serez alerté.');
      } else {
        notify('warning', 'Notifications refusées', 'Autorisez-les dans les réglages du navigateur, puis revenez ici.');
      }
    } catch { /* ignore */ }
  }

  function stopNotif() {
    /* Coupure applicative : le Hub n'envoie plus d'alertes système.
       L'autorisation navigateur reste acquise (voir réglages système pour la retirer). */
    setNotifyEnabled(false);
    notify('info', 'Notifications coupées', 'Le Hub n’enverra plus d’alertes système sur cet appareil.');
  }

  return (
    <AppShell>
      <PageHeader title="Paramètres" sub="Préférences, sites, entreprise, utilisateurs (super admin) et sécurité." />
      <section className="card form">
        <h2>Apparence</h2>
        <Field label="Thème de l’interface" htmlFor="set-theme" hint="Sombre recommandé en extérieur, clair au bureau.">
          <select id="set-theme" value={theme} onChange={(e) => {
            set(e.target.value as 'light' | 'dark');
            notify('info', 'Thème mis à jour', e.target.value === 'dark' ? 'Thème sombre activé.' : 'Thème clair activé.');
          }}>
            <option value="light">Clair</option>
            <option value="dark">Sombre</option>
          </select>
        </Field>
        <div className="btn-row">
          {notifPerm === 'unsupported' && (
            <button type="button" className="btn btn-ghost" disabled>
              <Icon name="bell" size={18} />Notifications indisponibles
            </button>
          )}
          {notifPerm === 'denied' && (
            <button type="button" className="btn btn-ghost" disabled title="Autorisez dans les réglages du navigateur">
              <Icon name="bell" size={18} />Notifications bloquées
            </button>
          )}
          {notifPerm !== 'unsupported' && notifPerm !== 'denied' && !notifActive && (
            <button type="button" className="btn btn-ghost" onClick={askNotif}>
              <Icon name="bell" size={18} />Activer les notifications
            </button>
          )}
          {notifActive && (
            <button type="button" className="btn btn-ghost" onClick={stopNotif}>
              <Icon name="x" size={18} />Désactiver les notifications
            </button>
          )}
        </div>
        {notifPerm === 'denied' && (
          <p className="small muted">Refusées sur cet appareil : autorisez-les dans les réglages du navigateur, puis revenez ici.</p>
        )}
        {notifActive && (
          <p className="small muted">Alertes système activées sur cet appareil (réservations, fins de course, appels).</p>
        )}
      </section>

      {mayCollect && (
        <section className="card form" aria-label="Collecte des appels">
          <h2>Collecte des appels — coupe-circuit</h2>
          <p className="small muted">La synchro APK est automatique. Coupez la remontée par ligne si besoin, réactivez quand c’est réglé — elle reprend seule.</p>
          <div className="list" style={{ marginTop: 8 }}>
            {lines.filter((l) => l.active).map((l) => (
              <div className="row-top" key={l.id}>
                <span><strong>{l.label}</strong>
                  <span className="small muted"> {l.number}{l.site_name ? ` · ${l.site_name}` : ''}</span>
                  <br /><span className="small muted">{l.collect_enabled ? 'Collecte active' : 'Collecte coupée'}</span></span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => flipCollect(l)} disabled={busy}>
                  {l.collect_enabled ? 'Désactiver' : 'Réactiver'}
                </button>
              </div>
            ))}
            {lines.length === 0 && <p className="small muted">Aucune ligne déclarée (voir écran Appels).</p>}
          </div>
        </section>
      )}
      {resetTarget && (
        <Portal><div className="modal-backdrop" onClick={() => !busy && setResetTarget(null)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label={`Réinitialiser ${resetTarget.username}`} onClick={(e) => e.stopPropagation()}>
            <h2>Réinitialiser — {resetTarget.username}</h2>
            <p className="small muted">Communiquez le nouveau mot de passe à l’intéressé par un canal sûr.</p>
            <Field label="Nouveau mot de passe (8 min)" required htmlFor="reset-pw">
              <input id="reset-pw" type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoComplete="new-password" />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setResetTarget(null)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submitReset} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Réinitialiser
              </button>
            </div>
          </div>
        </div></Portal>
      )}

      {mayManageSites && (
        <section className="card form" aria-label="Sites">
          <h2>Sites</h2>
          <p className="small muted">Un site regroupe les formules, créneaux, engins et utilisateurs. Créez-les avant d’ouvrir les réservations.</p>
          <div className="form-2">
            <Field label="Nom du site" required htmlFor="site-name">
              <input id="site-name" value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Ex. Konibabougou" autoComplete="off" />
            </Field>
            <Field label="Ville" htmlFor="site-city">
              <input id="site-city" value={sCity} onChange={(e) => setSCity(e.target.value)} placeholder="Bamako" autoComplete="off" />
            </Field>
          </div>
          <button type="button" className="btn btn-primary" onClick={submitSite} disabled={busy}>
            {busy && <span className="caret" aria-hidden="true" />}Ajouter le site
          </button>
          <div className="list" style={{ marginTop: 12 }}>
            {sites.map((s) => (
              <div className="row-top" key={s.id}>
                <span><strong>{s.name}</strong><span className="small muted"> — {s.city}</span></span>
                <span className="small muted">Site #{s.id}</span>
              </div>
            ))}
            {sites.length === 0 && (
              <p className="small muted">Aucun site configuré. Créez le premier site : sans site, aucune réservation n’est possible.</p>
            )}
          </div>
        </section>
      )}

      {mayManageUsers && (
      <section className="card form">
          <h2>Utilisateurs - super admin</h2>
          <p className="small muted">Créez les comptes selon les rôles : agent, guide, responsable, admin, superadmin, comptable.</p>
          <div className="btn-row" style={{ marginBottom: 8 }}>
            <button type="button" className="btn btn-accent" onClick={() => setOpenU(true)}>
              <Icon name="plus" size={18} />Nouvel utilisateur
            </button>
          </div>
          <div className="list">
            {users.map((u) => (
              <div className="row-top" key={u.id}>
                <span><strong>{[u.first_name, u.last_name].filter(Boolean).join(' ') || u.username}</strong>
                  <span className="small muted"> {u.username} · {u.role}{SITE_ROLES.includes(u.role as Role) ? (u.site_name ? ` · ${u.site_name}` : ' · site non affecté') : ' · tout le réseau'}{u.totp_enabled ? ' · 2FA' : ''}</span>
                  {' '}<span className={`badge ${u.is_active ? 'badge-confirmed' : 'badge-expired'}`}>{u.is_active ? 'Actif' : 'Désactivé'}</span>
                  <br /><span className="small muted num">{u.phone}</span></span>
                <span className="btn-row">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setResetTarget(u); setResetPw(''); }}>Réinitialiser</button>
                  {u.id !== user?.id && (
                    u.is_active
                      ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => setToggleTarget(u)}>Désactiver</button>
                      : <button type="button" className="btn btn-sm btn-accent" onClick={() => setToggleTarget(u)}>Réactiver</button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {toggleTarget && (
            <ConfirmDialog
              title={toggleTarget.is_active ? `Désactiver ${toggleTarget.username} ?` : `Réactiver ${toggleTarget.username} ?`}
              text={toggleTarget.is_active
                ? 'Le compte est conservé (audit) mais la connexion devient impossible immédiatement.'
                : 'Le compte pourra de nouveau se connecter.'}
              confirmLabel={toggleTarget.is_active ? 'Désactiver' : 'Réactiver'}
              danger={toggleTarget.is_active} busy={busy}
              onConfirm={doToggleUser} onClose={() => !busy && setToggleTarget(null)}
            />
          )}
          {openU && (
            <Portal><div className="modal-backdrop" onClick={() => !busy && setOpenU(false)}>
              <div className="modal form" role="dialog" aria-modal="true" aria-label="Nouvel utilisateur" onClick={(e) => e.stopPropagation()}>
                <h2>Nouvel utilisateur</h2>
                <div className="form-2">
                  <Field label="Identifiant" required htmlFor="u-name"><input id="u-name" value={uName} onChange={(e) => setUName(e.target.value)} autoComplete="off" /></Field>
                  <Field label="Téléphone" required htmlFor="u-phone"><input id="u-phone" type="tel" value={uPhone} onChange={(e) => setUPhone(e.target.value)} autoComplete="off" placeholder="Ex. +22370112233" /></Field>
                  <Field label="Prénom" htmlFor="u-first"><input id="u-first" value={uFirst} onChange={(e) => setUFirst(e.target.value)} autoComplete="off" /></Field>
                  <Field label="Nom" htmlFor="u-last"><input id="u-last" value={uLast} onChange={(e) => setULast(e.target.value)} autoComplete="off" /></Field>
                  <Field label="Rôle" required htmlFor="u-role">
                    <select id="u-role" value={uRole} onChange={(e) => {
                      const next = e.target.value as Role;
                      setURole(next);
                      if (!SITE_ROLES.includes(next)) setUSite('');
                    }}>
                      {ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                    </select>
                  </Field>
                  {needsSite ? (
                    <Field label="Site d’appartenance" required htmlFor="u-site" hint="Obligatoire pour les rôles de terrain.">
                      <select id="u-site" value={uSite} onChange={(e) => setUSite(e.target.value)}>
                        <option value="">—</option>
                        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </Field>
                  ) : (
                    <p className="small muted" style={{ alignSelf: 'end', margin: '0 0 10px' }}>
                      Direction, comptable et super admin gèrent tout le réseau : aucun site d’appartenance requis.
                    </p>
                  )}
                  <Field label="Mot de passe (8 min)" required htmlFor="u-pass"><input id="u-pass" type="password" value={uPass} onChange={(e) => setUPass(e.target.value)} autoComplete="new-password" /></Field>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setOpenU(false)} disabled={busy}>Revenir</button>
                  <button type="button" className="btn btn-primary" onClick={submitUser} disabled={busy}>
                    {busy && <span className="caret" aria-hidden="true" />}Créer l’utilisateur
                  </button>
                </div>
              </div>
            </div></Portal>
          )}
        </section>
      )}

      <section className="card form">
        <h2>Entreprise — en-têtes et pieds</h2>
        <div className="form-2">
          <Field label="Nom" htmlFor="c-name"><input id="c-name" value={cName} onChange={(e) => setCName(e.target.value)} /></Field>
          <Field label="Téléphone" htmlFor="c-phone"><input id="c-phone" type="tel" value={cPhone} onChange={(e) => setCPhone(e.target.value)} /></Field>
          <Field label="Adresse mail" htmlFor="c-email"><input id="c-email" type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} /></Field>
          <Field label="Adresse" htmlFor="c-addr"><input id="c-addr" value={cAddr} onChange={(e) => setCAddr(e.target.value)} /></Field>
          <Field label="NIF" htmlFor="c-nif"><input id="c-nif" value={cNif} onChange={(e) => setCNif(e.target.value)} /></Field>
          <Field label="RCCM" htmlFor="c-rccm"><input id="c-rccm" value={cRccm} onChange={(e) => setCRccm(e.target.value)} /></Field>
        </div>
        <Field label="Conditions (pied des documents)" htmlFor="c-cond"><textarea id="c-cond" value={cCond} onChange={(e) => setCCond(e.target.value)} placeholder="Ex. Paiement comptant, pas de remboursement passé le délai…" /></Field>
        <div className="form-2">
          <Field label="Remerciements" htmlFor="c-thanks"><input id="c-thanks" value={cThanks} onChange={(e) => setCThanks(e.target.value)} /></Field>
          <Field label="Signataire" htmlFor="c-sign"><input id="c-sign" value={cSign} onChange={(e) => setCSign(e.target.value)} placeholder="Ex. La Direction" /></Field>
          <Field label="Cachet (image)" htmlFor="c-stamp" hint={stampUrl ? 'Un cachet est déjà en ligne — le remplacer ?' : 'PNG ou JPG, affiché sur les factures.'}>
            <input id="c-stamp" type="file" accept="image/*" onChange={(e) => setStampFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Signature (image)" htmlFor="c-signature" hint={signUrl ? 'Une signature est déjà en ligne.' : 'PNG ou JPG.'}>
            <input id="c-signature" type="file" accept="image/*" onChange={(e) => setSignFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        {(stampUrl || signUrl) && (
          <div className="row-top">
            {stampUrl && <img src={stampUrl} alt="Cachet actuel" style={{ height: 64, objectFit: 'contain' }} />}
            {signUrl && <img src={signUrl} alt="Signature actuelle" style={{ height: 56, objectFit: 'contain' }} />}
          </div>
        )}
        <button type="button" className="btn btn-primary" onClick={submitCompany} disabled={busy}>
          {busy && <span className="caret" aria-hidden="true" />}Enregistrer la fiche
        </button>
      </section>

      <section className="card form">
        <h2>Sécurité — {user?.username}</h2>
        <Field label="Ancien mot de passe" htmlFor="pw-old"><input id="pw-old" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="Nouveau mot de passe (8 min)" htmlFor="pw-new"><input id="pw-new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" /></Field>
        <button type="button" className="btn btn-ghost" onClick={submitPassword} disabled={busy}>Changer mon mot de passe</button>
        <hr className="divider" />
        <h3>Double authentification (TOTP)</h3>
        {user?.totp_enabled ? (
          <p className="row-top" style={{ margin: '8px 0 0' }}>
            <span className="badge badge-completed">2FA déjà active</span>
            <span className="small muted">Le code à 6 chiffres est demandé à chaque connexion — rien d’autre à faire.</span>
          </p>
        ) : !totp ? (
          <button type="button" className="btn btn-ghost" onClick={enroll} disabled={busy}>Enrôler ce téléphone</button>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <QrCode value={totp.otpauth_url} label="QR d’enrôlement TOTP" size={132} />
              <p className="small muted" style={{ maxWidth: 260 }}>Scannez dans Google Authenticator, puis saisissez le code à 6 chiffres.</p>
            </div>
            <Field label="Code à 6 chiffres" htmlFor="totp-code"><input id="totp-code" inputMode="numeric" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="000000" /></Field>
            <button type="button" className="btn btn-primary" onClick={verify} disabled={busy}>
              {busy && <span className="caret" aria-hidden="true" />}Vérifier et activer
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2>À propos</h2>
        <p className="small muted">BKO Quad Hub — PWA agence. API unique, 7 statuts de réservation, montants en FCFA, fuseau Africa/Bamako. WhatsApp via lien wa.me avec numéro Business.</p>
        <div className="leader" style={{ marginTop: 8 }}>
          <span>Version du Hub</span>
          <span className="dots" aria-hidden="true" />
          <strong className="num">{version}</strong>
        </div>
      </section>
    </AppShell>
  );
}
