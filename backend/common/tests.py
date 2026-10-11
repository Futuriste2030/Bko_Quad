"""Tests socle tranche 1 : fuseau (B), compteur factures (G)."""

from django.conf import settings
from django.test import TestCase

from common.models import InvoiceSequence, next_invoice_number


class TimezoneTest(TestCase):
    def test_bamako(self):
        self.assertEqual(settings.TIME_ZONE, "Africa/Bamako")
        self.assertTrue(settings.USE_TZ)


class InvoiceSequenceTest(TestCase):
    def test_sequentiel_sans_trou(self):
        self.assertEqual(next_invoice_number("test"), 1)
        self.assertEqual(next_invoice_number("test"), 2)
        self.assertEqual(InvoiceSequence.objects.get(scope="test").last_number, 2)

    def test_scopes_independants(self):
        next_invoice_number("a")
        self.assertEqual(next_invoice_number("b"), 1)
