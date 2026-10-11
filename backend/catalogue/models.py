"""Catalogue minimal tranche 3 : Site, Activity, Slot. Montants entiers FCFA."""

from django.db import models


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

    class Meta:
        ordering = ["start"]
        indexes = [models.Index(fields=["activity", "start"])]

    def __str__(self):
        return f"{self.activity} {self.start:%d/%m %H:%M}"
