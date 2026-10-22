/* J : état de la file hors ligne + rejeu automatique au retour du réseau. */

import { useCallback, useEffect, useState } from 'react';
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

  const reload = useCallback(async () => {
    try { setOps(await allOps()); } catch { setOps([]); }
  }, []);

  useEffect(() => {
    void reload();
    return onQueueChange(() => { void reload(); });
  }, [reload]);

  const sync = useCallback(async () => {
    setRunning(true);
    try {
      const report = await flushQueue();
      await reload();
      return report;
    } catch {
      return null;
    } finally {
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

/* Rejeu automatique : au retour du réseau, puis toutes les minutes tant que
   la file n'est pas vide (le téléphone peut rester en veille). */
export function SyncWatcher() {
  const { pending, sync } = useSync();

  useEffect(() => {
    const on = () => { void sync(); };
    window.addEventListener('online', on);
    const id = window.setInterval(() => {
      if (pending > 0 && navigator.onLine) void sync();
    }, 60000);
    return () => { window.removeEventListener('online', on); window.clearInterval(id); };
  }, [pending, sync]);

  return null;
}
