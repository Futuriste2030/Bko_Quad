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


class ApiRolesTest(TestCase):
    """Tranche 7 : JWT, rôles serveur, versioning api/v1/."""

    def setUp(self):
        from datetime import timedelta

        from django.utils import timezone

        from accounts.models import User
        from catalogue.models import Activity, Site, Slot
        from clients.models import Customer

        site = Site.objects.create(name="Bamako", city="Bamako")
        act = Activity.objects.create(
            site=site, name="Quad 1h", duration_minutes=60,
            base_price=20000, deposit=10000, max_group=10,
        )
        start = timezone.now() + timedelta(days=1)
        self.slot = Slot.objects.create(
            activity=act, start=start, end=start + timedelta(hours=1), capacity=10)
        self.cust = Customer.objects.create(name="M. Traoré", phone="+22378803072")
        self.agent = User.objects.create_user(
            username="agent1", password="pw123456", phone="+22370000009", role="agent")
        self.guide = User.objects.create_user(
            username="guide1", password="pw123456", phone="+22370000008", role="guide")

    def _token(self, username):
        from rest_framework.test import APIClient

        c = APIClient()
        r = c.post("/api/v1/auth/token/", {"username": username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200, r.content[:200])
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
        return c

    def test_sans_token_401(self):
        from rest_framework.test import APIClient

        r = APIClient().get("/api/v1/bookings/")
        self.assertEqual(r.status_code, 401)

    def test_agent_cree_guide_refuse(self):
        agent = self._token("agent1")
        r = agent.post("/api/v1/bookings/", {
            "customer": self.cust.id, "slot": self.slot.id, "persons": 2, "source": "phone"})
        self.assertEqual(r.status_code, 201, r.content[:300])
        guide = self._token("guide1")
        r2 = guide.post("/api/v1/bookings/", {
            "customer": self.cust.id, "slot": self.slot.id, "persons": 1})
        self.assertEqual(r2.status_code, 403)

    def test_webhook_confirme_sans_token(self):
        from rest_framework.test import APIClient

        agent = self._token("agent1")
        b = agent.post("/api/v1/bookings/", {
            "customer": self.cust.id, "slot": self.slot.id, "persons": 1}).data
        link = agent.post("/api/v1/payments/link/", {"booking": b["id"]}).data
        anon = APIClient()
        r = anon.post("/api/v1/payments/webhook/", {
            "provider": "stub", "reference": link["reference"],
            "amount": link["amount"], "signature_valid": True})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["created"])
