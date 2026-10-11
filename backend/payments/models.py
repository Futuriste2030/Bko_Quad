"""Paiements tranche 4 : lien, paiement idempotent, facture compteur verrouillé (G)."""

from django.conf import settings
from django.db import models


class PaymentLink(models.Model):
    STATUS_CHOICES = [
        ("pending", "En attente"),
        ("paid", "Payé"),
        ("expired", "Expiré"),
        ("failed", "Échoué"),
    ]
    booking = models.ForeignKey("bookings.Booking", on_delete=models.PROTECT, related_name="payment_links")
    provider = models.CharField(max_length=30, default="stub")
    reference = models.CharField(max_length=80, unique=True)
    amount = models.PositiveIntegerField(help_text="FCFA, entier")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.reference} {self.amount} FCFA ({self.status})"


class Payment(models.Model):
    NATURE_CHOICES = [("deposit", "Acompte"), ("balance", "Solde")]
    MODE_CHOICES = [("aggregator", "Agrégateur"), ("cash", "Espèces")]
    STATUS_CHOICES = [("pending", "En attente"), ("paid", "Payé"), ("failed", "Échoué")]

    booking = models.ForeignKey("bookings.Booking", on_delete=models.PROTECT, related_name="payments")
    nature = models.CharField(max_length=10, choices=NATURE_CHOICES, default="deposit")
    mode = models.CharField(max_length=15, choices=MODE_CHOICES, default="aggregator")
    amount = models.PositiveIntegerField(help_text="FCFA, entier")
    reference = models.CharField(max_length=80, unique=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments"
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    raw_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.reference} {self.amount} FCFA ({self.status})"


class Invoice(models.Model):
    booking = models.ForeignKey("bookings.Booking", on_delete=models.PROTECT, related_name="invoices")
    number = models.PositiveIntegerField(unique=True)
    issued_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Facture {self.number:06d}"
