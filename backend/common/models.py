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
