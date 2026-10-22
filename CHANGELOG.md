# Journal des versions — BKO Quad Hub

Politique : SemVer (`MAJEUR.MINEUR.CORRECTIF`), source unique = fichier `VERSION`.
`1.0.0` visée à la fin du pilote d'une semaine, avec 2FA admin active.

## [0.4.1] — 2026-10-14
### Corrigé
- Dev en HTTPS (certificat local) + `/media/` via le proxy : caméra,
  notifications et images visibles sur téléphone, comme en production.
- Notifications : bouton à 3 états (activer / désactiver applicatif /
  bloqué système), envois coupés quand désactivé.
### Changé (règle métier)
- Encaissement unique : une facture = un seul versement du total, en une fois.
  Tout second versement ou montant partiel est refusé (serveur, sous verrou).
  La notion de trop-perçu est supprimée partout.
- Données du 12/10 nettoyées (réservation 12 : 1 paiement, 1 facture,
  1 écriture conservés ; sauvegarde `db.sqlite3.bak-20261014`).
### Corrigé
- Reçu téléchargé au format compact 80mm (rouleau), facture au format A4 ;
  une seule ligne de règlement.
### Corrigé
- Double-encaissement : le contrôle du reste dû passe sous verrou (deux clics
  rapprochés = un seul encaissement) ; test du scénario du 12/10.
- Reçu et facture téléchargés : statut, logo, cachet et signature inclus
  (URL absolues) ; trop-perçu affiché sur le reçu, l'écran et les factures.
- Logo masqué sur mobile : pastille blanche derrière le PNG + barre allégée
  (nom d'enseigne et nom d'utilisateur masqués à 360px, photo conservée).
- Colonne `accounts_user.site_id` : migration appliquée (fini le 500 au login).
### Ajouté
- Parcours guide : scan QR d'arrivée (confirmée → arrivée, minuteur lancé sur la
  durée de la formule), second scan de fin (arrivée → terminée) ; alerte à la fin
  du minuteur (bannière + notification). Boutons Scanner dans Réservations et
  écran Scanner (`/scanner?code=`).
- Compte utilisateur : prénom, nom, site d'appartenance ; profil modifiable
  (prénom, nom, téléphone) via `PATCH /api/v1/auth/me/`.
- Graphique « Montée en charge cumulée » animé et expliqué (total, mode de lecture).
### Corrigé
- Cachet et signature téléversés désormais servis et visibles (`/media/` en dev,
  photo de profil affichée dans la barre supérieure (partagée avec le Profil).
- Toutes les boîtes natives (`prompt`) remplacées par des modales React
  (réinitialisation mot de passe, insertion de lien).

## [0.2.0] — 2026-10-14
### Ajouté
- Module Banque, compte distinct de la caisse : versements (bordereau requis),
  retraits (chèque/référence requis), solde jamais négatif, écritures jamais supprimées.
- Écran Banque (`/banque`) : solde, formulaires, reprise de la recette nette de caisse,
  rapport de rapprochement imprimable et téléchargeable (frais et agios, écart).
- API versionnée exposée : `GET /api/v1/version/`, affichée dans Paramètres → À propos.
- Cette politique de version (`VERSION` + `CHANGELOG.md`).

## [0.1.0] — 2026-10-12
### Ajouté
- Socle agence : réservations (7 statuts), paiements comptant, caisse, paie,
  flotte et maintenance, appels et anomalies, clôture du jour, documents (reçu, facture),
  communication WhatsApp wa.me, PWA installable.
