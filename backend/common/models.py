"""Compteur verrouillé de facturation (décision G) + constantes provisoires (H)."""

from django.db import models, transaction


class InvoiceSequence(models.Model):
    scope = models.CharField(max_length=30, unique=True)
    last_number = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f"{self.scope}: {self.last_number}"


def next_invoice_number(scope="default"):
    """Incrémente le compteur dans la même transaction (select_for_update)."""
    with transaction.atomic():
        seq, _ = InvoiceSequence.objects.select_for_update().get_or_create(scope=scope)
        seq.last_number += 1
        seq.save(update_fields=["last_number"])
        return seq.last_number


class CompanyProfile(models.Model):
    """Informations de l'entreprise : en-têtes et pieds des documents."""

    name = models.CharField(max_length=120, default="BKO Quad")
    phone = models.CharField(max_length=20, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.CharField(max_length=200, blank=True, default="")
    nif = models.CharField(max_length=40, blank=True, default="")
    rccm = models.CharField(max_length=40, blank=True, default="")
    conditions = models.TextField(blank=True, default="")
    thanks = models.CharField(max_length=200, blank=True, default="Merci de votre confiance.")
    stamp = models.ImageField(upload_to="entreprise/", blank=True, null=True, help_text="Cachet")
    signature = models.ImageField(upload_to="entreprise/", blank=True, null=True, help_text="Signature")
    signature_name = models.CharField(max_length=120, blank=True, default="", help_text="Nom du signataire")

    def __str__(self):
        return self.name
