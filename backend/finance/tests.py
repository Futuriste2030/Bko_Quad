"""Tests caisse : constats Excel devenus règles."""

from datetime import date

from django.test import TestCase

from accounts.models import User
from finance.models import CashbookEntry
from finance.services import FinanceError, add_entry, close_month


class CashbookTest(TestCase):
    def setUp(self):
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")

    def test_bordereau_auto_unique_par_mois(self):
        e1 = add_entry(day=date(2026, 10, 5), category="recette_reservation",
                       label="R1", direction="in", amount=50000, created_by=self.agent)
        e2 = add_entry(day=date(2026, 10, 6), category="recette_reservation",
                       label="R2", direction="in", amount=10000, created_by=self.agent)
        self.assertEqual(e1.voucher, "202610-001")
        self.assertEqual(e2.voucher, "202610-002")

    def test_sortie_negative_refusee(self):
        add_entry(day=date(2026, 10, 5), category="recette_reservation",
                  label="R", direction="in", amount=10000, created_by=self.agent)
        with self.assertRaises(FinanceError):
            add_entry(day=date(2026, 10, 6), category="carburant",
                      label="C", direction="out", amount=20000, created_by=self.agent)

    def test_cloture_verrouille_et_reporte(self):
        add_entry(day=date(2026, 10, 5), category="recette_reservation",
                  label="R", direction="in", amount=30000, created_by=self.agent)
        closing = close_month(2026, 10)
        self.assertEqual(closing.closing, 30000)
        entry = CashbookEntry.objects.first()
        entry.refresh_from_db()
        self.assertTrue(entry.locked)
        with self.assertRaises(RuntimeError):
            entry.label = "modifié"
            entry.save()
        with self.assertRaises(FinanceError):
            add_entry(day=date(2026, 10, 20), category="autre",
                      label="Tard", direction="in", amount=1000, created_by=self.agent)
        nov = close_month(2026, 11)
        self.assertEqual(nov.opening, 30000)
