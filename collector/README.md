# BKO Quad — Collecteur APK (WebView + module natif)

1 seul projet RN, **2 saveurs**, même PWA en ligne (source unique) :

| Saveur | Usage | Permissions | Distribution |
|---|---|---|---|
| `standard` | Tous agents/guides : WebView plein écran vers la PWA | Internet uniquement | Sideload, Play Store possible |
| `collecteur` | **1 téléphone d'entreprise par pays** (Mali +223, CI +225) : WebView + lecture journal d'appels + synchro fond 15 min | `READ_CALL_LOG` + `READ_PHONE_STATE` + `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | **Sideload uniquement** (Play Store refuse `READ_CALL_LOG`) |

## Config par site (1er lancement, écran Config)
- URL Hub : `https://hub.bko-quad.ml/`
- Site : Bamako (Mali) ou Abidjan (Côte d'Ivoire)
- `line_id` : id de la `TrackedLine` (`GET /api/v1/lines/`)
- Compte collecteur dédié (rôle agent) : login → tokens stockés natif (pas en localStorage), refresh auto.

Chaque lot : `POST /api/v1/calls/import/` `{line_id, calls: [{direction, phone_number, started_at, duration_seconds, external_id}]}` — lots ≤ 500, `external_id = {line_id}:{timestamp_ms}:{hash}` idempotent, `last_sync` mis à jour serveur (témoin dans PWA → Écran Appels).

## Build (côté agence, Android Studio, pas de SDK ici)
```powershell
npm install
npx react-native run-android --mode=standardDebug      # APK agence
npx react-native run-android --mode=collecteurDebug     # APK entreprise
```
Voir `build-gradle-flavors.snippet` pour les `productFlavors`. Désactiver l'optimisation batterie à l'install (Tecno/Infinix/Xiaomi/Huawei coupent le fond par défaut).

## Fichiers
- `App.tsx` : WebView + écran Config + synchro (lots ≤ 500 + refresh JWT).
- `CallLogModule.kt` : lecture `CallLog.Calls` depuis `last_ts` (tous Android, aucune API Samsung).
- `SyncWorker.kt` : `WorkManager` 15 min + au démarrage.
- Normalisation serveur : 8 chiffres → +223, 10 chiffres en 0… → +225, défaut = pays de la `line_id`.
