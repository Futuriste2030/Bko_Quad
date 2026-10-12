# BKO Quad Hub — session du 12/10/2026 (soir)

## Où on en est
- Backend : tranches 1-12 figées, 36/36 tests OK.
  Socle Bamako, comptes + TOTP prévu (F), réservations 7 statuts,
  paiements stub idempotents, comms wa.me P1, rapprochement appels,
  API `api/v1/` + JWT + rôles, caisse, paie, audit + expiration auto.
- Frontend PWA : **refonte globale du 12/10** —
  AppShell (sidebar desktop 248px + topbar + onglets bas mobile),
  Dashboard (4 KPI, barres 7 j, donut statuts, aire cumulée, planning, appels),
  écrans Réservations (recherche + filtres + tableau desktop + annulation motivée),
  wizard 4 étapes, Calendrier 14 j, Appels (bannière anomalie + confirmation),
  Clôture (bordereau), Caisse, Profil (logout confirmé), Paramètres (thème), Menu.
  Fondations : `lib/theme` (switch clair/sombre persisté), `lib/auth`
  (rôles agent/guide/responsable/admin/comptable via `/auth/me/`),
  `lib/toast` (succès/erreur/info/attention), `lib/icons` (trait 2px, sans dépendance),
  `components/charts` (SVG pur, sans librairie), `ConfirmDialog` systématique.
  Graphiques sobres (encre + 1 orange), animations 150–220 ms, `prefers-reduced-motion` respecté.
  Build prod OK (tsc + vite, PWA 7 entrées).
- Correctifs du soir : Tailwind CSS v4 (`@tailwindcss/vite`, `src/index.css`
  sans preflight, couleurs via les variables du guide) + `lucide-react`
  (`lib/icons.tsx` = même API, 26 icônes Lucide, trait 2px).
  Login redesigné (grille 2 colonnes desktop, carte ombre dure, œil mot de passe,
  switch thème, badge orange unique). SW : `devOptions.enabled=false`,
  désinscription auto en dev, `cleanupOutdatedCaches`, `/api/` exclu du cache.
  Router : flags futurs v7 activés (warnings disparus).
- Thème « machine à écrire » (soir) : guide §11 (remplace §3 et l'ambiance §4,
  couleurs/contraste/accessibilité/mobile/formats inchangés), Courier Prime
  auto-hébergée (`public/fonts/`, 2 woff2 latin, ~38 Ko). Étape 1 (commit guide
  + jetons), étape 2 (touches, tampons inclinés ≥1024px, talon perforé, conduite
  pointillée, curseur bloc, frappe login ≤1,2 s, tableau ≥1024px).
  Captures 900/390 clair/sombre + 1280 + « 1 250 000 FCFA » vérifiées, build prod OK.
- Reste : 2FA active avant pilote (F), PDF serveur, Celery/Redis prod,
  adaptateur agrégateur réel après doc (H), pilote 1 semaine.

## Lancer le backend (API)
```powershell
pip install -r backend\requirements.txt
python backend\manage.py migrate
python backend\manage.py createsuperuser
python backend\manage.py runserver
```
- API : http://127.0.0.1:8000/api/v1/
- Docs : http://127.0.0.1:8000/api/docs/
- Tests : `python backend\manage.py test accounts telephony common bookings payments comms finance payroll audit`
  (lancer depuis `backend\`, pas depuis la racine)

## Lancer le frontend (PWA agence)
```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```
- PWA : http://localhost:5173/ (le proxy `/api` vise le Django ci-dessus,
  donc lancer le backend d'abord)
- Build : `npm --prefix frontend run build`
- Connexion : écran `/connexion` (compte agent/admin créé via `createsuperuser`)

## Reprise demain
1. `git log --oneline -5` + `git status --short` pour vérifier.
2. Pilote : jeu de données (activités, prix, créneaux — valeurs H à valider),
   2FA admin, PDF factures/reçus.
3. Puis caisse/paie dans la PWA (écrans Plus) et QR check-in (phase 3).
