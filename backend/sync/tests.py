"""J : idempotence des écritures rejouées + traçabilité des saisies hors ligne."""

import json
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from bookings.models import Booking, BookingEvent
from catalogue.models import Activity, Site, Slot
from catalogue.testing import add_fleet
from clients.models import Customer
from payments.models import Payment
from sync.models import IdempotencyKey


def data(response):
    """Le rejeu d'idempotence renvoie un JsonResponse : on lit le corps."""
    return json.loads(response.content.decode("utf-8"))


class OfflineSyncTest(TestCase):
    def setUp(self):
        self.site = Site.objects.create(name="Bamako", city="Bamako")
        self.activity = Activity.objects.create(
            site=self.site, name="Quad 1h", duration_minutes=60,
            base_price=20000, deposit=10000, max_group=10,
        )
        add_fleet(self.site, quads=5)
        start = timezone.now() + timedelta(days=1)
        self.slot = Slot.objects.create(
            activity=self.activity, start=start, end=start + timedelta(hours=1), capacity=10)
        self.customer = Customer.objects.create(name="M. Traoré", phone="+22378803072")
        self.customer2 = Customer.objects.create(name="Mme Keïta", phone="+22378803073")
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")
        self.client = APIClient()
        self.client.force_authenticate(user=self.agent)

    def payload(self, customer=None, customer_id=None, **over):
        data_in = {"customer": customer_id if customer_id is not None else (customer or self.customer).id,
                   "slot": self.slot.id, "persons": 1, "quads": 1, "source": "onsite"}
        data_in.update(over)
        return data_in

    def test_rejeu_meme_cle_une_seule_reservation(self):
        headers = {"HTTP_IDEMPOTENCY_KEY": "uuid-terrain-1"}
        r1 = self.client.post("/api/v1/bookings/", self.payload(), format="json", **headers)
        self.assertEqual(r1.status_code, 201, r1.content[:200])
        r2 = self.client.post("/api/v1/bookings/", self.payload(), format="json", **headers)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(data(r1)["id"], data(r2)["id"])
        self.assertEqual(r2["X-Idempotent-Replay"], "1")
        self.assertEqual(Booking.objects.count(), 1)

    def test_meme_cle_corps_different_refuse(self):
        headers = {"HTTP_IDEMPOTENCY_KEY": "uuid-terrain-2"}
        self.client.post("/api/v1/bookings/", self.payload(), format="json", **headers)
        r = self.client.post("/api/v1/bookings/", self.payload(persons=3), format="json", **headers)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(Booking.objects.count(), 1)

    def test_echec_metier_libere_la_cle(self):
        headers = {"HTTP_IDEMPOTENCY_KEY": "uuid-terrain-3"}
        r1 = self.client.post("/api/v1/bookings/", self.payload(persons=0), format="json", **headers)
        self.assertEqual(r1.status_code, 400)
        r2 = self.client.post("/api/v1/bookings/", self.payload(), format="json", **headers)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(Booking.objects.count(), 1)

    def test_sans_cle_comportement_normal(self):
        self.client.post("/api/v1/bookings/", self.payload(), format="json")
        self.client.post("/api/v1/bookings/", self.payload(customer=self.customer2), format="json")
        self.assertEqual(Booking.objects.count(), 2)

    def test_saisie_hors_ligne_tracee(self):
        from urllib.parse import quote

        headers = {
            "HTTP_IDEMPOTENCY_KEY": "uuid-terrain-4",
            "HTTP_X_OFFLINE_AT": "2026-10-19T14:30:00Z",
            "HTTP_X_OFFLINE_LABEL": quote("Réservation BKO-261019-ABCD"),
        }
        r = self.client.post(
            "/api/v1/bookings/",
            self.payload(code="BKO-261019-ABCD", offline_at="2026-10-19T14:30:00Z",
                         offline_ref="uuid-terrain-4"),
            format="json", **headers)
        self.assertEqual(r.status_code, 201, r.content[:200])
        booking = Booking.objects.get(pk=data(r)["id"])
        self.assertEqual(booking.code, "BKO-261019-ABCD")
        self.assertIsNotNone(booking.offline_at)
        self.assertEqual(booking.offline_ref, "uuid-terrain-4")
        event = BookingEvent.objects.filter(booking=booking, action="created").first()
        self.assertIsNotNone(event)
        self.assertIsNotNone(event.after["offline_at"])
        key = IdempotencyKey.objects.filter(key="uuid-terrain-4").first()
        self.assertIsNotNone(key)
        self.assertEqual(key.actor, self.agent)
        self.assertEqual(key.label, "Réservation BKO-261019-ABCD")
        self.assertIsNotNone(key.offline_at)
        self.assertIsNotNone(key.synced_at)

    def test_code_propose_pragmaire_puis_regenere(self):
        headers = {"HTTP_IDEMPOTENCY_KEY": "uuid-terrain-5"}
        self.client.post("/api/v1/bookings/", self.payload(code="BKO-261019-XXXX"),
                         format="json", **headers)
        r = self.client.post("/api/v1/bookings/", self.payload(customer=self.customer2, code="BKO-261019-XXXX"),
                             format="json",
                             **{"HTTP_IDEMPOTENCY_KEY": "uuid-terrain-6"})
        self.assertEqual(r.status_code, 201, r.content[:200])
        self.assertNotEqual(data(r)["code"], "BKO-261019-XXXX")
        self.assertTrue(data(r)["code"].startswith("BKO-"))

    def test_rejeu_client_puis_reservation(self):
        """Séquence de terrain : le client est créé puis la réservation le vise."""
        r = self.client.post("/api/v1/customers/", {"name": "M. Bamba", "phone": "+22370000111"},
                             format="json", **{"HTTP_IDEMPOTENCY_KEY": "uuid-client-1"})
        self.assertEqual(r.status_code, 201, r.content[:200])
        customer_id = data(r)["id"]
        r2 = self.client.post("/api/v1/bookings/", self.payload(customer_id=customer_id),
                              format="json", **{"HTTP_IDEMPOTENCY_KEY": "uuid-booking-1"})
        self.assertEqual(r2.status_code, 201, r2.content[:200])
        booking = Booking.objects.get(pk=data(r2)["id"])
        self.assertEqual(booking.customer_id, customer_id)

    def test_rejeu_encaissement_apres_reservation_hors_ligne(self):
        """Réservation hors ligne rejouée, puis encaissement rejoué : confirmée."""
        r = self.client.post("/api/v1/bookings/", self.payload(code="BKO-261019-CASH"),
                             format="json", **{"HTTP_IDEMPOTENCY_KEY": "uuid-booking-2"})
        self.assertEqual(r.status_code, 201, r.content[:200])
        booking = Booking.objects.get(pk=data(r)["id"])
        self.assertEqual(booking.status, Booking.PENDING_DEPOSIT)
        r2 = self.client.post("/api/v1/payments/cash/",
                              {"booking": booking.id, "amount": booking.total, "nature": "deposit"},
                              format="json", **{"HTTP_IDEMPOTENCY_KEY": "uuid-cash-1"})
        self.assertEqual(r2.status_code, 200, r2.content[:200])
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.CONFIRMED)
        self.assertEqual(Payment.objects.filter(booking=booking, status="paid").count(), 1)

    def test_rejeu_encaissement_deux_fois_ne_double_pas(self):
        """Le rejeu du même encaissement ne crée pas un second versement."""
        booking = Booking.objects.create(
            code="BKO-261019-DUP", customer=self.customer, slot=self.slot,
            persons=1, quads=1, unit_price=20000, total=20000, deposit_due=10000,
            status=Booking.PENDING_DEPOSIT, source="onsite", created_by=self.agent,
            expires_at=timezone.now() + timedelta(hours=4), qr_token="tok-dup-1")
        headers = {"HTTP_IDEMPOTENCY_KEY": "uuid-cash-dup"}
        payload = {"booking": booking.id, "amount": 20000, "nature": "deposit"}
        r1 = self.client.post("/api/v1/payments/cash/", payload, format="json", **headers)
        self.assertEqual(r1.status_code, 200, r1.content[:200])
        r2 = self.client.post("/api/v1/payments/cash/", payload, format="json", **headers)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(data(r1)["reference"], data(r2)["reference"])
        self.assertEqual(Payment.objects.filter(booking=booking).count(), 1)
