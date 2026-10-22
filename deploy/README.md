# BKO Quad Hub — production `app.bkoquad.ml`

Architecture : Nginx sur l'hôte (TLS Let's Encrypt) → `127.0.0.1:8003` →
Gunicorn/Django. Le build React est servi par WhiteNoise ; PostgreSQL, Redis,
Celery worker et Celery beat tournent dans Docker. Les médias sont sur un
volume Docker et servis par Django.

## 1. DNS et serveur

1. Créer l'enregistrement DNS `A` : `app.bkoquad.ml` → IP publique du VPS.
2. VPS Ubuntu LTS avec Docker Engine + plugin Compose.
3. Ouvrir uniquement `80` et `443` (le port `8003` reste en localhost).
4. Cloner le dépôt, par exemple dans `/opt/bko-quad`.

## 2. Variables de production

```bash
cd /opt/bko-quad
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

Renseigner au minimum :

- `DJANGO_SECRET_KEY` : `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`
- `POSTGRES_PASSWORD` : `openssl rand -base64 32`
- `BACKUP_PASSPHRASE`

`deploy/.env.production` est ignoré par Git : ne jamais le committer.
Les liens WhatsApp utilisent le numéro du client (ou son numéro WhatsApp
distinct) : aucun numéro Business n'est requis.

## 3. Premier démarrage

```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env.production up -d --build
docker compose -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:8003/healthz
```

Le conteneur `web` applique `migrate` au démarrage. Créer le compte
administrateur :

```bash
docker compose -f docker-compose.prod.yml exec web python manage.py createsuperuser
```

`createsuperuser` crée le compte système (rôle `superadmin`). Les comptes de
direction `admin` se créent ensuite depuis `/s/reseau/parametres` >
Utilisateurs. Puis, avant le pilote : activer le TOTP du compte superadmin et
vérifier la connexion avec le code (règle F).

## 4. Nginx et HTTPS

Avec aaPanel : le vhost `app.bkoquad.ml` est créé par le panel (SSL inclus),
puis copier l'extension :

```bash
mkdir -p /www/server/panel/vhost/nginx/extension/app.bkoquad.ml
cp deploy/nginx-app.bkoquad.ml.conf \
   /www/server/panel/vhost/nginx/extension/app.bkoquad.ml/bko-proxy.conf
nginx -t && nginx -s reload
```

Hors aaPanel : inclure le contenu du fichier dans le bloc `server { ... }` du
vhost `/etc/nginx/sites-available/app.bkoquad.ml.conf`.

Vérifications :

```bash
curl -fsS https://app.bkoquad.ml/healthz
curl -I https://app.bkoquad.ml/          # index.html, no-cache
curl -I https://app.bkoquad.ml/api/      # API derrière Nginx
```

## 5. Mise à jour

```bash
sudo ./deploy/deploy.sh
```

Le script fait `git pull`, reconstruit l'image, redémarre la stack et attend
la sonde. Les migrations sont rejouées au démarrage de `web`.

## 6. Sauvegardes chiffrées

```bash
sudo BACKUP_DIR=/var/backups/bko-quad ./deploy/backup-postgres.sh
```

Le script chiffre `pg_dump` et l'archive des médias avec GPG (AES256), puis
supprime les fichiers de plus de 14 jours. Cron quotidien :

```cron
15 2 * * * /opt/bko-quad/deploy/backup-postgres.sh >> /var/log/bko-backup.log 2>&1
```

Conserver une copie hors site. Tester une restauration avant le pilote :

```bash
sudo RESTORE_CONFIRM=YES ./deploy/restore-postgres.sh \
  /var/backups/bko-quad/bko-db-AAAAMMJJ-HHMMSS.dump.gpg
```

## 7. Checklist pilote

- [ ] `https://app.bkoquad.ml/healthz` répond `{"status":"ok"}`.
- [ ] 2FA du compte superadmin active et testée.
- [ ] Sites, formules, prix, quads et créneaux réels saisis.
- [ ] Une réservation de bout en bout : appel → réservation → espèces →
      confirmée → bordereau de clôture.
- [ ] Sauvegarde manuelle + restauration testée.
- [ ] `docker compose ... logs web worker beat` sans erreur.
- [ ] PWA installée depuis `https://app.bkoquad.ml/` sur un téléphone.
