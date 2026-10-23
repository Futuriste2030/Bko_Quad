"""Garnit les sites sans formules avec le catalogue standard (idempotent)."""

from django.core.management.base import BaseCommand

from catalogue.models import Site
from catalogue.services import seed_empty_sites


class Command(BaseCommand):
    help = "Crée les formules standard sur les sites qui n'ont encore aucune formule."

    def add_arguments(self, parser):
        parser.add_argument("--site", type=int, help="Limiter à un site (identifiant).")

    def handle(self, *args, **options):
        sites = Site.objects.all()
        if options.get("site"):
            sites = sites.filter(pk=options["site"])
            if not sites.exists():
                self.stderr.write(f"Site #{options['site']} introuvable.")
                return

        report = seed_empty_sites(sites)
        if not report:
            self.stdout.write("Aucun site à garnir : créez d'abord un site.")
            return

        for site, created in report:
            if created:
                names = ", ".join(a.name for a in created)
                self.stdout.write(self.style.SUCCESS(
                    f"{site.name} : {len(created)} formule(s) créée(s) ({names})"))
            else:
                self.stdout.write(f"{site.name} : catalogue déjà présent, inchangé.")
