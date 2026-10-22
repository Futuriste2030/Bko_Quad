"""Tests socle tranche 1 : fuseau (B), compteur factures (G)."""

from django.conf import settings
from django.test import TestCase
from django.utils import timezone

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


class CompanyTest(TestCase):
    def test_singleton_lecture_ecriture_admin(self):
        from rest_framework.test import APIClient

        from accounts.models import User

        admin = User.objects.create_user(
            username="boss", password="x", phone="+22370000001", role="admin")
        agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")
        client = APIClient()
        client.force_authenticate(user=agent)
        r = client.get("/api/v1/company/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["name"], "BKO Quad")
        self.assertEqual(client.put("/api/v1/company/", {"phone": "+2231"}).status_code, 403)
        client.force_authenticate(user=admin)
        ok = client.put("/api/v1/company/", {"phone": "+22320201212", "nif": "ML-123"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data["phone"], "+22320201212")


class DocumentPdfTest(TestCase):
    def setUp(self):
        from datetime import timedelta

        from django.utils import timezone

        from accounts.models import User
        from catalogue.models import Activity, Site, Slot
        from clients.models import Customer

        site = Site.objects.create(name="Konibabougou", city="Bamako")
        act = Activity.objects.create(
            site=site, name="Quad 1H", duration_minutes=60,
            base_price=25000, deposit=0, max_group=10)
        start = timezone.now() + timedelta(days=1)
        self.slot = Slot.objects.create(
            activity=act, start=start, end=start + timedelta(hours=1), capacity=10)
        self.cust = Customer.objects.create(name="M. Traoré", phone="+22378803072")
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")

    def test_recu_et_facture_pdf(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.agent)
        b = client.post("/api/v1/bookings/", {
            "customer": self.cust.id, "slot": self.slot.id,
            "persons": 2, "quads": 1, "source": "phone"}).data
        r = client.get(f"/api/v1/documents/{b['id']}/recu/pdf/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertTrue(b"".join(r.streaming_content).startswith(b"%PDF"))
        # Facture : émission d'abord, sinon 400.
        self.assertEqual(
            client.get(f"/api/v1/documents/{b['id']}/facture/pdf/").status_code, 400)
        inv = client.post("/api/v1/payments/invoice/", {"booking": b["id"]})
        self.assertIn(inv.status_code, (200, 201))
        f = client.get(f"/api/v1/documents/{b['id']}/facture/pdf/")
        self.assertEqual(f.status_code, 200)
        self.assertTrue(b"".join(f.streaming_content).startswith(b"%PDF"))

    def test_recu_remise_et_duree(self):
        # Agent crée (30 000 brut), le moniteur applique 10 000 de remise :
        # net 20 000, reçu PDF avec sous-total/remise/net.
        from rest_framework.test import APIClient

        from accounts.models import User

        guide = User.objects.create_user(
            username="guide1", password="x", phone="+22370000008", role="guide")
        client = APIClient()
        client.force_authenticate(user=self.agent)
        r0 = client.post("/api/v1/bookings/", {
            "customer": self.cust.id, "slot": self.slot.id, "source": "phone",
            "lines": [{"persons": 2, "quads": 1}]}, format="json")
        self.assertEqual(r0.status_code, 201, r0.content[:300])
        b = r0.data
        client.force_authenticate(user=guide)
        self.assertEqual(client.post(f"/api/v1/bookings/{b['id']}/discount/",
                                     {"discount": 10000}).status_code, 400)  # sans motif
        d = client.post(f"/api/v1/bookings/{b['id']}/discount/",
                        {"discount": 10000, "reason": "Client fidèle, tarif moniteur"})
        self.assertEqual(d.status_code, 200, d.content[:300])
        self.assertEqual(d.data["total"], 20000)
        self.assertEqual(d.data["discount_total"], 10000)
        doc = client.get(f"/api/v1/documents/{b['id']}/recu/pdf/")
        self.assertEqual(doc.status_code, 200)
        self.assertTrue(b"".join(doc.streaming_content).startswith(b"%PDF"))

    def test_rapport_bancaire_pdf(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.agent)
        # Agent : documents OK (lecture), rapport bancaire refusé.
        self.assertEqual(client.get("/api/v1/bank/report/?year=2026&month=10").status_code, 403)
        from accounts.models import User

        admin = User.objects.create_user(
            username="boss", password="x", phone="+22370000001", role="admin")
        client.force_authenticate(user=admin)
        client.post("/api/v1/bank/deposit/", {
            "date": "2026-10-05", "reason": "Versement", "amount": 100000,
            "person_first_name": "Awa", "person_last_name": "Diallo",
            "receipt_number": "BV-1", "bank": "BIM"})
        r = client.get("/api/v1/bank/report/?year=2026&month=10&bank=BIM")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertTrue(b"".join(r.streaming_content).startswith(b"%PDF"))


class FacturationUnitesTest(TestCase):
    """H : le créneau fixe le nombre d'unités de formule facturées.

    Formule Quad 1H (60 min, 25 000 solo / 30 000 duo) sur un créneau
    de 2 h = 2 unités (50 000 solo) ; créneau de la durée de la formule
    = 1 unité, prix inchangé. Libellé unité sur reçu et facture (PDF)."""

    def setUp(self):
        from datetime import timedelta

        from accounts.models import User
        from catalogue.models import Activity, Site, Slot
        from clients.models import Customer

        site = Site.objects.create(name="Konibabougou", city="Bamako")
        self.act = Activity.objects.create(
            site=site, name="Quad 1H", duration_minutes=60,
            base_price=25000, deposit=0, max_group=10)
        start = timezone.now() + timedelta(days=1)
        self.slot2h = Slot.objects.create(
            activity=self.act, start=start, end=start + timedelta(hours=2), capacity=10)
        self.cust = Customer.objects.create(name="M. Traoré", phone="+22378803072")
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")

    def _create(self, slot, **extra):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.agent)
        return client.post("/api/v1/bookings/", {
            "customer": self.cust.id, "slot": slot.id, "source": "phone",
            **extra}, format="json")

    def test_creneau_une_unite_prix_inchange(self):
        from datetime import timedelta

        from catalogue.models import Slot

        start = timezone.now() + timedelta(days=1)
        s = Slot.objects.create(
            activity=self.act, start=start, end=start + timedelta(hours=1), capacity=10)
        r = self._create(s, persons=1, quads=1)
        self.assertEqual(r.status_code, 201, r.content[:300])
        self.assertEqual(r.data["units"], 1)
        self.assertEqual(r.data["total"], 25000)

    def test_creneau_deux_heures_deux_unites(self):
        r = self._create(self.slot2h, persons=1, quads=1)
        self.assertEqual(r.status_code, 201, r.content[:300])
        self.assertEqual(r.data["units"], 2)
        self.assertEqual(r.data["total"], 50000)

    def test_creneau_multijours_compte_en_unites(self):
        from datetime import timedelta

        from catalogue.models import Slot

        start = timezone.now() + timedelta(days=1)
        s = Slot.objects.create(
            activity=self.act, start=start, end=start + timedelta(hours=26), capacity=10)
        r = self._create(s, persons=1, quads=1)
        self.assertEqual(r.data["units"], 26)
        self.assertEqual(r.data["total"], 650000)

    def test_remise_apres_unites_et_pdf(self):
        r = self._create(self.slot2h, persons=1, quads=1)
        b = r.data
        from rest_framework.test import APIClient

        from accounts.models import User

        guide = User.objects.create_user(
            username="guide1", password="x", phone="+22370000008", role="guide")
        client = APIClient()
        client.force_authenticate(user=guide)
        d = client.post(f"/api/v1/bookings/{b['id']}/discount/",
                        {"discount": 10000, "reason": "Fidélité"}, format="json")
        self.assertEqual(d.status_code, 200, d.content[:300])
        self.assertEqual(d.data["total"], 40000)
        self.assertEqual(d.data["units"], 2)
        doc = client.get(f"/api/v1/documents/{b['id']}/recu/pdf/")
        self.assertEqual(doc.status_code, 200)
        self.assertTrue(b"".join(doc.streaming_content).startswith(b"%PDF"))


class VersionTest(TestCase):
    def test_version_fichier_unique_et_exposee(self):
        from django.conf import settings
        from rest_framework.test import APIClient

        from accounts.models import User

        self.assertRegex(settings.BKO_VERSION, r"^\d+\.\d+\.\d+")
        agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")
        client = APIClient()
        self.assertEqual(client.get("/api/v1/version/").status_code, 401)
        client.force_authenticate(user=agent)
        r = client.get("/api/v1/version/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["version"], settings.BKO_VERSION)


class SiteFiltrageTest(TestCase):
    """Agent, guide, responsables limites a leur site ; appels universels."""

    def setUp(self):
        from datetime import timedelta

        from django.utils import timezone

        from accounts.models import User
        from catalogue.models import Activity, Site, Slot, Vehicle

        self.site_a = Site.objects.create(name="Orpheus", city="Bamako")
        self.site_b = Site.objects.create(name="Konibabougou", city="Bamako")
        self.acts = {}
        self.slots = {}
        for s in (self.site_a, self.site_b):
            a = Activity.objects.create(
                site=s, name="Quad 1h", duration_minutes=60,
                base_price=25000, deposit=10000, max_group=10)
            start = timezone.now() + timedelta(days=1)
            self.slots[s.id] = Slot.objects.create(
                activity=a, start=start, end=start + timedelta(hours=1), capacity=10)
            self.acts[s.id] = a
            Vehicle.objects.create(site=s, type="quad", model="Grizzly",
                                   plate=f"Q-{s.id}")
        self.agent = User.objects.create_user(
            username="agentA", password="pw123456", phone="+22370000009",
            role="agent", site=self.site_a)
        self.resp = User.objects.create_user(
            username="respA", password="pw123456", phone="+22370000007",
            role="responsable", site=self.site_a)
        self.admin = User.objects.create_user(
            username="boss", password="pw123456", phone="+22370000001",
            role="admin")

    def _client(self, user):
        from rest_framework.test import APIClient

        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def _booking(self, site, code):
        import uuid

        from datetime import timedelta

        nonce = uuid.uuid4().hex[:6]

        from bookings.models import Booking
        from clients.models import Customer
        from django.utils import timezone

        c = Customer.objects.create(name=f"Client {site.name}",
                                    phone=f"+22377000{nonce}")
        return Booking.objects.create(
            code=code, customer=c, slot=self.slots[site.id],
            persons=1, unit_price=25000, total=25000, deposit_due=10000,
            qr_token=uuid.uuid4().hex,
            expires_at=timezone.now() + timedelta(minutes=20))

    def test_agent_ne_voit_que_son_site(self):
        from finance.models import CashbookEntry
        from payments.services import record_cash_payment

        b = self._booking(self.site_a, "BQ-ORPH-01")
        self._booking(self.site_b, "BQ-KONI-01")
        CashbookEntry.objects.create(
            date=timezone.localdate(), category="carburant",
            label="Carburant site A", direction=CashbookEntry.OUT,
            amount=5000, site=self.site_a)
        CashbookEntry.objects.create(
            date=timezone.localdate(), category="carburant",
            label="Carburant site B", direction=CashbookEntry.OUT,
            voucher=f"BSD-{self.site_b.id}",
            amount=9000, site=self.site_b)
        b.status = "confirmed"
        b.save(update_fields=["status"])
        record_cash_payment(booking_id=b.id, amount=25000,
                            nature="balance", received_by=self.admin)

        from rest_framework.test import APIClient

        agent = self._client(self.agent)
        self.assertEqual([s["name"] for s in agent.get("/api/v1/sites/").data], ["Orpheus"])
        self.assertEqual(len(agent.get("/api/v1/activities/").data), 1)
        self.assertEqual(
            {s["id"] for s in agent.get("/api/v1/slots/").data}, {self.slots[self.site_a.id].id})
        self.assertEqual(
            [v["plate"] for v in agent.get("/api/v1/vehicles/").data],
            [f"Q-{self.site_a.id}"])
        self.assertEqual(
            [b["code"] for b in agent.get("/api/v1/bookings/").data], ["BQ-ORPH-01"])
        self.assertEqual(len(agent.get("/api/v1/payments/").data), 1)
        # L'encaissement complet a deja emis la facture automatique.
        self.assertEqual([i["booking"] for i in agent.get("/api/v1/invoices/").data], [b.id])

        # Ecriture refusee sur l'autre site (agent).
        r = agent.post("/api/v1/bookings/", {
            "customer": 9999, "slot": self.slots[self.site_b.id].id, "persons": 1})
        self.assertEqual(r.status_code, 403)

        # Responsable : lecture filtree, ecriture ratachee a son site.
        resp = self._client(self.resp)
        self.assertEqual(
            [b["code"] for b in resp.get("/api/v1/bookings/").data], ["BQ-ORPH-01"])
        self.assertEqual([e["amount"] for e in resp.get("/api/v1/entries/").data], [5000])
        r = resp.post("/api/v1/finance/expense/", {
            "category": "carburant", "label": "X", "amount": 100,
            "site": self.site_b.id})
        self.assertEqual(r.status_code, 201)
        entry = CashbookEntry.objects.order_by("-id").first()
        self.assertEqual(entry.site_id, self.site_a.id)

    def test_admin_tout_voit_et_appels_universels(self):
        from telephony.models import CallLog

        self._booking(self.site_a, "BQ-ORPH-02")
        self._booking(self.site_b, "BQ-KONI-02")
        CallLog.objects.bulk_create([
            CallLog(direction="inbound", phone_number="+22376000001",
                    started_at=timezone.now(), duration_seconds=60,
                    external_id=f"E{i}")
            for i in range(2)
        ])
        from rest_framework.test import APIClient

        admin = self._client(self.admin)
        self.assertEqual(len(admin.get("/api/v1/sites/").data), 2)
        self.assertEqual(len(admin.get("/api/v1/bookings/").data), 2)
        self.assertEqual(len(admin.get("/api/v1/calls/").data), 2)
        # L'agent voit aussi tous les appels (journal universel).
        self.assertEqual(len(self._client(self.agent).get("/api/v1/calls/").data), 2)
