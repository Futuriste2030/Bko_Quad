"""Tests tranche 4 : webhook idempotent, signature, montants, facture sans trou."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings.models import Booking
from bookings.services import create_booking
from catalogue.models import Activity, Site, Slot
from clients.models import Customer
from payments.models import Invoice
from payments.services import (
    PaymentError,
    create_payment_link,
    handle_webhook,
    issue_invoice,
    record_cash_balance,
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
        b, _ = make_booking()
        i1 = issue_invoice(booking_id=b.id)
        i2 = issue_invoice(booking_id=b.id)
        self.assertEqual(i2.number, i1.number + 1)
        self.assertEqual(Invoice.objects.count(), 2)
