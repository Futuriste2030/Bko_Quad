import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import { ConfirmDialog, Field, PageHeader, Portal } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import {
  cancelBooking, checkInBooking, completeBooking, listActivities, listBookings, listSlots,
  type Activity, type Booking, type Slot,
} from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';
import { parseScanned } from '../components/QrCode';
import decodeQR from '@paulmillr/qr/decode.js';
import { useSync } from '../lib/sync';
import {
  clearRide, extendRide, fmtCountdown, getRide, listRides, markAlerted, remainingMs,
  startRide, useNow, type Ride,
} from '../lib/ride';
import { showSystemNotification } from '../lib/notifpref';

/* Contrôle du guide : scan d'arrivée (confirmée → arrivée, minuteur lancé
   sur la durée de la formule), puis second scan de fin (arrivée → terminée).
   À la fin du minuteur, l'app alerte : scannez pour clôturer. */
export default function Scanner() {
  const link = useSiteLink();
  const { notify } = useToast();
  const [params] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [supported] = useState(() => typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia);
  const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  /* Cause la plus fréquente sur téléphone : page ouverte en HTTP (réseau local),
     or la caméra exige un contexte sécurisé (HTTPS ou localhost). */
  const [insecure] = useState(() => typeof window !== 'undefined' && !window.isSecureContext);
  const [manual, setManual] = useState('');
  const [camera, setCamera] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [res, setRes] = useState('');
  const [camError, setCamError] = useState('');
  const [found, setFound] = useState<Booking | null>(null);
  const [miss, setMiss] = useState('');
  const [confirm, setConfirm] = useState<'checkin' | 'complete' | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendMin, setExtendMin] = useState('30');
  const [extendReason, setExtendReason] = useState('');
  const [extendBusy, setExtendBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rides, setRides] = useState<Ride[]>(() => listRides());
  const [expired, setExpired] = useState<Ride[]>([]);
  const foundRef = useRef<Booking | null>(null);
  foundRef.current = found;
  /* J : réservations saisies hors ligne (le talon n'existe pas encore). */
  const { ops } = useSync();

  const lookup = useCallback(async (raw: string) => {
    const needle = parseScanned(raw);
    if (!needle) return;
    try {
      const all = await listBookings();
      const b = all.find((x) => x.code.toUpperCase() === needle
        || (x.qr_token && raw.trim().includes(x.qr_token)));
      if (b) {
  setFound(b); setMiss('');
        stopCam();
        notify('info', 'Talon retrouvé', `${b.code} — vérifiez le client avant de valider.`);
      } else {
        setFound(null);
        const local = ops.find((o) => o.kind === 'booking'
          && String(o.meta.code ?? '').toUpperCase() === needle);
        setMiss(local
          ? `Code ${needle} en attente de synchronisation : le talon n'existe pas encore dans le Hub.`
          : `Code ${needle} inconnu. Client sans réservation : alertez le responsable.`);
      }
    } catch (e) { notify('error', 'Recherche impossible', e instanceof Error ? e.message : ''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, ops]);

  /* Arrivée depuis l'écran Réservations : /scanner?code=BKO-… */
  useEffect(() => {
    const code = params.get('code');
    if (code) void lookup(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCam() {
  streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera(false);
    setPlaying(false);
  }

  /* Attend la première image, sinon faux (utile pour basculer de caméra). */
  function waitPlaying(video: HTMLVideoElement, ms: number): Promise<boolean> {
    if (video.readyState >= 3) return Promise.resolve(true);
    return new Promise((resolve) => {
      const to = window.setTimeout(() => {
        resolve(video.readyState >= 3);
      }, ms);
      video.addEventListener('playing', () => {
        window.clearTimeout(to);
        resolve(true);
      }, { once: true });
    });
  }

  /* Caméras essayées dans l'ordre : arrière, puis défaut. */
  const TRIES: MediaStreamConstraints[] = [
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false },
  ];
  const tryRef = useRef(0);
  const [attach, setAttach] = useState(0);

  /* Acquisition seule : le branchement attend que la vidéo soit affichée
     (sinon srcObject part dans le vide = cadre noir permanent). */
  async function acquire(i: number): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(TRIES[i]);
      const [track] = stream.getVideoTracks();
      if (!track || track.readyState === 'ended') {
  stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      track.onended = () => {
        setCamError('Caméra interrompue par l’appareil : relancez-la.');
        stopCam();
      };
      track.onmute = () => setPlaying(false);
      track.onunmute = () => setPlaying(true);
      streamRef.current = stream;
      return true;
    } catch {
      return false;
    }
  }

  async function startCam() {
  setCamError(''); setMiss(''); setFound(null); setPlaying(false); setRes('');
    stopCam();
    tryRef.current = 0;
    if (await acquire(0)) {
  setCamera(true);
      setAttach((a) => a + 1);
    } else if (await acquire(1)) {
  tryRef.current = 1;
      setCamera(true);
      setAttach((a) => a + 1);
    } else {
      setCamError('Caméra inaccessible : vérifiez l’autorisation, puis réessayez sur le téléphone du guide.');
    }
  }

  /* Branchement du flux sur la vidéo affichée + vérification de l'image.
     En cas de noir persistant, bascule automatique sur l'autre caméra. */
  useEffect(() => {
    if (!camera || !supported) return;
    let alive = true;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.muted = true;
    void video.play().catch(() => undefined);
    void (async () => {
      const ok = await waitPlaying(video, 5000);
      if (!alive) return;
      if (ok) {
  setPlaying(true);
        if (video.videoWidth > 0) setRes(`${video.videoWidth}×${video.videoHeight}`);
        return;
      }
      /* Noir persistant : on libère et on tente l'autre caméra. */
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const next = tryRef.current + 1;
      if (next < TRIES.length && alive) {
  tryRef.current = next;
        if (await acquire(next)) {
  if (!alive) return;
          setAttach((a) => a + 1);
          return;
        }
      }
      if (alive) {
  setCamera(false);
        setCamError('Image introuvable : caméra occupée (fermez l’autre application) ou objectif couvert.');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, attach, supported]);

  useEffect(() => {
    if (!camera || !supported) return;
    let alive = true;
    let last = 0;
    const tick = async () => {
      if (!alive) return;
      const now = Date.now();
      if (now - last > 600 && videoRef.current && videoRef.current.readyState >= 2 && !foundRef.current) {
  last = now;
        try {
          let raw: string | null = null;
          if (hasBarcodeDetector) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const D = (window as any).BarcodeDetector;
            const det = new D({ formats: ['qr_code'] });
            const codes = await det.detect(videoRef.current);
            if (codes.length > 0) raw = String(codes[0].rawValue ?? '');
          } else {
            const v = videoRef.current;
            const canvas = canvasRef.current ?? document.createElement('canvas');
            if (!canvasRef.current) canvasRef.current = canvas;
            const w = v.videoWidth || 640;
            const h = v.videoHeight || 480;
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(v, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              try { raw = decodeQR({ width: w, height: h, data: img.data }) || null; }
              catch { raw = null; }
            }
          }
          if (raw && alive) { await lookup(raw); return; }
        } catch { /* image illisible : on réessaie */ }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { alive = false; };
  }, [camera, supported, lookup]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  /* Minuteurs : chaque seconde, on signale une seule fois les sorties finies. */
  const now = useNow(rides.length > 0);
  useEffect(() => {
    if (rides.length === 0) return;
    const done = rides.filter((r) => remainingMs(r, now) <= 0 && !r.alerted);
    if (done.length === 0) return;
    for (const r of done) {
  markAlerted(r.code);
      notify('warning', 'Course terminée', `${r.code} : la durée est écoulée, scannez le QR pour clôturer.`);
      try {
        void showSystemNotification('Course terminée', `${r.code} : scannez le QR pour clôturer.`, 'ride');
      } catch { /* notification système indisponible */ }
    }
    setRides(listRides());
    setExpired((prev) => {
      const known = new Set(prev.map((r) => r.code));
      return [...prev, ...done.filter((r) => !known.has(r.code))];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  async function durationOf(b: Booking): Promise<number> {
    try {
      const [slots, acts] = await Promise.all([
        listSlots().catch(() => [] as Slot[]),
        listActivities().catch(() => [] as Activity[]),
      ]);
      const slot = slots.find((s) => s.id === b.slot);
      const act = acts.find((a) => a.id === slot?.activity);
      return act?.duration_minutes && act.duration_minutes > 0 ? act.duration_minutes : 60;
    } catch { return 60; }
  }

  async function doCheckIn() {
  if (!found) return;
    setBusy(true);
    try {
      const b = await checkInBooking(found.id);
      const mins = await durationOf(b);
      const ride = startRide(b.id, b.code, mins);
      setRides(listRides());
      setExpired((prev) => prev.filter((r) => r.code !== b.code.toUpperCase()));
      setFound(b); setConfirm(null);
      try {
        if ('Notification' in window && Notification.permission === 'default') {
  void Notification.requestPermission();
        }
      } catch { /* ignore */ }
      notify('success', 'Arrivée validée', `${b.code} — minuteur ${mins} min lancé, le talon est consommé.`);
      void ride;
    } catch (e) { notify('error', 'Validation impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function doComplete() {
  if (!found) return;
    const ride = getRide(found.code);
    if (ride && remainingMs(ride) > 0) {
      notify('warning', 'Course non terminée', 'Le minuteur n’est pas écoulé. Attendez la fin ou annulez avec motif.');
      return;
    }
    setBusy(true);
    try {
      const b = await completeBooking(found.id);
      clearRide(b.code);
      setRides(listRides());
      setExpired((prev) => prev.filter((r) => r.code !== b.code.toUpperCase()));
      setFound(b); setConfirm(null);
      notify('success', 'Sortie terminée', `${b.code} — quads de retour, transition tracée.`);
    } catch (e) { notify('error', 'Clôture impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function submitExtend() {
    if (!found) return;
    const ride = getRide(found.code);
    if (!ride) return;
    const n = Math.max(1, Math.round(Number(extendMin)));
    if (!extendReason.trim()) { notify('warning', 'Motif requis', 'Indiquez la raison de la rallonge.'); return; }
    setExtendBusy(true);
    try {
      extendRide(found.code, n, extendReason.trim());
      setRides(listRides());
      notify('success', 'Temps rallongé', `+${n} min — ${extendReason.trim()}.`);
      setExtendOpen(false); setExtendReason('');
    } finally { setExtendBusy(false); }
  }
  async function submitCancel() {
    if (!found) return;
    if (!cancelReason.trim()) { notify('warning', 'Motif requis', 'Indiquez la raison de l’annulation.'); return; }
    setCancelBusy(true);
    try {
      await cancelBooking(found.id, cancelReason.trim());
      clearRide(found.code);
      setRides(listRides());
      setFound(null);
      setCancelOpen(false); setCancelReason('');
      notify('success', 'Course annulée', `${found.code} — annulation tracée.`);
    } catch (e) { notify('error', 'Annulation impossible', e instanceof Error ? e.message : ''); }
    finally { setCancelBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader title="Scanner" sub="Le guide scanne à l’arrivée (minuteur lancé), puis scanne au retour pour terminer. Sans réservation enregistrée, le Hub alerte." />
      {!supported && (
        <div className="banner banner-warning" role="alert"><Icon name="alert" size={20} />
          <div><strong>Caméra indisponible : {insecure ? 'connexion non sécurisée (HTTP).' : 'appareil ou navigateur incompatible.'}</strong>
          <div className="small">{insecure
            ? 'La caméra exige HTTPS : sur le PC utilisez localhost, sur le téléphone passez en HTTPS (voir Paramètres réseau) ou saisissez le code ci-dessous.'
            : 'Ex. Safari sur iPhone : ouvrez le Hub dans Chrome sur Android, ou saisissez le code ci-dessous.'}</div></div>
        </div>
      )}
      {!supported && (
        <section className="card form" aria-label="Saisie manuelle du talon">
          <h2>Saisie manuelle du talon</h2>
          <p className="small muted">Recopiez le code imprimé sur le talon, puis recherchez : la validation et le minuteur fonctionnent pareil.</p>
          <Field label="Code du talon" required htmlFor="scan-manual">
            <input id="scan-manual" value={manual} onChange={(e) => setManual(e.target.value)}
              placeholder="Ex. BKO-261012-4GDN" autoComplete="off" autoCapitalize="characters" />
          </Field>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => lookup(manual)} disabled={!manual.trim()}>
              <Icon name="search" size={18} />Rechercher le talon
            </button>
          </div>
        </section>
      )}
      {camError && <div className="alert-error" role="alert">{camError}</div>}

      {expired.filter((r) => remainingMs(r, now) <= 0).map((r) => (
        <div className="banner banner-danger" key={r.code} role="alert">
          <Icon name="clock" size={20} />
          <div><strong>Course terminée — {r.code}.</strong>
          <div className="small">Scannez le QR du talon pour clôturer la sortie.</div></div>
        </div>
      ))}

      {rides.length > 0 && (
        <section className="card" aria-label="Sorties en cours">
          <h2>Sorties en cours ({rides.length})</h2>
          <div className="list" style={{ marginTop: 8 }}>
            {rides.map((r) => {
              const left = remainingMs(r, now);
              const total = Math.max(1, r.endsAt - r.startedAt);
              const pct = Math.max(0, Math.min(100, (left / total) * 100));
              return (
                <div className="row-card" key={r.code}>
                  <div className="row-top">
                    <span className="row-title num">{r.code}</span>
                    <strong className={`num ${left <= 0 ? 'badge badge-pending_deposit' : ''}`} aria-label={left <= 0 ? 'Durée écoulée' : 'Temps restant'}>
                      {left <= 0 ? 'À clôturer' : fmtCountdown(left)}
                    </strong>
                  </div>
                  <div className="meter" role="progressbar" aria-valuenow={Math.round(100 - pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progression de ${r.code}`}>
                    <span style={{ width: `${100 - pct}%` }} />
                  </div>
                  <div className="row-meta"><span className="num">Formule {r.durationMin} min</span></div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {supported && !camera && !found && (
        <button type="button" className="btn btn-primary" onClick={startCam}>
          <Icon name="scan" size={18} />Activer la caméra
        </button>
      )}
      {camera && !found && (
        <section className="card">
          <h2>Visez le QR du talon</h2>
          <div className="video-wrap">
            <video ref={videoRef} playsInline muted autoPlay
              aria-label="Aperçu caméra pour le QR"
              onPlaying={(e) => {
                setPlaying(true);
                const v = e.currentTarget;
                if (v.videoWidth > 0) setRes(`${v.videoWidth}×${v.videoHeight}`);
              }}
              onWaiting={() => setPlaying(false)} />
          </div>
          {!playing && <p className="small muted">Démarrage de l’image… si elle reste noire, relancez la caméra.</p>}
          {playing && res && <p className="small muted num">Image {res} — visez le QR.</p>}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => void startCam()}>Relancer la caméra</button>
            <button type="button" className="btn btn-ghost" onClick={stopCam}>Couper la caméra</button>
          </div>
        </section>
      )}
      {miss && <div className="banner banner-danger" role="alert"><Icon name="alert" size={20} /><div><strong>Talon inconnu.</strong><div className="small">{miss}</div></div></div>}

      {found && (
        <article className="card" role="status">
          <div className="row-top">
            <span className="stub num">{found.code}</span>
            <StatusBadge status={found.status} />
          </div>
          <hr className="divider" />
          <div className="row-meta"><span className="num">{fmtSlot(found.expires_at)}</span><span className="num">{found.persons} pers. · {found.quads} quads</span></div>
          <div className="row-top"><strong className="num">{fcfa(found.total)}</strong><span className="small muted num">Reste dû : {fcfa(Math.max(0, found.total - found.deposit_due))}</span></div>
          {found.status === 'checked_in' && getRide(found.code) && (
            <div className="row-meta" style={{ marginTop: 4 }}>
              <span className="num">Minuteur : {fmtCountdown(remainingMs(getRide(found.code)!, Date.now()))}</span>
            </div>
          )}
          <div className="btn-row" style={{ marginTop: 8 }}>
            {(found.status === 'confirmed' || found.status === 'pending_deposit') && (
              <button type="button" className="btn btn-accent" onClick={() => setConfirm('checkin')}>
                <Icon name="check" size={18} />Valider l’arrivée
              </button>
            )}
            {found.status === 'checked_in' && (
              <button type="button" className="btn btn-primary" onClick={() => setConfirm('complete')}>
                <Icon name="check" size={18} />Terminer la sortie
              </button>
            )}
            {found.status === 'checked_in' && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setExtendOpen(true)}>
                  <Icon name="clock" size={18} />Rallonger
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setCancelOpen(true)}>
                  <Icon name="x" size={18} />Annuler la course
                </button>
              </>
            )}
            {found.status === 'checked_in' && (
              <Link to={link("/factures")} className="btn btn-ghost">Encaisser le solde</Link>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => { setFound(null); if (supported) void startCam(); }}>
              Scanner suivant
            </button>
          </div>
          {found.status !== 'confirmed' && found.status !== 'pending_deposit' && found.status !== 'checked_in' && (
            <p className="small muted">Ce talon ne peut plus servir (statut actuel : {found.status}).</p>
          )}
        </article>
      )}

      {confirm && found && (
        <ConfirmDialog
          title={confirm === 'checkin' ? `Valider l’arrivée de ${found.code} ?` : `Terminer la sortie ${found.code} ?`}
          text={confirm === 'checkin'
            ? 'Le talon est consommé : un second scan du même code sera refusé. Le minuteur démarre.'
            : 'La sortie est clôturée après le retour des quads. Transition tracée.'}
          confirmLabel={confirm === 'checkin' ? 'Valider l’arrivée' : 'Terminer la sortie'}
          busy={busy}
          onConfirm={confirm === 'checkin' ? doCheckIn : doComplete}
          onClose={() => !busy && setConfirm(null)}
        />
      )}
      {extendOpen && found && (
        <Portal><div className="modal-backdrop" onClick={() => !extendBusy && setExtendOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Rallonger la course" onClick={(e) => e.stopPropagation()}>
            <h2>Rallonger la course</h2>
            <p className="small muted">Sans impact sur le prix : on anticipe un imprévu (réparation, retard). Le minuteur est prolongé.</p>
            <Field label="Minutes à ajouter" required htmlFor="ex-min">
              <input id="ex-min" inputMode="numeric" value={extendMin} onChange={(e) => setExtendMin(e.target.value)} placeholder="30" />
            </Field>
            <Field label="Motif" required htmlFor="ex-reason">
              <input id="ex-reason" value={extendReason} onChange={(e) => setExtendReason(e.target.value)} placeholder="Ex. réparation moteur" />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setExtendOpen(false)} disabled={extendBusy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submitExtend} disabled={extendBusy}>
                {extendBusy && <span className="caret" aria-hidden="true" />}Rallonger
              </button>
            </div>
          </div>
        </div></Portal>
      )}
      {cancelOpen && found && (
        <Portal><div className="modal-backdrop" onClick={() => !cancelBusy && setCancelOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Annuler la course" onClick={(e) => e.stopPropagation()}>
            <h2>Annuler la course en cours</h2>
            <p className="small muted">Annulation tracée avec motif. Le talon repasse en annulé.</p>
            <Field label="Motif d’annulation" required htmlFor="cx-reason">
              <input id="cx-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Ex. panne moteur" />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setCancelOpen(false)} disabled={cancelBusy}>Revenir</button>
              <button type="button" className="btn btn-accent" onClick={submitCancel} disabled={cancelBusy}>
                {cancelBusy && <span className="caret" aria-hidden="true" />}Annuler la course
              </button>
            </div>
          </div>
        </div></Portal>
      )}
    </AppShell>
  );
}
