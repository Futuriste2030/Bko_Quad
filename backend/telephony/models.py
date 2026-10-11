"""Journal d'appels minimal — tranche 1. Importé, jamais modifié (voir CLAUDE.md)."""

from django.db import models


class CallLog(models.Model):
    DIRECTION_CHOICES = [
        ("inbound", "Entrant"),
        ("outbound", "Sortant"),
        ("missed", "Manqué"),
    ]

    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES)
    phone_number = models.CharField(max_length=20, help_text="Format international, ex +22378803072")
    started_at = models.DateTimeField()
    duration_seconds = models.PositiveIntegerField(default=0)
    source = models.CharField(max_length=30, default="android_app")
    external_id = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["phone_number", "started_at"])]

    def __str__(self):
        return f"{self.phone_number} {self.started_at:%d/%m/%Y %H:%M}"
