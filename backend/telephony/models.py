"""Journal d'appels + anomalies persistantes + clôture du jour."""

from django.conf import settings
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
    line = models.ForeignKey(
        "TrackedLine", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="calls", help_text="Ligne d'entreprise ayant reçu ou émis l'appel")
    site = models.ForeignKey(
        "catalogue.Site", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="calls", help_text="Site figé à l'import (ligne ou importateur)")
    imported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="imported_calls", help_text="Compte ayant remonté l'appel")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["phone_number", "started_at"]),
            models.Index(fields=["site", "started_at"]),
        ]

    def __str__(self):
        return f"{self.phone_number} {self.started_at:%d/%m/%Y %H:%M}"


class CallAnomaly(models.Model):
    STATUS_CHOICES = [("open", "À justifier"), ("resolved", "Justifiée")]
    REASON_CHOICES = [
        ("renseignement", "Renseignement"),
        ("annulation", "Annulation"),
        ("faux_numero", "Faux numéro"),
        ("autre", "Autre"),
    ]

    call = models.OneToOneField(CallLog, on_delete=models.PROTECT, related_name="anomaly")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="open")
    reason = models.CharField(max_length=20, choices=REASON_CHOICES, blank=True, default="")
    comment = models.CharField(max_length=200, blank=True, default="")
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="anomalies"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Anomalie {self.call.phone_number} ({self.status})"


class DailyClosing(models.Model):
    date = models.DateField()
    bookings_count = models.PositiveIntegerField(default=0)
    amount_collected = models.PositiveIntegerField(default=0, help_text="FCFA, entier")
    calls_count = models.PositiveIntegerField(default=0)
    anomalies_open = models.PositiveIntegerField(default=0)
    validated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="closings"
    )
    validated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        constraints = [models.UniqueConstraint(fields=["date"], name="uniq_closing_per_date")]

    def __str__(self):
        return f"Clôture {self.date:%d/%m/%Y}"


class TrackedLine(models.Model):
    """Numéros d'entreprise dont le journal est rapproché (ligne Business, fixe agence…)."""
    label = models.CharField(max_length=120, help_text="Ex. Ligne Business, Fixe agence")
    number = models.CharField(max_length=20, unique=True, help_text="Format international, ex +22320201212")
    site = models.ForeignKey(
        "catalogue.Site", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="lines", help_text="Site rattaché (Mali / Côte d'Ivoire)")
    active = models.BooleanField(default=True)
    collect_enabled = models.BooleanField(
        default=True, help_text="Coupe-circuit : si décoché, l'APK ne peut plus remonter (voir Paramètres)")
    last_sync = models.DateTimeField(null=True, blank=True, help_text="Dernière remontée du journal")

    def __str__(self):
        return f"{self.label} ({self.number})"
