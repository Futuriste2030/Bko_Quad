"""Ajoute la formule « Quad 2H » sur les sites Konibabougou (idempotent)."""
from django.core.management.base import BaseCommand

from bookings.services import is_koni_site
from catalogue.models import Activity, Site


class Command(BaseCommand):
    help = "Crée la formule Quad 2H (120 min, 40000 FCFA) sur les sites Konibabougou."

    def handle(self, *args, **options):
        created_total = 0
        for site in Site.objects.all():
            if not is_koni_site(site.name or ""):
                continue
            act, made = Activity.objects.get_or_create(
                site=site,
                name="Quad 2H",
                defaults={
                    "duration_minutes": 120,
                    "base_price": 40000,
                    "deposit": 0,
                    "max_group": 10,
                },
            )
            if made:
                created_total += 1
                self.stdout.write(self.style.SUCCESS(f"{site.name} : Quad 2H créée."))
            else:
                self.stdout.write(f"{site.name} : Quad 2H déjà présente.")
        self.stdout.write(f"Total créées : {created_total}.")