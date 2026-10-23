"""Tests tranche 5 : gabarit FR, lien wa.me, journal."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings.services import create_booking
from catalogue.models import Activity, Site, Slot
from catalogue.testing import add_fleet
from clients.models import Customer
from comms.services import booking_payment_text, log_whatsapp, wa_me_link


class CommsTest(TestCase):
    def setUp(self):
        site = Site.objects.create(name="Bamako", city="Bamako")
        act = Activity.objects.create(
            site=site, name="Quad 1h", duration_minutes=60,
            base_price=20000, deposit=10000, max_group=10,
        )
        add_fleet(site, quads=5)
        start = timezone.now() + timedelta(days=1)
        self.slot = Slot.objects.create(
            activity=act, start=start, end=start + timedelta(hours=1), capacity=10)
        self.cust = Customer.objects.create(name="M. Traoré", phone="+22378803072")
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")
        self.booking = create_booking(
            customer=self.cust, slot_id=self.slot.id, persons=2, source="whatsapp", created_by=self.agent)

    def test_gabarit_fr_vouvoiement(self):
        text = booking_payment_text(booking=self.booking, pay_reference="STUB-X")
        self.assertIn(self.booking.code, text)
        self.assertIn("FCFA", text)
        self.assertIn("BKO Quad", text)

    def test_wa_me_lien(self):
        link = wa_me_link("+223 78 80 30 72", "Bonjour")
        self.assertTrue(link.startswith("https://wa.me/22378803072?text="))

    def test_journal_envoi(self):
        m = log_whatsapp(booking=self.booking, text="Bonjour", sent_by=self.agent)
        self.assertEqual(m.channel, "whatsapp_link")
        self.assertEqual(self.booking.messages.count(), 1)

    def test_lien_utilise_le_whatsapp_du_client(self):
        from rest_framework.test import APIClient

        self.cust.whatsapp = "+223 70 00 00 01"
        self.cust.save()
        client = APIClient()
        client.force_authenticate(user=self.agent)
        r = client.post("/api/v1/messages/", {
            "booking": self.booking.id, "text": "Bonjour"})
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data["wa_me"].startswith(
            "https://wa.me/22370000001?text="))

    def test_lien_replie_sur_le_telephone(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.agent)
        r = client.post("/api/v1/messages/", {
            "booking": self.booking.id, "text": "Bonjour"})
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data["wa_me"].startswith(
            "https://wa.me/22378803072?text="))


class NoticeTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="boss", password="x", phone="+22370000001", role="admin")
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")

    def test_rediger_publier_lire(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.admin)
        r = client.post("/api/v1/notices/", {
            "type": "communique", "title": "Fermeture lundi",
            "content": "<p>Fermé lundi.</p>",
        })
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["status"], "draft")
        p = client.post(f"/api/v1/notices/{r.data['id']}/publish/")
        self.assertEqual(p.status_code, 200)
        self.assertEqual(p.data["status"], "published")
        self.assertIsNotNone(p.data["published_at"])
        client.force_authenticate(user=self.agent)
        self.assertEqual(client.get("/api/v1/notices/").status_code, 200)
        self.assertEqual(client.post("/api/v1/notices/", {
            "type": "lettre", "title": "X", "content": "Y"}).status_code, 403)

    def test_notices_filtrees_par_site_et_reseau(self):
        from rest_framework.test import APIClient

        site_a = Site.objects.create(name="Site A", city="Bamako")
        site_b = Site.objects.create(name="Site B", city="Bamako")
        agent_a = User.objects.create_user(
            username="agentA", password="x", phone="+22370000011",
            role="agent", site=site_a)
        client = APIClient()
        client.force_authenticate(user=self.admin)
        notice_a = client.post(f"/api/v1/notices/?site={site_a.id}", {
            "type": "communique", "title": "Site A",
            "content": "<p>A</p>"})
        notice_b = client.post(f"/api/v1/notices/?site={site_b.id}", {
            "type": "communique", "title": "Site B",
            "content": "<p>B</p>"})
        network = client.post("/api/v1/notices/", {
            "type": "communique", "title": "Reseau",
            "content": "<p>Reseau</p>"})
        self.assertEqual(notice_a.status_code, 201, notice_a.content[:300])
        self.assertEqual(notice_a.data["site"], site_a.id)
        self.assertEqual(notice_a.data["site_name"], site_a.name)
        self.assertIsNone(network.data["site"])

        reader = APIClient()
        reader.force_authenticate(user=agent_a)
        self.assertEqual(
            {n["id"] for n in reader.get("/api/v1/notices/").data},
            {notice_a.data["id"], network.data["id"]})
        self.assertEqual(
            {n["id"] for n in client.get(
                f"/api/v1/notices/?site={site_b.id}").data},
            {notice_b.data["id"], network.data["id"]})

        manager = User.objects.create_user(
            username="respA", password="x", phone="+22370000012",
            role="responsable", site=site_a)
        writer = APIClient()
        writer.force_authenticate(user=manager)
        patched = writer.patch(f"/api/v1/notices/{network.data['id']}/", {
            "content": "<p>Reseau corrige</p>"})
        self.assertEqual(patched.status_code, 200, patched.content[:300])
        self.assertIsNone(patched.data["site"])
