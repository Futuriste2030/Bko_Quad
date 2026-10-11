"""Comptes et rôles — tranche 2. Rôle vérifié serveur ; TOTP prévu (F)."""

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    ROLE_CHOICES = [
        ("agent", "Agent de réservation"),
        ("guide", "Guide"),
        ("responsable", "Responsable d'agence"),
        ("admin", "Direction / administrateur"),
        ("comptable", "Comptable"),
        ("client", "Client"),
    ]

    phone = models.CharField(max_length=20, unique=True, help_text="Format international, ex +22378803072")
    role = models.CharField(max_length=15, choices=ROLE_CHOICES, default="agent")
    # F : champ prévu dès la tranche 2 ; vérification obligatoire avant le pilote.
    totp_secret = models.CharField(max_length=64, blank=True, default="")
    totp_enabled = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.username} ({self.role})"
