"""J : purge des clés d'idempotence (les saisies hors ligne rejouées sont datées)."""

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

KEEP_DAYS = 30


@shared_task(name="sync.prune_keys")
def prune_keys(days=KEEP_DAYS):
    """Efface les clés d'idempotence anciennes : le rejeu d'une saisie de terrain
    se fait dans la journée, pas un mois plus tard."""
    from sync.models import IdempotencyKey

    limit = timezone.now() - timedelta(days=days)
    deleted, _ = IdempotencyKey.objects.filter(created_at__lt=limit).delete()
    return deleted
