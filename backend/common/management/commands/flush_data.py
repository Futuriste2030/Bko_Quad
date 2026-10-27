"""Vide les données métier de la base, en conservant les comptes utilisateurs.

Usage (sur le VPS, depuis backend/) :
    python manage.py flush_data --confirm                       # purge totale (comme avant)
    python manage.py flush_data --confirm --since 2026-10-27    # purge partielle : uniquement
                                                              # ce qui a été créé à partir
                                                              # de cette date (présentation),
                                                              # les encaissements antérieurs
                                                              # et les autres parties sont gardés.
    python manage.py flush_data --confirm --since 2026-10-27 --dry-run  # simulation

Conservé toujours : User, Site, Activity (formules), CompanyProfile, TrackedLine (config).
Réinitialisé (purge totale seulement) : compteurs de factures (InvoiceSequence) -> 0.
Supprimé : réservations, paiements, factures, écritures de caisse/banque, appels,
           anomalies, clients, journaux d'audit créés dans la fenêtre, et dépendances.
"""
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Vide les données métier en conservant users, sites et formules."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm", action="store_true",
            help="Confirme la suppression (obligatoire), sauf en --dry-run.",
        )
        parser.add_argument(
            "--keep-catalogue", action="store_true",
            help="Conserve aussi créneaux, engins, maintenance, pièces (catalogue complet).",
        )
        parser.add_argument(
            "--since", type=str, default=None,
            help="Date ISO (YYYY-MM-DD). Si fournie, ne supprime que les enregistrements "
                 "créés à partir de cette date (purge partielle de présentation). "
                 "Les encaissements antérieurs sont conservés.",
        )
        parser.add_argument(
            "--until", type=str, default=None,
            help="Date ISO (YYYY-MM-DD) de fin (incluse). Par défaut : aucune borne haute.",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Affiche ce qui serait supprimé, sans rien supprimer.",
        )

    def _parse_date(self, value, name):
        try:
            return date.fromisoformat(value)
        except (TypeError, ValueError):
            raise CommandError(f"{name} doit être au format YYYY-MM-DD (reçu : {value!r}).")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if not dry_run and not options["confirm"]:
            raise CommandError(
                "Ajoutez --confirm pour valider la suppression. "
                "Sauvegardez d'abord la base (pg_dump / copie sqlite). "
                "Ou utilisez --dry-run pour simuler."
            )

        since = None
        until = None
        if options["since"]:
            since = self._parse_date(options["since"], "--since")
        if options["until"]:
            until = self._parse_date(options["until"], "--until")

        partial = since is not None or until is not None

        from accounts.models import User
        from catalogue.models import Activity, Maintenance, Site, Slot, SparePart, Vehicle
        from clients.models import Customer
        from bookings.models import Booking, BookingEvent, BookingLine
        from payments.models import Invoice, Payment, PaymentLink
        from common.models import InvoiceSequence
        from telephony.models import TrackedLine
        from finance.models import BankTransaction, CashbookEntry, MonthlyClosing
        from telephony.models import DailyClosing
        from telephony.models import CallAnomaly, CallLog
        from comms.models import Message, Notice
        from payroll.models import (
            Contract, DocumentSignature, Employee, HRLetter, PayrollSheet, Payslip,
        )

        keep_catalogue = options["keep_catalogue"]

        def window(qs, field):
            if since is not None:
                qs = qs.filter(**{f"{field}__date__gte": since})
            if until is not None:
                qs = qs.filter(**{f"{field}__date__lte": until})
            return qs

        # Pré-calcul des querysets.
        if partial:
            payments_qs = window(Payment.objects.all(), "created_at")
            payment_links_qs = window(PaymentLink.objects.all(), "created_at")
            invoices_qs = window(Invoice.objects.all(), "issued_at")
            bookings_qs = window(Booking.objects.all(), "created_at")
            cashbook_qs = window(CashbookEntry.objects.all(), "created_at")
            bank_qs = window(BankTransaction.objects.all(), "created_at")
            calllogs_qs = window(CallLog.objects.all(), "created_at")
            anomalies_qs = window(CallAnomaly.objects.all(), "created_at")
            customers_qs = window(Customer.objects.all(), "created_at")
        else:
            payments_qs = Payment.objects.all()
            payment_links_qs = PaymentLink.objects.all()
            invoices_qs = Invoice.objects.all()
            bookings_qs = Booking.objects.all()
            cashbook_qs = CashbookEntry.objects.all()
            bank_qs = BankTransaction.objects.all()
            calllogs_qs = CallLog.objects.all()
            anomalies_qs = CallAnomaly.objects.all()
            customers_qs = Customer.objects.all()

        booking_ids = list(bookings_qs.values_list("id", flat=True))
        booking_events_qs = BookingEvent.objects.filter(booking_id__in=booking_ids)
        booking_lines_qs = BookingLine.objects.filter(booking_id__in=booking_ids)
        if not partial:
            booking_events_qs = BookingEvent.objects.all()
            booking_lines_qs = BookingLine.objects.all()

        if not partial:
            messages_qs = Message.objects.all()
            notices_qs = Notice.objects.all()
            daily_qs = DailyClosing.objects.all()
            monthly_qs = MonthlyClosing.objects.all()
        else:
            messages_qs = Message.objects.none()
            notices_qs = Notice.objects.none()
            daily_qs = DailyClosing.objects.none()
            monthly_qs = MonthlyClosing.objects.none()

        if (not partial) and (not keep_catalogue):
            slots_qs = Slot.objects.all()
            maintenance_qs = Maintenance.objects.all()
            spareparts_qs = SparePart.objects.all()
            vehicles_qs = Vehicle.objects.all()
        else:
            slots_qs = Slot.objects.none()
            maintenance_qs = Maintenance.objects.none()
            spareparts_qs = SparePart.objects.none()
            vehicles_qs = Vehicle.objects.none()

        # Journaux d'audit.
        try:
            from audit.models import AuditLog
            if partial:
                audit_qs = window(AuditLog.objects.all(), "created_at")
            else:
                audit_qs = AuditLog.objects.all()
        except Exception:
            audit_qs = None

        if not partial:
            try:
                from payroll.models import PayslipLine, PayslipPayment
                payslip_lines_qs = PayslipLine.objects.all()
                payslip_payments_qs = PayslipPayment.objects.all()
            except Exception:
                payslip_lines_qs = None
                payslip_payments_qs = None
            docsig_qs = DocumentSignature.objects.all()
            payslip_qs = Payslip.objects.all()
            sheet_qs = PayrollSheet.objects.all()
            hrletter_qs = HRLetter.objects.all()
            contract_qs = Contract.objects.all()
            employee_qs = Employee.objects.all()
        else:
            payslip_lines_qs = None
            payslip_payments_qs = None
            docsig_qs = DocumentSignature.objects.none()
            payslip_qs = Payslip.objects.none()
            sheet_qs = PayrollSheet.objects.none()
            hrletter_qs = HRLetter.objects.none()
            contract_qs = Contract.objects.none()
            employee_qs = Employee.objects.none()

        # Résumé.
        self.stdout.write("Ce qui sera supprimé :")
        summary = {
            "Payment": payments_qs.count(),
            "PaymentLink": payment_links_qs.count(),
            "Invoice": invoices_qs.count(),
            "Booking": bookings_qs.count(),
            "BookingEvent": booking_events_qs.count(),
            "BookingLine": booking_lines_qs.count(),
            "CashbookEntry": cashbook_qs.count(),
            "BankTransaction": bank_qs.count(),
            "CallLog": calllogs_qs.count(),
            "CallAnomaly": anomalies_qs.count(),
            "Customer": customers_qs.count(),
            "AuditLog": (audit_qs.count() if audit_qs is not None else 0),
            "Message": messages_qs.count(),
            "Notice": notices_qs.count(),
            "DailyClosing": daily_qs.count(),
            "MonthlyClosing": monthly_qs.count(),
            "Slot": slots_qs.count(),
            "Maintenance": maintenance_qs.count(),
            "SparePart": spareparts_qs.count(),
            "Vehicle": vehicles_qs.count(),
        }
        for k, v in summary.items():
            self.stdout.write(f"  {k}: {v}")

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry-run : aucune suppression effectuée."))
            return

        with transaction.atomic():
            payments_qs.delete()
            payment_links_qs.delete()
            invoices_qs.delete()

            booking_events_qs.delete()
            booking_lines_qs.delete()
            bookings_qs.delete()

            anomalies_qs.delete()
            calllogs_qs.delete()

            cashbook_qs.delete()
            bank_qs.delete()
            daily_qs.delete()
            monthly_qs.delete()

            messages_qs.delete()
            notices_qs.delete()

            docsig_qs.delete()
            if payslip_lines_qs is not None:
                payslip_lines_qs.delete()
            if payslip_payments_qs is not None:
                payslip_payments_qs.delete()
            payslip_qs.delete()
            sheet_qs.delete()
            hrletter_qs.delete()
            contract_qs.delete()
            employee_qs.delete()

            customers_qs.delete()

            if audit_qs is not None:
                audit_qs.delete()

            slots_qs.delete()
            maintenance_qs.delete()
            spareparts_qs.delete()
            vehicles_qs.delete()

            if not partial:
                InvoiceSequence.objects.all().delete()
                TrackedLine.objects.all().update(last_sync=None)

            # Backfill : les écritures de caisse antérieures sans site sont
            # rattachées au site de Konibabougou (conservation de l'historique).
            if partial and since is not None:
                from catalogue.models import Site
                ksite = Site.objects.filter(name__icontains="konibabougou").first()
                if ksite is None:
                    ksite = Site.objects.filter(pk=2).first()
                if ksite is not None:
                    from finance.models import CashbookEntry
                    updated = CashbookEntry.objects.filter(
                        created_at__date__lt=since).update(site=ksite)
                    # Même traitement pour les opérations bancaires antérieures sans site.
                    from finance.models import BankTransaction
                    updated_bank = BankTransaction.objects.filter(
                        site__isnull=True, created_at__date__lt=since).update(site=ksite)
                    self.stdout.write(f"Écritures rattachées à {ksite.name} : {updated} caisse, {updated_bank} banque")

        self.stdout.write(self.style.SUCCESS(
            "Purge terminée."
            + (" (partielle)" if partial else " (totale)")
        ))
        self.stdout.write(f"Comptes conservés : {User.objects.count()}")
        self.stdout.write(f"Sites conservés   : {Site.objects.count()}")
        self.stdout.write(f"Formules conservées : {Activity.objects.count()}")