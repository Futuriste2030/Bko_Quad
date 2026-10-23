"""Clients — Customer minimal. Téléphone unique au format international."""

from django.db import models


class Customer(models.Model):
    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, unique=True, help_text="Format international, ex +22378803072")
    whatsapp = models.CharField(max_length=20, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    site = models.ForeignKey(
        "catalogue.Site", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="customers",
        help_text="Site de rattachement ; les réservations restent la source de vérité")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.phone})"
