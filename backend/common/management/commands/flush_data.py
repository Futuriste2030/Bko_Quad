"""Vide les données métier de la base, en conservant les comptes utilisateurs.

Usage (sur le VPS, depuis backend/) :
    python manage.py flush_data --confirm

Conservé : User, Site, Activity (formules), CompanyProfile, TrackedLine.
Réinitialisé : compteurs de factures (InvoiceSequence) -> 0.
Supprimé   : tout le reste (réservations, clients, paiements, factures,
             caisse, banque, appels, flotte, maintenance, RH/paie, messages,
             créneaux, engins, pièces, anomalies, audit, etc.).
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Vide les données métier en conservant users, sites et formules."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm", action="store_true",
            help="Confirme la suppression (obligatoire).",
        )
        parser.add_argument(
            "--keep-catalogue", action="store_true",
            help="Conserve aussi créneaux, engins, maintenance, pièces (catalogue complet).",
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
        from common.models import CompanyProfile, InvoiceSequence
        from telephony.models import TrackedLine
        from finance.models import BankTransaction, CashbookEntry, MonthlyClosing
        from telephony.models import DailyClosing
        from telephony.models import CallAnomaly, CallLog
        from comms.models import Message, Notice
        from payroll.models import (
            Contract, DocumentSignature, Employee, HRLetter, PayrollSheet, Payslip,
        )

        keep_catalogue = options["keep_catalogue"]

        with transaction.atomic():
            # Dépendances d'abord (Payment/Invoice protègent Booking).
            Payment.objects.all().delete()
            PaymentLink.objects.all().delete()
            Invoice.objects.all().delete()

            BookingEvent.objects.all().delete()
            BookingLine.objects.all().delete()
            Booking.objects.all().delete()

            CallAnomaly.objects.all().delete()
            CallLog.objects.all().delete()

            CashbookEntry.objects.all().delete()
            BankTransaction.objects.all().delete()
            DailyClosing.objects.all().delete()
            MonthlyClosing.objects.all().delete()

            Message.objects.all().delete()
            Notice.objects.all().delete()

            DocumentSignature.objects.all().delete()
            # PayslipLine et PayslipPayment protègent Payslip.
            try:
                from payroll.models import PayslipLine, PayslipPayment
                PayslipLine.objects.all().delete()
                PayslipPayment.objects.all().delete()
            except Exception:
                pass
            Payslip.objects.all().delete()
            PayrollSheet.objects.all().delete()
            HRLetter.objects.all().delete()
            Contract.objects.all().delete()
            Employee.objects.all().delete()

            Customer.objects.all().delete()

            if keep_catalogue:
                # Conserve créneaux, engins, maintenance, pièces.
                pass
            else:
                Slot.objects.all().delete()
                Maintenance.objects.all().delete()
                SparePart.objects.all().delete()
                Vehicle.objects.all().delete()

            # Audit (si présent)
            try:
                from audit.models import AuditLog
                AuditLog.objects.all().delete()
            except Exception:
                pass

            # Réinitialise les compteurs de factures à zéro.
            InvoiceSequence.objects.all().delete()

            # Réinitialise la synchro des lignes suivies (config conservée).
            TrackedLine.objects.all().update(last_sync=None)

        self.stdout.write(self.style.SUCCESS(
            "Base vidée (users, sites, formules conservés ; compteurs remis à 0)."
            + (" Catalogue complet conservé." if keep_catalogue
               else " Créneaux/engins/maintenance/pièces supprimés.")
        ))
        self.stdout.write(f"Comptes conservés : {User.objects.count()}")
        self.stdout.write(f"Sites conservés   : {Site.objects.count()}")
        self.stdout.write(f"Formules conservées : {Activity.objects.count()}")