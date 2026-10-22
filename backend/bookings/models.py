"""Réservations — 7 statuts persistés (A). Brouillon = front uniquement, jamais en base."""

import secrets
import string

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class Booking(models.Model):
    # A : seuls statuts persistés. Pas de 'draft'.
    PENDING_DEPOSIT = "pending_deposit"
    CONFIRMED = "confirmed"
    CHECKED_IN = "checked_in"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    EXPIRED = "expired"
    STATUS_CHOICES = [
        (PENDING_DEPOSIT, "En attente d'acompte"),
        (CONFIRMED, "Confirmée"),
        (CHECKED_IN, "Arrivée validée"),
        (COMPLETED, "Terminée"),
        (CANCELLED, "Annulée"),
        (NO_SHOW, "Absent"),
        (EXPIRED, "Expirée"),
    ]
    ACTIVE_STATUSES = [PENDING_DEPOSIT, CONFIRMED, CHECKED_IN]

    SOURCE_CHOICES = [
        ("phone", "Téléphone"),
        ("whatsapp", "WhatsApp"),
        ("onsite", "Sur place"),
        ("online", "En ligne"),
    ]

    code = models.CharField(max_length=20, unique=True)
    customer = models.ForeignKey("clients.Customer", on_delete=models.PROTECT, related_name="bookings")
    slot = models.ForeignKey("catalogue.Slot", on_delete=models.PROTECT, related_name="bookings")
    persons = models.PositiveIntegerField()
    quads = models.PositiveIntegerField(default=1)
    unit_price = models.PositiveIntegerField(help_text="FCFA, entier")
    total = models.PositiveIntegerField(help_text="FCFA, entier")
    # H : unité de facturation. Créneau de 2 h sur la formule « Quad 1H »
    # = 2 unités à 25 000 (50 000). Créneau de la durée de la formule = 1,
    # prix inchangé (toutes les réservations antérieures).
    units = models.PositiveIntegerField(
        default=1,
        help_text="Unités de formule facturées (durée du créneau / durée de la formule)")
    deposit_due = models.PositiveIntegerField(help_text="Acompte demandé, FCFA entier")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=PENDING_DEPOSIT)
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default="phone")
    call = models.ForeignKey(
        "telephony.CallLog", null=True, blank=True, on_delete=models.SET_NULL, related_name="bookings"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="bookings"
    )
    expires_at = models.DateTimeField()
    qr_token = models.CharField(max_length=32, unique=True)
    cancel_reason = models.CharField(max_length=200, blank=True, default="")
    vehicles = models.ManyToManyField("catalogue.Vehicle", blank=True, related_name="bookings",
                                      help_text="Engins affectés (flotte du site, en service)")
    # J : saisie faite hors ligne, rejouée au retour du réseau.
    offline_at = models.DateTimeField(null=True, blank=True,
                                      help_text="Heure de la saisie sur l'appareil")
    offline_ref = models.CharField(max_length=80, blank=True, default="",
                                   help_text="Clé d'idempotence de la saisie hors ligne")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["customer", "slot"],
                condition=Q(status__in=["pending_deposit", "confirmed", "checked_in"]),
                name="uniq_active_booking_per_customer_slot",
            ),
        ]
        indexes = [models.Index(fields=["status", "slot"])]

    def __str__(self):
        return f"{self.code} {self.get_status_display()}"

    def delete(self, *args, **kwargs):
        raise RuntimeError("Réservation jamais supprimée (règle non négociable).")


class BookingLine(models.Model):
    """Ligne de commande : un groupe peut monter deux par deux sur plusieurs
    quads (ex. 30 personnes = 15 lignes de 2 pers. / 1 quad).

    persons/quads/total de la réservation = sommes des lignes.
    Jamais modifiée après création (on annule et on recrée, motif tracé).
    """

    booking = models.ForeignKey(Booking, on_delete=models.PROTECT, related_name="lines")
    rank = models.PositiveIntegerField(help_text="Ordre de la ligne (1, 2, …)")
    persons = models.PositiveIntegerField()
    quads = models.PositiveIntegerField()
    line_total = models.PositiveIntegerField(help_text="FCFA, entier (brut avant remise)")
    discount = models.PositiveIntegerField(default=0, help_text="Remise manuelle, FCFA entier")

    class Meta:
        ordering = ["rank"]
        constraints = [
            models.UniqueConstraint(
                fields=["booking", "rank"], name="uniq_line_rank_per_booking"
            ),
        ]

    def __str__(self):
        return f"{self.booking.code} L{self.rank} {self.persons} pers. {self.quads} quads"


def generate_code():
    day = timezone.now().strftime("%y%m%d")
    rand = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
    return f"BKO-{day}-{rand}"


def generate_qr_token():
    return secrets.token_hex(16)


class BookingEvent(models.Model):
    """Historique append-only : aucune modification ni suppression."""

    booking = models.ForeignKey(Booking, on_delete=models.PROTECT, related_name="events")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="booking_events"
    )
    action = models.CharField(max_length=50)
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.booking.code} {self.action}"

    def save(self, *args, **kwargs):
        if self.pk:
            raise RuntimeError("BookingEvent append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("BookingEvent append-only.")
