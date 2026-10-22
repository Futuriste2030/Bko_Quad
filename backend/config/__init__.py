"""Chargement de l'application Celery dès l'import du paquet config (shared_task)."""

from .celery import app as celery_app

__all__ = ("celery_app",)
