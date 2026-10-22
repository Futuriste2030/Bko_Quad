"""Catalogue minimal tranche 3 : Site, Activity, Slot. Montants entiers FCFA."""

from django.conf import settings
from django.db import models
from django.utils import timezone


class Site(models.Model):
    name = models.CharField(max_length=100, unique=True)
    city = models.CharField(max_length=100, default="Bamako")

    def __str__(self):
        return self.name


class Activity(models.Model):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="activities")
    name = models.CharField(max_length=100)
    duration_minutes = models.PositiveIntegerField(default=60)
    base_price = models.PositiveIntegerField(help_text="FCFA, entier")
    deposit = models.PositiveIntegerField(help_text="Acompte demandé, FCFA entier")
    max_group = models.PositiveIntegerField(default=10)

    class Meta:
        unique_together = [("site", "name")]

    def __str__(self):
        return f"{self.name} ({self.site})"


class Slot(models.Model):
    activity = models.ForeignKey(Activity, on_delete=models.PROTECT, related_name="slots")
    start = models.DateTimeField()
    end = models.DateTimeField()
    capacity = models.PositiveIntegerField()
    closed = models.BooleanField(default=False)
    vehicles = models.ManyToManyField("Vehicle", blank=True, related_name="slots",
                                      help_text="Quads affectés à ce créneau (en service, même site)")

    class Meta:
        ordering = ["start"]
        indexes = [models.Index(fields=["activity", "start"])]

    def __str__(self):
        return f"{self.activity} {self.start:%d/%m %H:%M}"


class Vehicle(models.Model):
    """Flotte : chaque engin suit son site, son état affiché vient de la maintenance."""
    TYPE_CHOICES = [
        ("quad", "Quad"),
        ("velo", "Vélo"),
        ("kart", "Kart"),
        ("navette", "Navette"),
        ("autre", "Autre"),
    ]
    STATUS_CHOICES = [
        ("en_service", "En service"),
        ("maintenance", "En maintenance"),
        ("hors_service", "Hors service"),
    ]

    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="vehicles")
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default="quad")
    model = models.CharField(max_length=120, help_text="Modèle, ex. Yamaha Grizzly 350")
    plate = models.CharField(max_length=30, unique=True, help_text="Immatriculation ou numéro de parc")
    color = models.CharField(max_length=40, blank=True, default="")
    photo = models.ImageField(upload_to="flotte/", blank=True, null=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="en_service")
    created_at = models.DateTimeField(default=timezone.now, help_text="Date d'ajout dans le parc")

    def __str__(self):
        return f"{self.plate} ({self.model})"


class Maintenance(models.Model):
    KIND_CHOICES = [
        ("vidange", "Vidange"),
        ("reparation", "Réparation"),
        ("piece", "Changement de pièce"),
        ("controle", "Contrôle"),
        ("pneus", "Pneus"),
        ("autre", "Autre"),
    ]

    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="maintenances")
    kind = models.CharField(max_length=15, choices=KIND_CHOICES, default="vidange")
    date = models.DateField()
    cost = models.PositiveIntegerField(default=0, help_text="FCFA, 0 = sans coût")
    part_name = models.CharField(max_length=120, blank=True, default="",
                                 help_text="Nom de la pièce (changement de pièce)")
    part_serial = models.CharField(
        max_length=80, blank=True, default="",
        help_text="N° de série de la pièce remplacée (obligatoire pour un changement de pièce)")
    oil_liters = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True,
                                     help_text="Huile moteur utilisée, en litres (vidange)")
    quantity = models.PositiveIntegerField(null=True, blank=True,
                                           help_text="Nombre : pièces changées, pneus remplacés…")
    notes = models.CharField(max_length=200, blank=True, default="")
    new_status = models.CharField(max_length=15, choices=Vehicle.STATUS_CHOICES, blank=True, default="",
                                  help_text="État affiché après l'intervention (vide = inchangé)")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="maintenances")

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.vehicle.plate} {self.kind} {self.date:%d/%m/%Y}"


class SparePart(models.Model):
    """Pièce de rechange achetée : en stock, puis consommée par une maintenance.

    Une pièce utilisée n'est jamais supprimée : elle reste grisée dans le
    stock avec l'engin et la date de la maintenance qui l'a consommée.
    """

    AVAILABLE = "available"
    USED = "used"
    STATUS_CHOICES = [
        (AVAILABLE, "En stock"),
        (USED, "Utilisée"),
    ]
    COLORS = ["rouge", "noir", "blanc", "bleu", "vert", "jaune", "orange", "gris"]

    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="spare_parts")
    name = models.CharField(max_length=120, help_text="Nom de la pièce")
    serial_number = models.CharField(max_length=80, unique=True,
                                     help_text="N° de série unique de la pièce")
    color = models.CharField(max_length=40, blank=True, default="")
    reason = models.CharField(max_length=200, help_text="Raison de l'achat")
    bought_on = models.DateField(default=timezone.localdate, help_text="Date d'achat")
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="spare_parts_added", help_text="Utilisateur qui a enregistré la pièce")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=AVAILABLE)
    used_at = models.DateTimeField(null=True, blank=True)
    used_in = models.ForeignKey(
        Maintenance, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="used_parts", help_text="Maintenance qui a consommé la pièce")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["status", "-created_at"]
        indexes = [models.Index(fields=["status"])]

    def __str__(self):
        return f"{self.name} ({self.serial_number})"
