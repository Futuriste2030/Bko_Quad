"""Tests journal + rapprochement + clôture."""

from datetime import timedelta

from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings.services import create_booking
from catalogue.models import Activity, Site, Slot
from clients.models import Customer
from telephony.models import CallLog
from telephony.services import (
    TelephonyError,
    daily_closing,
    normalize_phone,
    reconcile_call,
    resolve_anomaly,
)


class CallLogTest(TestCase):
    def test_external_id_unique(self):
        now = timezone.now()
        CallLog.objects.create(
            direction="inbound", phone_number="+22378803072",
            started_at=now, duration_seconds=60, external_id="ext-1",
        )
        with self.assertRaises(IntegrityError):
            CallLog.objects.create(
                direction="inbound", phone_number="+22378803072",
                started_at=now, duration_seconds=60, external_id="ext-1",
            )


class ReconcileTest(TestCase):
    def setUp(self):
        site = Site.objects.create(name="Bamako", city="Bamako")
        act = Activity.objects.create(
            site=site, name="Quad 1h", duration_minutes=60,
            base_price=20000, deposit=10000, max_group=10,
        )
        start = timezone.now() + timedelta(days=1)
        self.slot = Slot.objects.create(
            activity=act, start=start, end=start + timedelta(hours=1), capacity=10)
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")

    def test_normalize(self):
        self.assertEqual(normalize_phone("+223 78 80 30 72"), "+22378803072")
        self.assertEqual(normalize_phone("78803072"), "+22378803072")

    def test_rapproche_si_reservation(self):
        cust = Customer.objects.create(name="M. Traoré", phone="+22378803072")
        b = create_booking(customer=cust, slot_id=self.slot.id, persons=1, created_by=self.agent)
        call = CallLog.objects.create(
            direction="inbound", phone_number="+22378803072",
            started_at=timezone.now(), duration_seconds=60, external_id="ext-a",
        )
        found, anomaly = reconcile_call(call.id)
        self.assertIsNone(anomaly)
        self.assertEqual(found.id, b.id)

    def test_anomalie_sans_reservation_puis_motif(self):
        call = CallLog.objects.create(
            direction="inbound", phone_number="+22371111111",
            started_at=timezone.now(), duration_seconds=30, external_id="ext-b",
        )
        found, anomaly = reconcile_call(call.id)
        self.assertIsNone(found)
        self.assertEqual(anomaly.status, "open")
        with self.assertRaises(TelephonyError):
            resolve_anomaly(anomaly.id, "")
        resolve_anomaly(anomaly.id, "renseignement", resolved_by=self.agent)
        anomaly.refresh_from_db()
        self.assertEqual(anomaly.status, "resolved")

    def test_cloture_compte(self):
        cust = Customer.objects.create(name="M. Traoré", phone="+22378803072")
        create_booking(customer=cust, slot_id=self.slot.id, persons=1, created_by=self.agent)
        CallLog.objects.create(
            direction="inbound", phone_number="+22378803072",
            started_at=timezone.now(), duration_seconds=60, external_id="ext-c",
        )
        closing = daily_closing(timezone.now().date(), validated_by=self.agent)
        self.assertEqual(closing.bookings_count, 1)
        self.assertEqual(closing.calls_count, 1)
