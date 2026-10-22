"""Application Celery du Hub : clôture de journée automatique (20h00 Bamako)."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("bko_quad")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
