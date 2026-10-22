/* J : état de la file hors ligne + rejeu automatique au retour du réseau. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushQueue, type SyncReport } from './api';
import { allOps, onQueueChange, type QueuedOp } from './offline';

export interface SyncState {
  ops: QueuedOp[];
  pending: number;
  failed: number;
  running: boolean;
  sync: () => Promise<SyncReport | null>;
}

export function useSync(): SyncState {
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const reload = useCallback(async () => {
    try { setOps(await allOps()); } catch { setOps([]); }
  }, []);

  useEffect(() => {
    void reload();
    return onQueueChange(() => { void reload(); });
  }, [reload]);

  const sync = useCallback(async () => {
    if (runningRef.current) return null;
    runningRef.current = true;
    setRunning(true);
    try {
      const report = await flushQueue();
      await reload();
      return report;
    } catch {
      return null;
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [reload]);

  return {
    ops,
    pending: ops.filter((o) => o.status === 'pending').length,
    failed: ops.filter((o) => o.status === 'failed').length,
    running,
    sync,
  };
}

/* Rejeu automatique : dès qu'une saisie en attente apparaît, au retour du
   réseau, au retour au premier plan, puis toutes les minutes (le téléphone
   peut rester en veille). Aucun bouton n'est nécessaire. */
export function SyncWatcher() {
  const { pending, sync } = useSync();

  useEffect(() => {
    const attempt = () => {
      if (pending > 0 && navigator.onLine) void sync();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') attempt();
    };
    window.addEventListener('online', attempt);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(attempt, 60000);
    attempt();
    return () => {
      window.removeEventListener('online', attempt);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [pending, sync]);

  return null;
}
