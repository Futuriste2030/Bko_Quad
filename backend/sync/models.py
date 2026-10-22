"""Trace des saisies hors ligne : une ligne par écriture rejouée depuis le terrain.

Le `key` est la clé d'idempotence envoyée par la PWA (uuid de l'appareil) : elle
garantit qu'un rejeu ne crée pas de doublon et trace qui, quoi, quand.
"""

from django.conf import settings
from django.db import models


class IdempotencyKey(models.Model):
    key = models.CharField(max_length=80, unique=True)
    method = models.CharField(max_length=8)
    path = models.CharField(max_length=200)
    request_hash = models.CharField(max_length=64)
    status = models.PositiveSmallIntegerField(default=0, help_text="0 = en cours")
    status_code = models.PositiveSmallIntegerField(default=0)
    response = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="idempotency_keys",
    )
    label = models.CharField(max_length=120, blank=True, default="")
    offline_at = models.DateTimeField(null=True, blank=True, help_text="Heure de saisie sur l'appareil")
    synced_at = models.DateTimeField(null=True, blank=True, help_text="Rejeu effectif sur le Hub")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.method} {self.path} [{self.key[:8]}]"
