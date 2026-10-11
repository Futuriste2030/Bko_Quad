"""Tests tranche 3 : 7 statuts (A), anti-doublon, capacité, webhook seul confirme."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings.models import Booking, BookingEvent
from bookings.services import BookingError, create_booking, transition
from catalogue.models import Activity, Site, Slot
from clients.models import Customer


def make_setup(capacity=4):
    site = Site.objects.create(name="Bamako", city="Bamako")
    act = Activity.objects.create(
        site=site, name="Quad 1h", duration_minutes=60,
        base_price=20000, deposit=10000, max_group=10,
    )
    start = timezone.now() + timedelta(days=1)
    slot = Slot.objects.create(activity=act, start=start, end=start + timedelta(hours=1), capacity=capacity)
    cust = Customer.objects.create(name="M. Traoré", phone="+22370000001")
    agent = User.objects.create_user(username="agent1", password="x", phone="+22370000009", role="agent")
    return cust, slot, agent


class BookingTest(TestCase):
    def test_7_statuts_sans_brouillon(self):
        codes = [c for c, _ in Booking.STATUS_CHOICES]
        self.assertEqual(
            codes,
            ["pending_deposit", "confirmed", "checked_in", "completed", "cancelled", "no_show", "expired"],
        )
        self.assertNotIn("draft", codes)

    def test_create_calcule_prix_et_trace(self):
        cust, slot, agent = make_setup()
        b = create_booking(customer=cust, slot_id=slot.id, persons=2, source="phone", created_by=agent)
        self.assertTrue(b.code.startswith("BKO-"))
        self.assertEqual(b.total, 40000)
        self.assertEqual(b.deposit_due, 20000)
        self.assertEqual(b.status, "pending_deposit")
        self.assertEqual(b.events.count(), 1)

    def test_anti_doublon(self):
        cust, slot, agent = make_setup()
        create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)

    def test_capacite_complete(self):
        cust, slot, agent = make_setup(capacity=2)
        cust2 = Customer.objects.create(name="Mme Diallo", phone="+22370000002")
        create_booking(customer=cust, slot_id=slot.id, persons=2, created_by=agent)
        with self.assertRaises(BookingError) as cm:
            create_booking(customer=cust2, slot_id=slot.id, persons=1, created_by=agent)
        self.assertIn("complet", str(cm.exception))

    def test_seul_webhook_confirme(self):
        cust, slot, agent = make_setup()
        b = create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)
        with self.assertRaises(BookingError):
            transition(booking_id=b.id, to_status="confirmed", actor=agent)
        b = transition(booking_id=b.id, to_status="confirmed", actor=agent, via_webhook=True)
        self.assertEqual(b.status, "confirmed")

    def test_annulation_motif_obligatoire(self):
        cust, slot, agent = make_setup()
        b = create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)
        with self.assertRaises(BookingError):
            transition(booking_id=b.id, to_status="cancelled", actor=agent)
        b = transition(booking_id=b.id, to_status="cancelled", actor=agent, reason="Client indisponible")
        self.assertEqual(b.cancel_reason, "Client indisponible")

    def test_jamais_supprime_event_append_only(self):
        cust, slot, agent = make_setup()
        b = create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)
        with self.assertRaises(RuntimeError):
            b.delete()
        ev = b.events.first()
        with self.assertRaises(RuntimeError):
            ev.save()
        with self.assertRaises(RuntimeError):
            ev.delete()
