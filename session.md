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
- Lot exploitation+caisse : sidebar par thèmes (Exploitation, Caisse & Finance,
  Compte) filtrée par rôle (guide = Accueil/Calendrier/Scanner, pas de Réservations).
  Détection d'appel à la saisie (8 derniers chiffres → source Téléphone, modifiable).
  WhatsApp SANS lien de paiement — MÉMO : réintégrer createPayLink (stub testé)
  dans le message quand l'agrégateur arrive.
  Backend : acompte espèces complet → confirmée (événement tracé, règle étendue
  avec accord utilisateur — ex-webhook-seul), écriture de caisse auto par règlement,
  webhook idempotent à écriture unique, références BKO-{SITE}-R-{CLIENT}-{JJMMAAAA}-{NNNN},
  facture affichée BKO-…-F-… (compteur serveur sans trou), GET /api/v1/payments/
  (responsable/admin/comptable). 42/42 tests OK, build prod OK.
  Constat d'audit : pas de fichier Excel MALI EXPRESS dans le dépôt — référence =
  modèles Django (finance déjà : bordereau mensuel, verrou, report, solde ≥ 0).
- Lot flotte/finance/comptes : backend 53/53 — Véhicule + Maintenance (état affiché
  piloté, coût → dépense auto, hors service exclu des créneaux), Slot.vehicles
  (même site, verrouillé serveur), écritures GET + dépenses POST + résumé mensuel
  (ouverture/entrées/sorties/verrou), users CRUD admin + reset, mot de passe,
  TOTP RFC6238 sans dépendance, fiche entreprise, communiqués/lettres + publication.
  Front : Flotte (registre, maintenance, rapport mensuel imprimé), quads affectés
  visibles (créneau, réservation, facture), Dépenses, Communication (éditeur simple,
  tête d'affiche, téléchargement), Paramètres (utilisateurs, entreprise, sécurité),
  Profil (photo locale), cloche temps réel (sondage 60 s + navigateur), documents
  à en-tête/pied entreprise. Build prod OK, fumée visuelle OK, zéro erreur.
  Reste : validations TOTP au login (pilote), PDF serveur, exports Excel/CSV.
- Lot sites/formules/comptant : Bamako retiré (démo purgée), 4 sites, formules
  Quad enfant 15 min 5000 / Quad 1H 25000 / Vélo élec 5000 / Vélo manuel 3000,
  acompte 0 partout, prix = formule choisie (override serveur, même site exigé),
  créneaux = date+heures (activité générique auto), quads affectés visibles
  (créneau, réservation, facture), reçu = payé/reste via mouvements, facture
  téléchargeable stylée avec QR dimensionné (vérifié dans le fichier),
  rubrique Flotte (Flotte + Maintenance), cachet/signature images sur factures,
  utilisateurs liste/création séparés, éditeur enrichi. « Acompte » retiré
  (UI, guide, mémoire) ; espèces : paiement complet confirme (seuil = total
  si pas d'acompte).   Backend 56/56, build prod OK, fumée E2E OK.
- Correctifs : sidebar à scroll (1194px de contenu), modales en portail
  document.body (un transform résiduel d'animation piégeait les fixed),
  numéros BKO-{SITE}-{CLIENT}-{JJMMAAAA}-{NNNN} exacts via compteur unique
  « document » (contrepartie : la suite facture peut sauter un n° quand un reçu
  s'intercale — compteur interne reste sans trou), lignes suivies
  (TrackedLine, écran Appels).   Backend 58/58, build prod OK.
- Anti-regression statuts : refus total 0, plafond au reste dû, facture unique
  par réservation (reclic sans nouveau numéro), badge Soldé.   Backend 60/60.
- Onboarding première utilisation : 3 présentations + écran Autorisations
  (notifications, caméra pour le scanner, position — tout optionnel),
  mémorisé en local, accès login ensuite. Build OK, fumée visuelle OK.
- DEMAIN — Intégration APK journal d'appels (décision : PWA en WebView RN,
  pont natif vers l'API ; pas de lecture directe possible en PWA).
  1. Backend : POST /api/v1/calls/import/ (lots ≤ 500, normalisation +223,
     external_id idempotent, last_sync de la ligne, tests).
  2. Compte collecteur dédié (rôle agent) + refresh auto des tokens.
  3. Appli RN bare + WebView plein écran + module Kotlin CallLog +
     synchro fond 15 min + témoin de synchro (code livré, build APK via
     Android Studio côté agence, pas de SDK ici).
  4. Test réel : sideload Samsung, 2-3 vrais appels, Rapprocher, anomalie.
  Hors scope : Play Store (permission refusée), iOS, transcription.
- Flotte v2 + Paie : type Vélo, sélecteur 8 couleurs, icônes par type, cartes
  200px (1/2/3 par ligne), suppression engin (400 si utilisé), pièce détachée,
  date d'ajout, rapport mensuel dynamique (ajouts + dernières maintenances,
  mois auto dès le 25) ; paie bout-en-bout (employé+contrat, fiche du mois,
  lignes Entrée, clôture verrouillée, versements en caisse, PDF), API
  employees/contracts/periods/payslips + tests. Backend 64/64, build OK.
- Factures depuis le serveur (GET /invoices/) : bouton Facturer seulement
  si sans N°, badge Soldé si reste 0, mention montant nul.
- Import CSV des relevés d'appels : ABANDONNÉ (décision utilisateur).
  Remplacé par APK collecteur WebView + module natif (voir lot ci-dessous).
- Lot collecteur multi-pays (15/10/2026) : 1 seul téléphone d'entreprise par pays,
  tous Android (pas de Samsung-only), 1 projet RN à 2 saveurs (`standard` agence
  sans permission, `collecteur` entreprise avec READ_CALL_LOG, sideload seul).
  PWA en ligne maintenue comme référence. Backend : TrackedLine.site (FK, migration
  0004), normalize +223 (8 chiffres) / +225 (10 chiffres en 0…), défaut = pays de
  la line_id, POST /api/v1/calls/import/ (lots ≤ 500, external_id idempotent,
  last_sync), tests ImportCalls (idempotence, CI, 501 refusé, ligne requise).
  PWA : importCalls + site/site_name + témoin synchro (Écran Appels), isNativeCollector.
  Code natif livré dans collector/ (App.tsx, CallLogModule.kt, SyncWorker.kt 15 min,
  flavors, README) — build APK via Android Studio côté agence.
  Backend 82/82 tests OK, build prod OK.
- Lot APK natif compilé en CLI (15/10/2026, sans Android Studio) : JDK 17 Temurin
  + SDK cmdline-tools + Gradle 8.10 (C:\Android), projet 100 % natif Java
  `collector-native/` (WebView + HttpURLConnection + JobScheduler 15 min, zéro
  dépendance externe). Livrés et vérifiés (apksigner + aapt) dans `apks/` :
  `bko-hub-standard-v1.0.apk` (ml.bkoquad.hub.hub, Internet seul, tout le monde)
  et `bko-hub-collecteur-v1.0.apk` (ml.bkoquad.hub.collecteur, + READ_CALL_LOG,
  1 téléphone d'entreprise par pays, sideload). Signés debug, installables direct.
  Test local (PWA hors ligne) : APK tolère le certificat auto-signé du Vite dev
  (DEBUG seul) ; lancer backend + `npm run dev`, configurer l'APK avec
  https://IP-PC:5173/ (même Wi-Fi).
  Correctifs APK v1.0 : icône logo (mipmaps depuis logo_bko_quad.jpeg),
  WebChromeClient (caméra/géoloc de la PWA désormais demandées au lieu d'être
  refusées muettes), capteur de crash (diagnostic affiché au redémarrage),
  écran d'erreur fatale anti-fermeture-silencieuse, labels distincts
  (« BKO Hub » standard / « BKO Collecteur » entreprise), correctif LIMIT
  (le fournisseur CallLog refuse LIMIT dans le tri → plafond 500 en Java),
  synchro récent-d'abord (DESC + curseur = max envoyé, jamais « maintenant »),
  purge des 501 appels de test, affichage forcé Africa/Bamako (règle B),
  APK 100 % auto : synchro au démarrage + fond 15 min (plus de bouton),
  config unique verrouillée (réouverture support : triple volume-bas),
  PWA plein écran sans boutons natifs, exemption batterie demandée 1 fois,
  temps réel : service avant-plan + observateur du journal (remontée ~45 s
  après chaque appel, fond 15 min en secours), détection à partir de zéro
  (curseur = install, jamais d'historique).
  Écran Appels en live : rechargement auto toutes les 15 s (pause onglet
  caché, sans spinner, horodatage « Actualisé à ») — plus de déconnexion
  pour voir les nouveaux appels.
  Réactivité portée à ~10 s (entrée écrite à la fin de l'appel) ; wizard
  réservation : numéro retrouvé dans le journal → source « Téléphone »
  verrouillée (non modifiable), sinon champ libre.
  Manqués vérifiés bout en bout (import 201 + badge « Manqué ») ; rattrapage
  24 h caché (triple volume-bas) pour les appels passés avant le curseur.
  Notifs 100 % locales : pont JS window.BkoNative (alertes PWA -> système
  quand onglet caché), notif native à chaque synchro avec nouveaux appels
  (fond uniquement), toucher -> écran Hub, réponse import += fresh.
  Coupe-circuit collecte : TrackedLine.collect_enabled (migration 0005),
  import 403 si coupé, interrupteur Désactiver/Réactiver dans Paramètres
  (responsable/admin), message APK explicite. Synchro auto inchangée.
  Directions en français (Entrant = décroché, Manqué = non décroché/refusé/
  bloqué/messagerie, Sortant = depuis la ligne) ; tous les types Android
  mappés ; auto-correction serveur de la durée (le définitif écrase le 0 s).
  Backend 11/11 tests téléphonie OK, build prod OK, APK collecteur à jour.
  Seconde purge (502 appels 26/09→15/10 + 1 anomalie, synchro partie à curseur
  zéro) : base à 0, reset config (triple volume-bas) exigé pour curseur = now.
- 2FA au login (17/10/2026) : `/auth/token/` = LoginView (mot de passe + code
  TOTP si `totp_enabled`) ; sans/avec code faux → 401 + `totp_required: true`
  (drapeau pour le front), code juste → access + refresh. Fenêtre ±30 s.
  Login.tsx : champ « Code de double authentification » (6 chiffres) dès le
  drapeau, message Paramètres. Backend 113/113 tests OK, build prod OK.
- Facturation unité + remises (17/10/2026, lot client) : Booking.units
  (migration 0005) = unités de formule facturées (ceil durée créneau /
  durée formule) ; créneau 2 h sur Quad 1H = 2 × 25 000 = 50 000 (solo),
  standard 1H = 1 unité prix inchangé (rétro-compatible, défaut 1).
  PDF reçu/facture : ligne « Formule — unité : … », durée réservée
  « Xh = N × unité » si > 1, suffixe par ligne, durées en clair
  (« 1 heure », « 2 jours ») via duree_libelle. Écran Document :
  ligne Facturation + sous-total/remise manuelle/net quand remise,
  ligne « Remise ligne N (manuelle) ». Remise par ligne : déjà tracée
  (BookingLine.discount, /discount/ prorata + creation lignes), PDF/écran alignés.
  Backend 117/117 tests OK, build prod OK.
- Facture automatique (17/10/2026) : paiements instantanés, donc
  `_auto_invoice` dans payments/services — encaissement complet
  (espèces / webhook / record_cash_balance) émet la facture dans la
  même transaction (compteur sans trou, idempotent : ref = même facture).
  Acompte seul (< total) : pas de facture auto, émission manuelle possible.
  Écran Document : charge la facture existante (bouton Émettre disparaît
  si déjà émise). Backend 119/119 tests OK, build prod OK.
- Lot maintenance/flotte/réservation (17/10/2026) : Maintenance (écran)
  = huile (vidange), quantité (pièce/pneus), précision obligatoire
  (« Autre » → part_name, affichage « Précision ») comme la Flotte.
  Flotte : photo d'engin au formulaire (multipart) + miniature sur la
  carte ; conversion WebP côté serveur (common/images.to_webp : max
  1280px, q75) pour photo engin, cachet, signature, tampon paie.
  Wizard : créneaux passés cachés (start ≤ maintenant) ; bouton
  « Aucune heure ne convient ? Fixez-la moi-même » + mots simples
  (départ/retour, nombre de places). Backend 120/120 OK, build prod OK.
- 2FA écran Paramètres (17/10/2026) : si `totp_enabled` → badge
  « 2FA déjà active » (pas de bouton) ; après vérification le profil
  est rechargé (`refreshMe`) et la section passe direct à active.
- Réservation simplifiée (17/10/2026) : mentions Orpheus/vélos
  supprimées ; étape 2 = champ select « Heure du tour » (places
  restantes dans l'option + ligne récap sous le champ) à la place des
  cartes radio ; bouton « Fixez-la moi-même » conservé si aucune heure
  ne convient. Écran Créneaux : bouton Supprimer ( responsables/admin,
  créneau vierge seulement) avec confirmation ; serveur refuse les
  créneaux déjà réservés (400 clair). Backend 121/121 OK, build OK.
- Rideau par site (17/10/2026) : agents, guides, responsables limités
  à leur site (User.site, admin/comptable tout voir). Serveur :
  SiteScopeMixin (sites, formules, créneaux, flotte, maintenances,
  réservations + événements, paiements, factures, caisse, employés,
  contrats) ; gardes écritures (réservation/créneau/expense/lien/
  facture/encaissement, transitions, remise, engins, PDF) ; résumé
  mensuel filtré + solde par site. Universels : appels, messages,
  clients, banque, PAIE. Front : sites auto-preremplis. Tests dédiés
  (agent ne voit que son site ; responsable les entrées ; admin tout).
  123/123 OK, build OK.
- Notifications APK (17/10/2026) : showSystemNotification — priorité
  pont natif BkoNative (sans condition document.hidden), sinon service
  worker (PWA installée/Android), sinon Notification page ; Scanner et
  cloche temps réel passent par ce chemin unique.
- Textes Login reformulés (pro journal d'agence).
- Reste : PDF serveur, Celery/Redis prod,
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

## Journal 17/10 soir — Récupération + filtrage site actif
- Sortie de crise : fichiers perdus NewBooking/Login/etc. restaurés depuis les
  snapshots git opencode (.local/share/opencode/snapshot — blobs zlib) :
  NewBooking (wizard complet) + Login (2FA) + déglaçage/refonte UTF-8
  (Calendar, Calls, Reservations, Slots, Clients, Dashboard, Document,
  Cash, Invoices, Scanner) ; liens préfixés link() + import sitepath
  (useSiteLink) dans toutes les vues. Build OK, 116/116 tests backend OK.
- Filtrage `/s/:seg` actif en production : le compte « agent » n'avait AUCUN
  site assigné en base — c'est la cause du « le filtrage ne marche pas » ;
  agent attaché au site n°2 (Konibabougou), mot de passe agent réinitialisé
  (agent123). Les comptes guide/responsable/agent DOIVENT avoir un site
  affecté (sinon l'API les traite comme view réseau).
- Encodage : ni le code TSX n'était coupable, ni la base — les mojibake que
  l'utilisateur voit viennent du bundle/cached de la PWA. Vider le cache du
  navigateur / désinstaller-réinstaller l'APK collecteur après le rebuild.

## Journal 18/10 — Encodage typographique + dashboard agent + clôture
- Mojibake typographique (lâ€™agence, â€", â...) corrigé partout : apostrophes
  typographiques, tirets cadratins, flèches, "moins", points de suspension —
  ~90 remplacements sur 10 écrans ; vérifié 0 mojibake dans src/. Build OK.
- Dashboard simplifié : vue compacte pour agent/guide/responsable
  (4 KPI, départs à venir, appels à rapprocher — pas de graphiques),
  vue complète pilotage réservée à admin/comptable. Header allégé.
- Clôture du jour (/s/:seg/cloture) refaite avec AppShell : KPI du jour,
  réservations du jour, appels, anomalies à justifier, ConfirmDialog
  avant validation, récapitulatif verrouillé après validation.
- Backend : 17/17 common (116/116 tous) — filtrage site toujours OK.
- Compte agent : site assigné (Konibabougou) + mot de passe réinitialisé
  (agent123) ; à changer à la première connexion.

## Journal 18/10 (2) — Suppression des créneaux clarifiée
- Message serveur précis : créneau avec réservations EN COURS → modifier
  (« annulez-les d'abord », motif tracé), créneau avec historique seulement
  (annulées/absents/expirés) → conservé pour la piste d'audit (jamais
  de suppression — règle non négociable). Clean des données de test :
  3 réservations annulées (BKO-261016-WFFE, EGI8, CT61) via l'API cancel.
- Slots.tsx : bouton Supprimer affiché UNIQUEMENT si le créneau n'a JAMAIS
  eu de réservation ; si tout l'historique est clos, badge « Archivé ».
  Mojibake « Â· » corrigé dans la ligne inscrits/restantes. Build OK.

## PRÉPARATION MISE EN LIGNE — plan du 19/10/2026
Objectif : pilote propre, argent tracé, sauvegardes avant la première vente réelle.

### 1. Bloqué au préalable (à régler avant le déploiement)
- [ ] 2FA admin obligatoire avant pilote (règle F) : enrôler le TOTP du compte
      admin dans /s/…/parametres et VALIDER (totp_enabled=true) ; vérifier la
      connexion admin avec code.
- [ ] Mots de passe : éviter les mots de passe « agent123 » des tests ;
      définir pour chaque agent un mot de passe fort et personnel.
- [ ] Vérifier que le compte admin est le seul compte avec rôles pilotage
      (agent/guide/responsable = comptes nominatifs, pas un compte partagé).

### 2. Serveur / hébergement
- [ ] VPS Linux (Ubuntu LTS) + Python 3.14/3.13, PostgreSQL migré depuis
       SQLite de dev (settings DJANGO(prod), DEBUG=False, ALLOWED_HOSTS).
- [ ] Gunicorn + Nginx ; SERVICE worker PWA built (`npm --prefix frontend
      run build` puis servir dist/ par Nginx ; HTTPS par certificat
      (Let's Encrypt : reverser l'IP/proxy d'aujourd'hui en domaine).
- [ ] Variables d'environnement secrets (SECRET_KEY, DATABASE_URL) via .env
      NON COMMITTÉ ; clés agrégateur à venir (H).
- [ ] Celery worker + Redis démarrés (expiration auto des réservations,
      tâches de fond) — sinon activer le heartbeat cron existant.

### 3. Données de production
- [ ] Créer les sites réels + formules + prix (valeurs H à valider avec
      l'équipe BKO) ; capacsités créneaux réalistes par heure.
- [ ] Créer les quads « en service » + numéros de plaques réelles ; tester
      l'affectation créneaux ↔ quads.
- [ ] Créer les comptes nominatifs : 1 admin + agents/guide/responsable
      avec site assigné (obligatoire sinon ils voient tout le réseau).
- [ ] Purger/markdown-correct les réservations de test (ne jamais supprimer
      — annuler avec motif ou laisser expirer ; vérifier le bordereau).

### 4. Sauvegardes & observabilité
- [ ] Sauvegardes PostgreSQL chiffrées quotidiennes (OPME du plan) : script
      pg_dump + gpg + copie hors site ; test de restauration requis avant pilote.
- [ ] Journal d'audit OK (append-only, rôles vérifiés) — novices de test interne.
- [ ] Logs Gunicorn/Django + file d'erreurs accessible (admin).

### 5. Parcours de mise en ligne (checklist pilote jour J)
1. `git pull` du dépôt sur le VPS, migrations (`python backend/manage.py migrate`).
2. Collectstatic + build frontend + vérifier version API (/api/v1/version/).
3. Créer le premier créneau du jour ; faire UNE réservation de end-to-end
   (appel → réservation → espèces → confirmée → bordereau de clôture).
4. Vérifier WhatsApp wa.me avec un numéro réel de l'équipe.
5. Vérifier 2FA admin ; puis ouvrir le pilote.

### Contacts & accès manifestés
- VPS : à préparer (IP 192.168.1.5 = réseau local, pas un domaine public).
- Agrégateur de paiement : adaptateur en attente de doc (H) — stub idempotent
  conserve les paiements espèces en attendant.
