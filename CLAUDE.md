# BKO Quad Hub — CLAUDE.md

## But
PWA agence + API Django unique, seule source de vérité des réservations BKO Quad.
Aucune réservation valable hors Hub. 100% appels rapprochés ou justifiés, argent tracé dès l'origine.
Phase 1-2 : agence (réservations, paiement comptant, WhatsApp wa.me, journal d'appels, caisse, paie).
Phase 3 : QR + réservation en ligne sur la même API, sans refonte.

## Stack
- API : Django 5 + DRF + SimpleJWT, PostgreSQL (SQLite dev only), Celery + Redis (tâches), drf-spectacular (OpenAPI), PDF serveur.
- Front agence : React + Vite + TypeScript, PWA installable, mobile-first 360px.
- Front client P3 : Next.js (public) + Expo (app). Code partagé limité aux types + client API.
- Hébergement : Linux, Nginx, Gunicorn, sauvegardes chiffrées quotidiennes.
- Réf : `BKO_QUAD_STYLE_GUIDE.md` (prime sur Hub Digi Com pour habillage), PRD/TRD PDF.

## Commandes
```powershell
# Backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
python backend\manage.py migrate
python backend\manage.py runserver
python backend\manage.py test
# Frontend (quand frontend/ existe)
npm --prefix frontend install; npm --prefix frontend run dev
# Celery — clôture automatique de la journée à 20h00 (lancer depuis backend/)
python -m celery -A config worker -l info
python -m celery -A config beat -l info
```

## Règles non négociables
- Réservation absente du Hub = ni payée, ni confirmée, ni planifiée.
- Confirmation client seulement si réservation + paiement reçu (webhook ou espèces tracées passent à `confirmed`).
- Modif/annulation : motif obligatoire, tracée (qui/quand/avant/après), jamais de suppression.
- Appel non rapproché = anomalie persistante, motif obligatoire pour clore.
- Montants entiers FCFA (XOF), sans décimales. Fuseau Africa/Bamako (voir B).
- Statut jamais par couleur seule : toujours texte + icône si place.
- Français, vouvoiement client, vocabulaire : réservation, créneau, formule, paiement, guide, clôture du jour, anomalie, bordereau.
- Audit append-only, rôles vérifiés serveur, 2FA admin obligatoire avant pilote (voir F).
- Style : tokens `BKO_QUAD_STYLE_GUIDE.md`, 1 accent orange/écran, ombre dure réservée, 48px tactile, 16px min champs.
- Ne jamais : blanc sur orange en texte, recolorer/étirer logo, ombres floues/dégradés, tableau scroll horizontal mobile.
- WhatsApp P1 : wa.me + message prérempli, numéro Business entreprise uniquement, source `WhatsApp` tracée.

## Décisions validées (ne pas rouvrir sans demande explicite)
- A : 7 statuts persistés (`pending_deposit, confirmed, checked_in, completed, cancelled, no_show, expired`). Brouillon = front uniquement, jamais en base.
- B : `TIME_ZONE=Africa/Bamako, USE_TZ=True`, stockage UTC, affichage Bamako.
- C : légende schéma « 4 états, 3 sorties » devient « 7 statuts ».
- D : `site.webmanifest` régénéré (name `BKO Quad Hub`, short_name `BKO Hub`, theme_color `#0a0a0a`, background `#ffffff`, lang `fr`, display `standalone`). Ne pas toucher aux PNG.
- E : P1 réutilise PNG fournis. Vectorisation logo, pictogramme seul, maskable = chantier à part, ne pas improviser.
- F : champ TOTP prévu dès tranche 2 ; vérification obligatoire avant pilote.
- G : factures = compteur verrouillé (`select_for_update`) incrémenté en transaction, test de concurrence exigé.
- H : valeurs configurables (sites, formules, prix, quads, créneaux, expiration, remboursement). Adaptateur agrégateur en attente de doc.
- I : clôture de journée automatique à 20h00 (`BKO_CLOSING_HOUR`, Celery beat `telephony.close_day` + rattrapage toutes les 3h sur 7 jours). Plus de validation manuelle : `GET /api/v1/closings/` et l'écran `/cloture` sont consultatifs, un bordereau existant n'est jamais écrasé. Repli : si le worker/beat a manqué 20h00, la consultation de l'écran rattrape la clôture (idempotent).
- J : mode hors ligne PWA. Saisies sans réseau → file locale IndexedDB → rejeu automatique au retour (celui-ci porte `Idempotency-Key`, le Hub n'exécute qu'une fois : app `sync`). Hors ligne, rien n'est confirmé : état « À synchroniser », écran `/synchronisation`, refus métier → arbitrage humain. Lectures hors ligne = dernier cache local. Saisies concernées : client, réservation, encaissement espèces, facture, dépense/recette, justification d'anomalie, message client.
- Arborescence : `finance, payroll, comms` créées vides sans modèle ; `telephony` = `CallLog` minimal seul.
