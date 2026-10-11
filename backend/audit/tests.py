"""Tests audit + expiration auto."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from audit.models import AuditLog
from audit.services import expire_overdue, log_action, weekly_report
from bookings.models import Booking
from bookings.services import create_booking
from catalogue.models import Activity, Site, Slot
from clients.models import Customer


class AuditTest(TestCase):
    def test_append_only(self):
        log = log_action(action="test", entity="booking:1")
        with self.assertRaises(RuntimeError):
            log.action = "modifié"
            log.save()
        with self.assertRaises(RuntimeError):
            log.delete()

    def test_expire_overdue(self):
        site = Site.objects.create(name="Bamako", city="Bamako")
        act = Activity.objects.create(
            site=site, name="Quad 1h", duration_minutes=60,
            base_price=20000, deposit=10000, max_group=10)
        start = timezone.now() + timedelta(days=1)
        slot = Slot.objects.create(activity=act, start=start, end=start + timedelta(hours=1), capacity=10)
        cust = Customer.objects.create(name="M. Traoré", phone="+22378803072")
        agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")
        b = create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)
        Booking.objects.filter(pk=b.id).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(expire_overdue(), 1)
        b.refresh_from_db()
        self.assertEqual(b.status, Booking.EXPIRED)
        self.assertEqual(b.events.count(), 2)

    def test_weekly_report(self):
        r = weekly_report(2026, 42)
        self.assertEqual(r.content["anomalies_open"], 0)
        self.assertEqual(AuditLog.objects.count(), 0)
