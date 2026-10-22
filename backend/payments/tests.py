"""Tests tranche 4 : webhook idempotent, signature, montants, facture sans trou."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings.models import Booking
from bookings.services import create_booking
from catalogue.models import Activity, Site, Slot
from clients.models import Customer
from finance.models import CashbookEntry
from payments.models import Invoice, Payment
from payments.services import (
    PaymentError,
    create_payment_link,
    document_ref,
    handle_webhook,
    issue_invoice,
    record_cash_balance,
    record_cash_payment,
)


def make_booking(persons=2):
    site = Site.objects.create(name="Bamako", city="Bamako")
    act = Activity.objects.create(
        site=site, name="Quad 1h", duration_minutes=60,
        base_price=20000, deposit=10000, max_group=10,
    )
    start = timezone.now() + timedelta(days=1)
    slot = Slot.objects.create(activity=act, start=start, end=start + timedelta(hours=1), capacity=10)
    cust = Customer.objects.create(name="M. Traoré", phone="+22370000001")
    agent = User.objects.create_user(username="agent1", password="x", phone="+22370000009", role="agent")
    return create_booking(customer=cust, slot_id=slot.id, persons=persons, created_by=agent), agent


class PaymentTest(TestCase):
    def test_webhook_confirme_et_idempotent(self):
        b, _ = make_booking()
        link = create_payment_link(booking_id=b.id)
        p1, created1 = handle_webhook(
            provider="stub", reference=link.reference, amount=link.amount, signature_valid=True,
        )
        self.assertTrue(created1)
        b.refresh_from_db()
        self.assertEqual(b.status, Booking.CONFIRMED)
        p2, created2 = handle_webhook(
            provider="stub", reference=link.reference, amount=link.amount, signature_valid=True,
        )
        self.assertFalse(created2)
        self.assertEqual(p1.id, p2.id)

    def test_signature_invalide_refusee(self):
        b, _ = make_booking()
        link = create_payment_link(booking_id=b.id)
        with self.assertRaises(PaymentError):
            handle_webhook(
                provider="stub", reference=link.reference, amount=link.amount, signature_valid=False,
            )

    def test_montant_incorrect_refuse(self):
        b, _ = make_booking()
        link = create_payment_link(booking_id=b.id)
        with self.assertRaises(PaymentError):
            handle_webhook(
                provider="stub", reference=link.reference, amount=link.amount + 1000, signature_valid=True,
            )

    def test_cash_solde_apres_confirmation(self):
        b, agent = make_booking()
        link = create_payment_link(booking_id=b.id)
        handle_webhook(provider="stub", reference=link.reference, amount=link.amount, signature_valid=True)
        p, created = record_cash_balance(booking_id=b.id, amount=20000, received_by=agent)
        self.assertTrue(created)
        self.assertEqual(p.mode, "cash")

    def test_factures_sequentielles_sans_trou(self):
        from clients.models import Customer

        b, _ = make_booking()
        i1, created1 = issue_invoice(booking_id=b.id)
        i2, created2 = issue_invoice(booking_id=b.id)
        self.assertTrue(created1)
        self.assertFalse(created2)
        self.assertEqual(i1.id, i2.id)
        self.assertEqual(Invoice.objects.count(), 1)
        cust2 = Customer.objects.create(name="Mme Diallo", phone="+22370000002")
        from bookings.services import create_booking
        b2 = create_booking(customer=cust2, slot_id=b.slot_id, persons=1, created_by=b.created_by)
        i3, _ = issue_invoice(booking_id=b2.id)
        self.assertEqual(i3.number, i1.number + 1)


class CashDepositTest(TestCase):
    def test_acompte_especes_complet_confirme_et_poste_ecriture(self):
        b, agent = make_booking()
        p, bb = record_cash_payment(
            booking_id=b.id, amount=b.total, nature="deposit", received_by=agent)
        self.assertEqual(p.mode, "cash")
        self.assertEqual(p.nature, "deposit")
        self.assertRegex(p.reference, r"^BKO-[A-Z0-9]+-[A-Z0-9]+-\d{8}-\d{4,}$")
        self.assertEqual(bb.status, Booking.CONFIRMED)
        entry = CashbookEntry.objects.filter(payment=p).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.direction, CashbookEntry.IN)
        self.assertEqual(entry.amount, b.total)

    def test_facture_auto_a_lencaissement_espaces_complet(self):
        """Paiement instantané : la facture est émise seule (numéro sans trou),
        l'émission manuelle renvoie la même facture sans nouveau numéro."""
        b, agent = make_booking()
        record_cash_payment(
            booking_id=b.id, amount=b.total, nature="deposit", received_by=agent)
        inv = Invoice.objects.filter(booking=b).order_by("id").first()
        self.assertIsNotNone(inv)
        again, created = issue_invoice(booking_id=b.id)
        self.assertFalse(created)
        self.assertEqual(again.id, inv.id)

    def test_webhook_couverte_emet_facture_auto(self):
        b, _ = make_booking()
        link = create_payment_link(booking_id=b.id)
        handle_webhook(provider="stub", reference=link.reference,
                       amount=link.amount, signature_valid=True)
        self.assertEqual(link.amount, b.deposit_due)
        inv = Invoice.objects.filter(booking=b).order_by("id").first()
        # Acompte seul (< total) : pas de facture automatique.
        if link.amount < b.total:
            self.assertIsNone(inv)
        else:
            self.assertIsNotNone(inv)

    def test_acompte_partiel_refuse(self):
        b, agent = make_booking()
        with self.assertRaises(PaymentError):
            record_cash_payment(
                booking_id=b.id, amount=b.deposit_due, nature="deposit", received_by=agent)
        self.assertEqual(Payment.objects.filter(booking=b).count(), 0)

    def test_sans_acompte_paiement_complet_confirme(self):
        b, agent = make_booking()
        act = b.slot.activity
        act.deposit = 0
        act.save(update_fields=["deposit"])
        b.deposit_due = 0
        b.save(update_fields=["deposit_due"])
        _, bb = record_cash_payment(
            booking_id=b.id, amount=b.total, nature="deposit", received_by=agent)
        self.assertEqual(bb.status, Booking.CONFIRMED)

    def test_surplus_refuse(self):
        b, agent = make_booking()
        with self.assertRaises(PaymentError):
            record_cash_payment(
                booking_id=b.id, amount=b.total + 5000, nature="deposit", received_by=agent)
        self.assertEqual(Payment.objects.filter(booking=b).count(), 0)

    def test_second_encaissement_solde_refuse(self):
        """Une facture = un seul encaissement : tout second versement est refusé."""
        b, agent = make_booking()
        act = b.slot.activity
        act.deposit = 0
        act.save(update_fields=["deposit"])
        b.deposit_due = 0
        b.save(update_fields=["deposit_due"])
        record_cash_payment(
            booking_id=b.id, amount=b.total, nature="deposit", received_by=agent)
        with self.assertRaises(PaymentError):
            record_cash_payment(
                booking_id=b.id, amount=b.total, nature="balance", received_by=agent)
        with self.assertRaises(PaymentError):
            record_cash_payment(
                booking_id=b.id, amount=1000, nature="balance", received_by=agent)
        self.assertEqual(Payment.objects.filter(booking=b).count(), 1)

    def test_solde_bloque_en_attente(self):
        b, agent = make_booking()
        with self.assertRaises(PaymentError):
            record_cash_payment(
                booking_id=b.id, amount=1000, nature="balance", received_by=agent)

    def test_webhook_poste_une_seule_ecriture(self):
        b, _ = make_booking()
        link = create_payment_link(booking_id=b.id)
        kw = dict(provider="stub", reference=link.reference, amount=link.amount, signature_valid=True)
        p1, _ = handle_webhook(**kw)
        handle_webhook(**kw)
        self.assertEqual(CashbookEntry.objects.filter(payment=p1).count(), 1)

    def test_format_reference_recu(self):
        b, _ = make_booking()
        ref = document_ref(b, 7)
        self.assertTrue(ref.startswith("BKO-BAMAKO-MTRAORE-"))
        self.assertTrue(ref.endswith("-0007"))

    def test_liste_paiements_reservee_finance(self):
        from rest_framework.test import APIClient

        b, agent = make_booking()
        record_cash_payment(
            booking_id=b.id, amount=b.total, nature="deposit", received_by=agent)
        comptable = User.objects.create_user(
            username="compta1", password="x", phone="+22370000002", role="comptable")
        client = APIClient()
        client.force_authenticate(user=comptable)
        r = client.get("/api/v1/payments/")
        self.assertEqual(r.status_code, 200)
        self.assertGreaterEqual(len(r.data if isinstance(r.data, list) else r.data.get("results", [])), 1)
        client.force_authenticate(user=agent)
        self.assertEqual(client.get("/api/v1/payments/").status_code, 403)

    def test_liste_factures_par_reservation(self):
        from rest_framework.test import APIClient

        b, agent = make_booking()
        issue_invoice(booking_id=b.id)
        client = APIClient()
        client.force_authenticate(user=agent)
        r = client.get("/api/v1/invoices/")
        self.assertEqual(r.status_code, 200)
        rows = r.data if isinstance(r.data, list) else r.data.get("results", [])
        self.assertTrue(any(x["booking"] == b.id for x in rows))
