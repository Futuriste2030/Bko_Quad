"""Tests caisse : constats Excel devenus règles."""

from datetime import date

from django.test import TestCase

from accounts.models import User
from finance.models import BankTransaction, CashbookEntry
from finance.services import FinanceError, add_bank_transaction, add_entry, bank_balance, close_month


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


class ExpenseApiTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="boss", password="x", phone="+22370000001", role="admin")
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")

    def test_depense_et_resume_mois(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.admin)
        add_entry(day=date(2026, 10, 5), category="recette_reservation",
                  label="R", direction="in", amount=50000, created_by=self.admin)
        r = client.post("/api/v1/finance/expense/", {
            "day": "2026-10-06", "category": "carburant",
            "label": "Gasoil groupe", "amount": 10000,
        })
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data["voucher"].startswith("202610-"))
        s = client.get("/api/v1/finance/month/?year=2026&month=10")
        self.assertEqual(s.status_code, 200)
        self.assertEqual(s.data["inn"], 50000)
        self.assertEqual(s.data["out"], 10000)
        self.assertEqual(s.data["balance"], 40000)
        self.assertFalse(s.data["locked"])

    def test_recette_manuelle_ancien_in_autorisee(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.admin)
        r = client.post("/api/v1/finance/expense/", {
            "day": "2026-09-15", "category": "recette_manuelle",
            "label": "Ancien encaissement espèces septembre",
            "amount": 120000, "direction": "in", "receipt": "ANC-001",
        })
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["direction"], "in")
        self.assertEqual(r.data["voucher"], "202609-001")
        # IN hors recette_manuelle refusé.
        bad = client.post("/api/v1/finance/expense/", {
            "day": "2026-09-16", "category": "autre",
            "label": "Détourné", "amount": 5000, "direction": "in",
        })
        self.assertEqual(bad.status_code, 400)

    def test_agent_ne_poste_pas(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.agent)
        r = client.post("/api/v1/finance/expense/", {
            "category": "carburant", "label": "X", "amount": 1000,
        })
        self.assertEqual(r.status_code, 403)
        self.assertEqual(client.get("/api/v1/finance/month/").status_code, 403)


class BankTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="boss", password="x", phone="+22370000001", role="admin")
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")

    def test_versement_puis_retrait_solde(self):
        add_bank_transaction(type="deposit", day=date(2026, 10, 5),
                             reason="Versement recette nette fin de mois",
                             amount=300000, first_name="Awa", last_name="Diallo",
                             receipt_number="BV-001", bank="BIM", created_by=self.admin)
        add_bank_transaction(type="withdrawal", day=date(2026, 10, 6),
                             reason="Paiement fournisseur par chèque",
                             amount=50000, first_name="Bakary", last_name="Traoré",
                             check_number="CHQ-12", bank="BIM", created_by=self.admin)
        self.assertEqual(bank_balance(), 250000)

    def test_bordereau_requis_et_unique(self):
        with self.assertRaises(FinanceError):
            add_bank_transaction(type="deposit", day=date(2026, 10, 5),
                                 reason="Sans bordereau", amount=1000,
                                 first_name="A", last_name="B", bank="BIM",
                                 created_by=self.admin)
        add_bank_transaction(type="deposit", day=date(2026, 10, 5),
                             reason="Versement direct", amount=1000,
                             first_name="A", last_name="B", bank="BIM",
                             receipt_number="BV-7", created_by=self.admin)
        with self.assertRaises(FinanceError):
            add_bank_transaction(type="deposit", day=date(2026, 10, 6),
                                 reason="Doublon", amount=1000,
                                 first_name="A", last_name="B", bank="BIM",
                                 receipt_number="BV-7", created_by=self.admin)

    def test_cheque_requis_et_retrait_negatif_refuse(self):
        with self.assertRaises(FinanceError):
            add_bank_transaction(type="withdrawal", day=date(2026, 10, 5),
                                 reason="Sans chèque", amount=1000,
                                 first_name="A", last_name="B", bank="BIM",
                                 created_by=self.admin)
        with self.assertRaises(FinanceError):
            add_bank_transaction(type="withdrawal", day=date(2026, 10, 5),
                                 reason="À découvert", amount=1000,
                                 first_name="A", last_name="B", bank="BIM",
                                 check_number="CHQ-1", created_by=self.admin)

    def test_banque_requise(self):
        with self.assertRaises(FinanceError):
            add_bank_transaction(type="deposit", day=date(2026, 10, 5),
                                 reason="Sans banque", amount=1000,
                                 first_name="A", last_name="B",
                                 receipt_number="BV-8", created_by=self.admin)

    def test_virement_sans_reference_credite(self):
        tx = add_bank_transaction(type="transfer", day=date(2026, 10, 7),
                                  reason="Virement client TRA-9",
                                  amount=200000, first_name="Orange Money",
                                  last_name="", bank="BIM",
                                  counterparty_bank="Orange",
                                  created_by=self.admin)
        self.assertEqual(tx.type, "transfer")
        self.assertEqual(bank_balance(), 200000)

    def test_jamais_supprime(self):
        tx = add_bank_transaction(type="deposit", day=date(2026, 10, 5),
                                  reason="Versement direct", amount=1000,
                                  first_name="A", last_name="B", bank="BIM",
                                  receipt_number="BV-9", created_by=self.admin)
        with self.assertRaises(RuntimeError):
            tx.delete()

    def test_api_depot_retrait_resume_et_roles(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.admin)
        r = client.post("/api/v1/bank/deposit/", {
            "date": "2026-10-05", "reason": "Versement recette nette fin de mois",
            "amount": 300000, "person_first_name": "Awa", "person_last_name": "Diallo",
            "receipt_number": "BV-001", "bank": "BIM",
        })
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["balance"], 300000)
        w = client.post("/api/v1/bank/withdrawal/", {
            "date": "2026-10-06", "reason": "Paiement fournisseur par chèque",
            "amount": 50000, "person_first_name": "Bakary", "person_last_name": "Traoré",
            "check_number": "CHQ-12", "bank": "BIM",
        })
        self.assertEqual(w.status_code, 201)
        t = client.post("/api/v1/bank/transfer/", {
            "date": "2026-10-07", "reason": "Virement client TRA-9",
            "amount": 200000, "person_first_name": "Orange Money",
            "bank": "BIM", "counterparty_bank": "Orange",
        })
        self.assertEqual(t.status_code, 201)
        self.assertEqual(t.data["balance"], 450000)
        s = client.get("/api/v1/bank/summary/?year=2026&month=10")
        self.assertEqual(s.status_code, 200)
        self.assertEqual(s.data["balance"], 450000)
        self.assertEqual(len(s.data["rows"]), 3)
        self.assertEqual(s.data["rows"][0]["running"], 300000)
        self.assertEqual(s.data["rows"][1]["running"], 250000)
        self.assertEqual(s.data["rows"][2]["running"], 450000)
        # Filtre par banque.
        sbim = client.get("/api/v1/bank/summary/?year=2026&month=10&bank=BIM")
        self.assertEqual(len(sbim.data["rows"]), 3)
        sother = client.get("/api/v1/bank/summary/?year=2026&month=10&bank=BOA")
        self.assertEqual(len(sother.data["rows"]), 0)
        self.assertEqual(sother.data["deposits"], 0)
        self.assertEqual(client.get("/api/v1/bank-transactions/").status_code, 200)
        # Agent : ni écriture ni lecture.
        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        self.assertEqual(agent.post("/api/v1/bank/deposit/", {
            "date": "2026-10-07", "reason": "X", "amount": 1000,
            "person_first_name": "A", "person_last_name": "B",
            "receipt_number": "BV-2",
        }).status_code, 403)
        self.assertEqual(agent.get("/api/v1/bank/summary/").status_code, 403)
