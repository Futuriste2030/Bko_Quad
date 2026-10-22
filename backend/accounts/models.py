"""Comptes et rôles — tranche 2. Rôle vérifié serveur ; TOTP prévu (F)."""

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    ROLE_CHOICES = [
        ("agent", "Agent de réservation"),
        ("guide", "Guide"),
        ("responsable", "Responsable d'agence"),
        ("admin", "Direction / administrateur"),
        ("superadmin", "Super administrateur (système)"),
        ("comptable", "Comptable"),
        ("client", "Client"),
    ]

    phone = models.CharField(max_length=20, unique=True, help_text="Format international, ex +22378803072")
    role = models.CharField(max_length=15, choices=ROLE_CHOICES, default="agent")
    site = models.ForeignKey("catalogue.Site", null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="members",
                             help_text="Site d'appartenance")
    # F : champ prévu dès la tranche 2 ; vérification obligatoire avant le pilote.
    totp_secret = models.CharField(max_length=64, blank=True, default="")
    totp_enabled = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        # Le super administrateur est le compte système : il reste superuser,
        # distinct d'un admin de direction qui peut avoir un dossier salarié.
        if self.is_superuser or self.role == "superadmin":
            self.is_superuser = True
            self.is_staff = True
            self.role = "superadmin"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.username} ({self.role})"
