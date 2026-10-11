# BKO Quad Hub — session du 11/10/2026

## Où on en est
- Backend : tranches 1-12 figées, 36/36 tests OK.
  Socle Bamako, comptes + TOTP prévu (F), réservations 7 statuts,
  paiements stub idempotents, comms wa.me P1, rapprochement appels,
  API `api/v1/` + JWT + rôles, caisse, paie, audit + expiration auto.
- Frontend PWA : socle + calendrier, appels, clôture, wizard réservation 4 étapes.
  Build prod OK.
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
