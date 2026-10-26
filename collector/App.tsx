/* BKO Quad Collecteur : WebView plein écran + synchro journal d'appels.
   Saveur `standard` : WebView seule. Saveur `collecteur` : + CallLogModule + SyncWorker.
   Config par site (Mali / CI) saisie au 1er lancement, stockée via AsyncStorage. */
import React, { useEffect, useState } from 'react';
import { Button, NativeModules, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';

const { CallLogModule } = NativeModules as unknown as {
  CallLogModule?: { getCallsSince(lastTs: number): Promise<Array<{
    direction: string; phone_number: string; started_at: string;
    duration_seconds: number; external_id: string }>> };
};
// @ts-ignore flag injectée par Gradle (BuildConfig.FLAVOR)
const IS_COLLECTOR: boolean = (globalThis as any).IS_COLLECTOR ?? true;
const HUB_URL = 'https://app.bkoquad.ml/';

async function refreshAccess(refresh: string): Promise<string> {
  const r = await fetch(`${HUB_URL}api/v1/auth/refresh/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  });
  if (!r.ok) throw new Error('refresh impossible, reconnectez le collecteur.');
  return (await r.json()).access as string;
}

async function syncNow(cfg: { lineId: string; access: string; refresh: string; lastTs: string }) {
  if (!CallLogModule) return { created: 0, skipped: 0, note: 'saveur standard : pas de collecte' };
  const calls = await CallLogModule.getCallsSince(Number(cfg.lastTs || 0));
  let access = cfg.access;
  const post = async (): Promise<Response> => fetch(`${HUB_URL}api/v1/calls/import/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify({ line_id: Number(cfg.lineId), calls: calls.slice(0, 500) }),
  });
  let r = await post();
  if (r.status === 401) { access = await refreshAccess(cfg.refresh); await AsyncStorage.setItem('bko.access', access); r = await post(); }
  if (!r.ok) throw new Error(`import refusé (${r.status})`);
  const data = await r.json();
  // Curseur = le plus récent envoyé (jamais "maintenant").
  const sent = calls.slice(0, 500);
  const maxTs = sent.reduce((m, c) => Math.max(m, Date.parse(c.started_at) || 0), Number(cfg.lastTs || 0));
  await AsyncStorage.setItem('bko.lastTs', String(maxTs));
  return data;
}

export default function App() {
  const [cfg, setCfg] = useState({ lineId: '', site: 'Bamako', access: '', refresh: '', lastTs: '0' });
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    (async () => {
      const keys = ['bko.lineId', 'bko.site', 'bko.access', 'bko.refresh', 'bko.lastTs'];
      const v = await AsyncStorage.multiGet(keys);
      const g = (k: string) => v.find(([key]) => key === k)?.[1] ?? '';
      setCfg({ lineId: g('bko.lineId'), site: g('bko.site') || 'Bamako', access: g('bko.access'), refresh: g('bko.refresh'), lastTs: g('bko.lastTs') || '0' });
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready || !IS_COLLECTOR || !cfg.lineId || !cfg.access) return;
    const id = setInterval(() => {
      syncNow(cfg).then((d: any) => setStatus(`Synchro OK : +${d.created ?? 0}, doublons ${d.skipped ?? 0}`)).catch((e: Error) => setStatus(e.message));
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [ready, cfg]);

  if (!ready) return <View><Text>Chargement…</Text></View>;
  if (!cfg.lineId || !cfg.access) {
    return (
      <View style={{ padding: 24, gap: 8 }}>
        <Text style={{ fontWeight: 'bold' }}>Config collecteur (1 fois, téléphone d'entreprise)</Text>
        <Text>Site (Bamako / Abidjan)</Text>
        <TextInput value={cfg.site} onChangeText={(t) => setCfg({ ...cfg, site: t })} style={{ borderWidth: 1, padding: 8 }} />
        <Text>line_id (GET /api/v1/lines/)</Text>
        <TextInput value={cfg.lineId} onChangeText={(t) => setCfg({ ...cfg, lineId: t })} keyboardType="numeric" style={{ borderWidth: 1, padding: 8 }} />
        <Text>JWT access / refresh (compte collecteur agent)</Text>
        <TextInput value={cfg.access} onChangeText={(t) => setCfg({ ...cfg, access: t })} style={{ borderWidth: 1, padding: 8 }} />
        <TextInput value={cfg.refresh} onChangeText={(t) => setCfg({ ...cfg, refresh: t })} style={{ borderWidth: 1, padding: 8 }} />
        <Button title="Enregistrer" onPress={async () => {
          await AsyncStorage.multiSet([['bko.lineId', cfg.lineId], ['bko.site', cfg.site], ['bko.access', cfg.access], ['bko.refresh', cfg.refresh]]);
          setReady(false); setReady(true);
        }} />
        {!!status && <Text>{status}</Text>}
      </View>
    );
  }
  return (
    <WebView
      source={{ uri: HUB_URL }}
      onMessage={(e) => setStatus(e.nativeEvent.data)}
      injectedJavaScript="window.BkoQuad={isNativeApp:true};true;"
    />
  );
}
