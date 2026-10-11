"""Tests journal d'appels minimal : unicité external_id."""

from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone

from telephony.models import CallLog


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
