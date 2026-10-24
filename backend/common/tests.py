"""Tests socle tranche 1 : fuseau (B), compteur factures (G)."""

from django.conf import settings
from django.test import TestCase
from django.utils import timezone

from catalogue.testing import add_fleet
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
        add_fleet(site)
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
        add_fleet(site)
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
        # Facture : émise automatiquement à la création de la réservation.
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

    def test_recu_velo_libelle_et_prix(self):
        from datetime import timedelta

        from rest_framework.test import APIClient

        from catalogue.models import Activity, Site, Slot
        from common.pdf_docs import _booking_context, _order_rows

        site = Site.objects.create(name="Bamako Centre", city="Bamako")
        add_fleet(site)
        velo = Activity.objects.create(
            site=site, name="Vélo 1H", duration_minutes=60,
            base_price=5000, deposit=0, max_group=10)
        start = timezone.now() + timedelta(days=2)
        slot = Slot.objects.create(
            activity=velo, start=start, end=start + timedelta(hours=1), capacity=10)
        client = APIClient()
        client.force_authenticate(user=self.agent)
        r = client.post("/api/v1/bookings/", {
            "customer": self.cust.id, "slot": slot.id, "source": "phone",
            "lines": [{"persons": 2, "quads": 2}]}, format="json")
        self.assertEqual(r.status_code, 201, r.content[:300])
        self.assertEqual(r.data["resource_type"], "velo")
        rows, _, _, _ = _order_rows(_booking_context(r.data["id"]))
        text = " ".join(f"{left} {right}" for left, right in rows)
        self.assertIn("vélo", text)
        self.assertNotIn("Quads solo", text)

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
        add_fleet(site)
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
    """Agent, guide et responsables limites a leur site ; appels filtres par site."""

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
        entries = resp.get("/api/v1/entries/").data
        self.assertEqual({e["amount"] for e in entries}, {5000, 25000})
        self.assertEqual({e["site"] for e in entries}, {self.site_a.id})
        r = resp.post("/api/v1/finance/expense/", {
            "category": "carburant", "label": "X", "amount": 100,
            "site": self.site_b.id})
        self.assertEqual(r.status_code, 201)
        entry = CashbookEntry.objects.order_by("-id").first()
        self.assertEqual(entry.site_id, self.site_a.id)

    def test_admin_tout_voit_et_filtre_appels_par_site(self):
        from telephony.models import CallAnomaly, CallLog, TrackedLine

        self._booking(self.site_a, "BQ-ORPH-02")
        self._booking(self.site_b, "BQ-KONI-02")
        line_a = TrackedLine.objects.create(
            label="Ligne A", number="+22320200001", site=self.site_a)
        line_b = TrackedLine.objects.create(
            label="Ligne B", number="+22320200002", site=self.site_b)
        now = timezone.now()
        call_a = CallLog.objects.create(
            direction="inbound", phone_number="+22376000001", started_at=now,
            duration_seconds=60, external_id="E-A", line=line_a,
            site=self.site_a, imported_by=self.agent)
        call_b = CallLog.objects.create(
            direction="inbound", phone_number="+22376000002", started_at=now,
            duration_seconds=60, external_id="E-B", line=line_b,
            site=self.site_b, imported_by=self.admin)
        CallLog.objects.create(
            direction="inbound", phone_number="+22376000003", started_at=now,
            duration_seconds=60, external_id="E-NONE")
        CallAnomaly.objects.create(call=call_a)
        CallAnomaly.objects.create(call=call_b)

        admin = self._client(self.admin)
        agent = self._client(self.agent)
        resp = self._client(self.resp)
        self.assertEqual(len(admin.get("/api/v1/sites/").data), 2)
        self.assertEqual(len(admin.get("/api/v1/bookings/").data), 2)
        self.assertEqual(len(admin.get("/api/v1/calls/").data), 3)
        self.assertEqual(
            [x["id"] for x in admin.get(
                f"/api/v1/calls/?site={self.site_a.id}").data], [call_a.id])
        self.assertEqual(
            [x["id"] for x in admin.get(
                f"/api/v1/calls/?site={self.site_b.id}").data], [call_b.id])
        # L'agent est verrouille sur son site, même s'il demande l'autre site.
        self.assertEqual([x["id"] for x in agent.get("/api/v1/calls/").data], [call_a.id])
        self.assertEqual(
            [x["id"] for x in agent.get(
                f"/api/v1/calls/?site={self.site_b.id}").data], [call_a.id])
        self.assertEqual(
            [x["id"] for x in agent.get("/api/v1/lines/").data], [line_a.id])
        # Les anomalies suivent le site de l'appel.
        self.assertEqual(
            [x["call"] for x in resp.get("/api/v1/anomalies/").data], [call_a.id])
        self.assertEqual(len(admin.get("/api/v1/anomalies/").data), 2)
        self.assertEqual(
            [x["call"] for x in admin.get(
                f"/api/v1/anomalies/?site={self.site_b.id}").data], [call_b.id])

    def test_clients_filtres_par_site_ou_reservation(self):
        from datetime import timedelta

        from bookings.models import Booking
        from clients.models import Customer

        cust_a = Customer.objects.create(
            name="Client A", phone="+22376000101", site=self.site_a)
        cust_b = Customer.objects.create(
            name="Client B", phone="+22376000102", site=self.site_b)
        cust_booking = Customer.objects.create(
            name="Client passage", phone="+22376000103")
        Booking.objects.create(
            code="BQ-PASSAGE", customer=cust_booking,
            slot=self.slots[self.site_a.id], persons=1, quads=1,
            unit_price=25000, total=25000, deposit_due=10000,
            qr_token="qr-passage", expires_at=timezone.now() + timedelta(minutes=20))

        agent = self._client(self.agent)
        self.assertEqual(
            {c["id"] for c in agent.get("/api/v1/customers/").data},
            {cust_a.id, cust_booking.id})
        admin = self._client(self.admin)
        self.assertEqual(len(admin.get("/api/v1/customers/").data), 3)
        self.assertEqual(
            {c["id"] for c in admin.get(
                f"/api/v1/customers/?site={self.site_b.id}").data},
            {cust_b.id})

        r = agent.post("/api/v1/customers/", {
            "name": "Client A créé", "phone": "+22376000104",
            "site": self.site_b.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content[:300])
        self.assertEqual(r.data["site"], self.site_a.id)

    def test_client_idempotent_par_telephone_multi_site(self):
        from clients.models import Customer

        existing = Customer.objects.create(
            name="Client B", phone="+22376000102", whatsapp="+22376000102",
            site=self.site_b)
        agent = self._client(self.agent)
        r = agent.post("/api/v1/customers/", {
            "name": "Autre saisie", "phone": "+22376000102",
            "site": self.site_a.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content[:300])
        self.assertEqual(r.data["id"], existing.id)
        self.assertEqual(r.data["name"], "Client B")
        self.assertEqual(r.data["site"], self.site_b.id)
        existing.refresh_from_db()
        self.assertEqual(existing.name, "Client B")
        self.assertEqual(existing.whatsapp, "+22376000102")
        self.assertEqual(existing.site_id, self.site_b.id)
        self.assertEqual(Customer.objects.filter(phone="+22376000102").count(), 1)

    def test_booking_expose_site_et_nom_site(self):
        b = self._booking(self.site_a, "BQ-SITE-01")
        agent = self._client(self.agent)
        row = next(x for x in agent.get("/api/v1/bookings/").data if x["id"] == b.id)
        self.assertEqual(row["site"], self.site_a.id)
        self.assertEqual(row["site_name"], self.site_a.name)

    def test_disponibilite_flotte_par_creneau(self):
        self._booking(self.site_a, "BQ-DISPO-01")
        agent = self._client(self.agent)
        slot_a = self.slots[self.site_a.id]
        r = agent.get(f"/api/v1/bookings/availability/?slot={slot_a.id}")
        self.assertEqual(r.status_code, 200, r.content[:300])
        self.assertEqual(r.data["total"], 1)
        self.assertEqual(r.data["used"], 1)
        self.assertEqual(r.data["free"], 0)
        self.assertEqual(r.data["resource_type"], "quad")
        self.assertEqual(
            agent.get(f"/api/v1/bookings/availability/?slot="
                      f"{self.slots[self.site_b.id].id}").status_code, 403)
        # Le contexte ?site= d'un profil global ne permet pas un autre créneau.
        self.assertEqual(
            self._client(self.admin).get(
                f"/api/v1/bookings/availability/?site={self.site_b.id}"
                f"&slot={slot_a.id}").status_code, 403)

    def test_direction_comptable_filtrent_par_site(self):
        from accounts.models import User
        from finance.models import CashbookEntry
        from payments.services import record_cash_payment

        b_a = self._booking(self.site_a, "BQ-ORPH-10")
        b_b = self._booking(self.site_b, "BQ-KONI-10")
        for b in (b_a, b_b):
            b.status = "confirmed"
            b.save(update_fields=["status"])
            record_cash_payment(booking_id=b.id, amount=25000,
                                nature="balance", received_by=self.admin)
        CashbookEntry.objects.create(
            date=timezone.localdate(), category="carburant", voucher="FILTRE-A",
            label="Carburant A", direction=CashbookEntry.OUT,
            amount=1000, site=self.site_a)
        CashbookEntry.objects.create(
            date=timezone.localdate(), category="carburant", voucher="FILTRE-B",
            label="Carburant B", direction=CashbookEntry.OUT,
            amount=2000, site=self.site_b)

        comptable = User.objects.create_user(
            username="compta", password="pw123456", phone="+22370000002",
            role="comptable")
        admin = self._client(self.admin)
        compta = self._client(comptable)
        a, b = self.site_a.id, self.site_b.id

        for client in (admin, compta):
            self.assertEqual(
                [x["code"] for x in client.get(f"/api/v1/bookings/?site={a}").data],
                ["BQ-ORPH-10"])
            self.assertEqual(
                [x["code"] for x in client.get(f"/api/v1/bookings/?site={b}").data],
                ["BQ-KONI-10"])
            self.assertEqual(
                [x["booking"] for x in client.get(f"/api/v1/payments/?site={a}").data],
                [b_a.id])
            self.assertEqual(
                [x["booking"] for x in client.get(f"/api/v1/invoices/?site={b}").data],
                [b_b.id])
            self.assertEqual(
                {x["site"] for x in client.get(f"/api/v1/entries/?site={a}").data},
                {a})

        # Les recettes automatiques sont bien rattachées au site de la réservation.
        self.assertEqual(
            {x["site"] for x in admin.get(f"/api/v1/entries/?site={b}").data}, {b})

        summary = admin.get(f"/api/v1/finance/month/?site={a}").data
        self.assertEqual(summary["site"], a)
        self.assertEqual(summary["inn"], 25000)
        self.assertEqual(summary["out"], 1000)
        self.assertEqual(summary["balance"], 24000)

        # Un rôle de terrain ne contourne pas son site via ?site=.
        self.assertEqual(
            [x["code"] for x in self._client(self.agent).get(
                f"/api/v1/bookings/?site={b}").data],
            ["BQ-ORPH-10"])

        # Écriture manuelle d'un profil global : le site du corps est respecté.
        r = admin.post("/api/v1/finance/expense/", {
            "category": "carburant", "label": "Pleine B", "amount": 700,
            "site": b})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["site"], b)

        # Sans site dans le corps, le site du contexte (?site=) rattache.
        r = admin.post(f"/api/v1/finance/expense/?site={a}", {
            "category": "carburant", "label": "Pleine contexte", "amount": 800})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["site"], a)

    def test_banque_filtre_par_site_et_ecriture_rattachee(self):
        from finance.models import BankTransaction
        from finance.services import add_bank_transaction

        a, b = self.site_a.id, self.site_b.id
        for site, amount, ref in ((self.site_a, 5000, "BV-A"), (self.site_b, 9000, "BV-B")):
            add_bank_transaction(
                type=BankTransaction.DEPOSIT, day=timezone.localdate(),
                reason=f"Versement {site.name}", amount=amount,
                first_name="Client", last_name="Test", receipt_number=ref,
                bank="BIM", site=site, created_by=self.admin)

        admin = self._client(self.admin)
        self.assertEqual(
            {x["site"] for x in admin.get(f"/api/v1/bank-transactions/?site={a}").data},
            {a})
        month = timezone.localdate()
        summary = admin.get(
            f"/api/v1/bank/summary/?year={month.year}&month={month.month}&site={a}").data
        self.assertEqual(summary["site"], a)
        self.assertEqual({x["site"] for x in summary["rows"]}, {a})
        self.assertEqual(summary["deposits"], 5000)
        self.assertEqual(summary["site_balance"], 5000)
        self.assertEqual(summary["balance"], 14000)

        # Le responsable du site A reste verrouillé sur A, même en écrivant.
        resp = self._client(self.resp)
        self.assertEqual(
            {x["site"] for x in resp.get(
                f"/api/v1/bank-transactions/?site={b}").data},
            {a})
        r = resp.post("/api/v1/bank/deposit/", {
            "reason": "Versement A", "amount": 1000, "bank": "BIM",
            "person_first_name": "Client", "person_last_name": "A",
            "receipt_number": "BV-RA", "site": b})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["site"], a)

        # Profil global : le site du contexte (?site=) rattache l'écriture.
        r = admin.post(f"/api/v1/bank/deposit/?site={b}", {
            "reason": "Versement B", "amount": 2000, "bank": "BIM",
            "person_first_name": "Client", "person_last_name": "B",
            "receipt_number": "BV-CONTEXTE"})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["site"], b)
