"""Settings socle BKO Quad Hub — tranche 1. Voir CLAUDE.md décisions A-H."""

import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse

from celery.schedules import crontab
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

# .env local / VPS (Docker injecte les variables via env_file, ce chargement
# sert aussi aux lancements systemd ou manage.py hors conteneur).
try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except ImportError:  # dépendance absente en dev minimal : variables d'environnement seules
    pass

# Version unique du Hub : fichier VERSION à la racine (politique SemVer).
def _read_version():
    for candidate in (BASE_DIR.parent / "VERSION", BASE_DIR / "VERSION"):
        try:
            return candidate.read_text(encoding="utf-8").strip()
        except OSError:
            continue
    return "0.0.0-dev"


BKO_VERSION = _read_version()

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-bko-quad-dev-only")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

if not DEBUG and SECRET_KEY.startswith("django-insecure-"):
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY de production manquante : générez une clé et renseignez .env."
    )

PUBLIC_HOST = os.environ.get("BKO_PUBLIC_HOST", "app.bkoquad.ml")
_default_hosts = "*" if DEBUG else f"{PUBLIC_HOST},localhost,127.0.0.1"
ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("DJANGO_ALLOWED_HOSTS", _default_hosts).split(",")
    if h.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "drf_spectacular",
    "accounts",
    "clients",
    "catalogue",
    "bookings",
    "payments",
    "comms",
    "telephony",
    "finance",
    "payroll",
    "audit",
    "sync",
    "common",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "common.middleware.QueryTokenAuthMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # J : une écriture rejouée depuis le terrain ne s'exécute qu'une fois.
    "sync.middleware.IdempotencyMiddleware",
]

if not DEBUG:
    # Prod : WhiteNoise sert /static/ (admin) et le build Vite monté à la racine.
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASE_URL = os.environ.get("DATABASE_URL", "")
POSTGRES_DB = os.environ.get("POSTGRES_DB", "")
if DATABASE_URL.startswith("sqlite"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": DATABASE_URL.removeprefix("sqlite:///") or BASE_DIR / "db.sqlite3",
        }
    }
elif DATABASE_URL or POSTGRES_DB:
    if DATABASE_URL:
        _u = urlparse(DATABASE_URL)
        _db = {
            "NAME": _u.path.lstrip("/"),
            "USER": unquote(_u.username or ""),
            "PASSWORD": unquote(_u.password or ""),
            "HOST": _u.hostname or "127.0.0.1",
            "PORT": _u.port or "5432",
        }
    else:
        _db = {
            "NAME": POSTGRES_DB,
            "USER": os.environ.get("POSTGRES_USER", "bko"),
            "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
            "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        }
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            **_db,
            "CONN_MAX_AGE": int(os.environ.get("DB_CONN_MAX_AGE", "60")),
            "CONN_HEALTH_CHECKS": True,
        }
    }
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
]

# B — fuseau unique, stockage UTC, affichage Bamako.
LANGUAGE_CODE = "fr"
TIME_ZONE = "Africa/Bamako"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
FRONTEND_DIST = BASE_DIR / "frontend_dist"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Prod : WhiteNoise sert le build Vite (assets hashés, favicons, SW) à la
# racine, et les fichiers statiques Django sous /static/.
if not DEBUG:
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
    }
    WHITENOISE_ROOT = FRONTEND_DIST
    WHITENOISE_MANIFEST_STRICT = False

# app.bkoquad.ml est derrière Nginx TLS : cookies sécurisés, CSRF de confiance
# et schéma HTTPS reconstruit depuis X-Forwarded-Proto.
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CSRF_TRUSTED_ORIGINS",
        "" if DEBUG else f"https://{PUBLIC_HOST}",
    ).split(",")
    if origin.strip()
]
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = not DEBUG
SECURE_REDIRECT_EXEMPT = [r"^healthz/?$"]
SECURE_HSTS_SECONDS = 0 if DEBUG else int(os.environ.get("SECURE_HSTS_SECONDS", "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = os.environ.get("SECURE_HSTS_PRELOAD", "0") == "1"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "EXCEPTION_HANDLER": "common.exceptions.custom_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "BKO Quad Hub API",
    "DESCRIPTION": "API unique des réservations BKO Quad.",
    "VERSION": BKO_VERSION,
}

# H — valeurs provisoires configurables, en FCFA entiers et minutes.
BKO_DEFAULT_DEPOSIT_XOF = int(os.environ.get("BKO_DEFAULT_DEPOSIT_XOF", "10000"))
BKO_BOOKING_EXPIRY_MINUTES = int(os.environ.get("BKO_BOOKING_EXPIRY_MINUTES", "240"))
BKO_REFUND_POLICY = os.environ.get("BKO_REFUND_POLICY", "manual")
BKO_WHATSAPP_BUSINESS_NUMBER = os.environ.get("BKO_WHATSAPP_BUSINESS_NUMBER", "+22300000000")

# Disponibilité flotte : 1 = limite dure (défaut), 0 = affectation documentaire
# temporaire pendant l'inventaire de la flotte (chaque saisie est tracée).
BKO_FLEET_STRICT = os.environ.get("BKO_FLEET_STRICT", "1") == "1"

# Clôture de journée automatique : les activités se terminent en journée,
# le Hub clôt tout seul à 20h00 (fuseau B) — aucune validation manuelle.
BKO_CLOSING_HOUR = int(os.environ.get("BKO_CLOSING_HOUR", "20"))

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TIME_ZONE = TIME_ZONE
CELERY_ENABLE_UTC = True
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_TASK_TIME_LIMIT = int(os.environ.get("CELERY_TASK_TIME_LIMIT", "300"))
CELERY_BEAT_SCHEDULE = {
    # Clôture du jour à 20h00.
    "cloture-journee-20h": {
        "task": "telephony.close_day",
        "schedule": crontab(hour=BKO_CLOSING_HOUR, minute=0),
    },
    # Rattrapage : serveur à l'arrêt à 20h00, ou clôture manquée.
    "cloture-rattrapage": {
        "task": "telephony.close_day",
        "schedule": crontab(minute=15, hour="*/3"),
    },
    # J : purge des clés d'idempotence (saisies hors ligne rejouées).
    "sync-purge-cles": {
        "task": "sync.prune_keys",
        "schedule": crontab(hour=3, minute=30),
    },
}
