"""Vide les données métier de la base, en conservant les comptes utilisateurs.

Usage (sur le VPS, depuis backend/) :
    python manage.py flush_data --confirm

Conservé : User, Site, Activity, CompanyProfile, TrackedLine.
Supprimé  : réservations, clients, paiements, factures, caisse, banque,
            appels, flotte, maintenance, RH/paie, messages, etc.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Vide les données métier en conservant les comptes utilisateurs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm", action="store_true",
            help="Confirme la suppression (obligatoire).",
        )
        parser.add_argument(
            "--keep-catalogue", action="store_true",
            help="Conserve aussi les sites, formules, créneaux, engins (par défaut : tout sauf users).",
        )

    def handle(self, *args, **options):
        if not options["confirm"]:
            raise CommandError(
                "Ajoutez --confirm pour valider la suppression. "
                "Sauvegardez d'abord la base (pg_dump)."
            )

        from accounts.models import User
        from catalogue.models import Activity, Maintenance, Site, Slot, SparePart, Vehicle
        from clients.models import Customer
        from bookings.models import Booking, BookingEvent, BookingLine
        from payments.models import Invoice, Payment, PaymentLink
        from finance.models import BankTransaction, CashbookEntry, DailyClosing, MonthlyClosing
        from telephony.models import CallAnomaly, CallLog
        from comms.models import Message, Notice
        from payroll.models import (
            Contract, DocumentSignature, Employee, HRLetter, PayrollSheet, Payslip,
        )

        keep_catalogue = options["keep_catalogue"]

        with transaction.atomic():
            # Dépendances d'abord.
            BookingEvent.objects.all().delete()
            BookingLine.objects.all().delete()
            Booking.objects.all().delete()

            Payment.objects.all().delete()
            PaymentLink.objects.all().delete()
            Invoice.objects.all().delete()

            CallAnomaly.objects.all().delete()
            CallLog.objects.all().delete()

            CashbookEntry.objects.all().delete()
            BankTransaction.objects.all().delete()
            DailyClosing.objects.all().delete()
            MonthlyClosing.objects.all().delete()

            Message.objects.all().delete()
            Notice.objects.all().delete()

            DocumentSignature.objects.all().delete()
            Payslip.objects.all().delete()
            PayrollSheet.objects.all().delete()
            HRLetter.objects.all().delete()
            Contract.objects.all().delete()
            Employee.objects.all().delete()

            Customer.objects.all().delete()

            if not keep_catalogue:
                Slot.objects.all().delete()
                Maintenance.objects.all().delete()
                SparePart.objects.all().delete()
                Vehicle.objects.all().delete()
                Activity.objects.all().delete()
                Site.objects.all().delete()

            # Audit (si présent)
            try:
                from audit.models import AuditLog
                AuditLog.objects.all().delete()
            except Exception:
                pass

            # TrackedLine : conservée (config), mais reset last_sync optionnel.
            # On la conserve pour ne pas casser l'APK collecteur.

        self.stdout.write(self.style.SUCCESS(
            "Base vidée (comptes utilisateurs conservés). "
            + ("Catalogue conservé." if keep_catalogue else "Catalogue supprimé aussi.")
        ))
        self.stdout.write(f"Comptes conservés : {User.objects.count()}")