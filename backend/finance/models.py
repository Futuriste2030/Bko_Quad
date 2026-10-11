"""Livre de caisse : règles issues des constats du fichier Excel (voir TRD §5)."""

from django.conf import settings
from django.db import models


class GLAccount(models.Model):
    code = models.CharField(max_length=20, unique=True)
    label = models.CharField(max_length=120)

    def __str__(self):
        return f"{self.code} {self.label}"


class CashbookEntry(models.Model):
    IN = "in"
    OUT = "out"
    DIRECTION_CHOICES = [(IN, "Recette"), (OUT, "Dépense")]
    CATEGORY_CHOICES = [
        ("recette_reservation", "Recette réservation"),
        ("carburant", "Carburant"),
        ("reparation", "Réparation"),
        ("salaire", "Salaire"),
        ("avance", "Avance au personnel"),
        ("loyer", "Loyer"),
        ("autre", "Autre"),
    ]

    date = models.DateField()
    site = models.ForeignKey("catalogue.Site", null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="entries")
    category = models.CharField(max_length=25, choices=CATEGORY_CHOICES)
    label = models.CharField(max_length=200)
    voucher = models.CharField(max_length=20, help_text="Bordereau auto unique par mois")
    direction = models.CharField(max_length=3, choices=DIRECTION_CHOICES)
    amount = models.PositiveIntegerField(help_text="FCFA, entier")
    account = models.ForeignKey(GLAccount, null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="entries")
    payment = models.ForeignKey("payments.Payment", null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="entries")
    booking = models.ForeignKey("bookings.Booking", null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="entries")
    employee_name = models.CharField(max_length=120, blank=True, default="")
    receipt = models.CharField(max_length=200, blank=True, default="", help_text="Réf justificatif")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="entries")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="approved_entries")
    locked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["date", "id"]
        constraints = [
            models.UniqueConstraint(fields=["date", "voucher"], name="uniq_voucher_per_day"),
        ]

    def __str__(self):
        return f"{self.voucher} {self.label} {self.amount} FCFA"

    def save(self, *args, **kwargs):
        if self.pk and CashbookEntry.objects.filter(pk=self.pk, locked=True).exists():
            raise RuntimeError("Écriture verrouillée : passez une écriture inverse approuvée.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Écriture jamais supprimée : passez une écriture inverse approuvée.")


class CashAdvance(models.Model):
    employee_name = models.CharField(max_length=120)
    date = models.DateField()
    voucher = models.CharField(max_length=20)
    reason = models.CharField(max_length=200)
    amount = models.PositiveIntegerField(help_text="FCFA, entier")
    repaid = models.PositiveIntegerField(default=0)
    repaid_at = models.DateField(null=True, blank=True)

    def __str__(self):
        return f"Avance {self.employee_name} {self.amount} FCFA"


class MonthlyClosing(models.Model):
    month = models.DateField(unique=True, help_text="Premier jour du mois")
    opening = models.IntegerField(default=0)
    closing = models.IntegerField(default=0)
    closed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Clôture {self.month:%m/%Y}"
