"""Diagnostic de la clôture automatique du jour (exécutable sur le VPS)."""

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from telephony.models import DailyClosing
from telephony.tasks import close_day


class Command(BaseCommand):
    help = "Affiche les dernières clôtures et rattrape les jours dus (même logique que Celery)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--sans-rattrapage", action="store_true",
            help="Afficher seulement l'état, sans exécuter la clôture.")

    def handle(self, *args, **options):
        now = timezone.localtime()
        self.stdout.write(f"Fuseau : {settings.TIME_ZONE}")
        self.stdout.write(f"Heure locale : {now:%d/%m/%Y %H:%M}")
        self.stdout.write(f"Clôture automatique : {settings.BKO_CLOSING_HOUR:02d}:00")
        self.stdout.write("Rattrapage : 7 jours en arrière, toutes les 3 heures.")

        recent = DailyClosing.objects.order_by("-date")[:7]
        if recent:
            self.stdout.write("Dernières clôtures :")
            for closing in recent:
                self.stdout.write(
                    f"  {closing.date:%d/%m/%Y} — {closing.bookings_count} réservation(s), "
                    f"{closing.amount_collected} FCFA, validée le {closing.validated_at:%d/%m/%Y %H:%M}")
        else:
            self.stdout.write("Aucune clôture enregistrée.")

        if options["sans_rattrapage"]:
            return

        closed = close_day()
        if closed:
            self.stdout.write(self.style.SUCCESS(
                f"Clôture exécutée pour : {', '.join(closed)}"))
        else:
            self.stdout.write("Aucune clôture due maintenant (déjà faite ou avant 20h).")
