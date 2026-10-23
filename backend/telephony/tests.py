"""Tests journal + rapprochement + clôture."""

from contextlib import contextmanager
from datetime import datetime, timedelta
from unittest.mock import patch

from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings.services import create_booking
from catalogue.models import Activity, Site, Slot
from clients.models import Customer
from telephony.models import CallLog, DailyClosing, TrackedLine, TrackedLine
from telephony.services import (
    TelephonyError,
    daily_closing,
    normalize_phone,
    reconcile_call,
    resolve_anomaly,
)
from telephony.tasks import close_day


@contextmanager
def at(hour, minute=0):
    """Fixe l'heure locale lue par la tâche de clôture (fuseau B)."""
    day = timezone.localdate()
    fixed = timezone.make_aware(datetime(day.year, day.month, day.day, hour, minute))
    with patch("telephony.tasks.timezone.localtime", return_value=fixed):
        yield


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


class TrackedLineTest(TestCase):
    def test_lignes_lecture_agent_gestion_responsable(self):
        from rest_framework.test import APIClient

        agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")
        resp = User.objects.create_user(
            username="resp1", password="x", phone="+22370000002", role="responsable")
        client = APIClient()
        client.force_authenticate(user=resp)
        r = client.post("/api/v1/lines/", {"label": "Ligne Business", "number": "+22320201212"})
        self.assertEqual(r.status_code, 201)
        client.force_authenticate(user=agent)
        self.assertEqual(client.get("/api/v1/lines/").status_code, 200)
        self.assertEqual(client.post("/api/v1/lines/", {"label": "X", "number": "+2231"}).status_code, 403)
        self.assertEqual(TrackedLine.objects.filter(active=True).count(), 1)


class ImportCallsTest(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        self.site_ml = Site.objects.create(name="Bamako", city="Bamako")
        self.site_ci = Site.objects.create(name="Abidjan", city="Abidjan")
        self.line_ml = TrackedLine.objects.create(
            label="Ligne Business ML", number="+22320201212", site=self.site_ml)
        self.line_ci = TrackedLine.objects.create(
            label="Ligne Business CI", number="+2252720121212", site=self.site_ci)
        self.agent = User.objects.create_user(
            username="collecteur", password="x", phone="+22370000009", role="agent")
        self.client = APIClient()
        self.client.force_authenticate(user=self.agent)

    def _payload(self, line, phone, ext):
        return {"line_id": line.id, "calls": [{
            "direction": "inbound", "phone_number": phone,
            "started_at": timezone.now().isoformat(),
            "duration_seconds": 60, "external_id": ext}]}

    def test_normalize_ml_et_ci(self):
        self.assertEqual(normalize_phone("78803072"), "+22378803072")
        self.assertEqual(normalize_phone("0709090808"), "+2250709090808")
        self.assertEqual(normalize_phone("+2250709090808"), "+2250709090808")

    def test_import_idempotent_et_last_sync(self):
        r = self.client.post("/api/v1/calls/import/", self._payload(self.line_ml, "78803072", "ml-1"),
                             format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["created"], 1)
        r2 = self.client.post("/api/v1/calls/import/", self._payload(self.line_ml, "78803072", "ml-1"),
                              format="json")
        self.assertEqual(r2.data["created"], 0)
        self.assertEqual(r2.data["skipped"], 1)
        self.line_ml.refresh_from_db()
        self.assertIsNotNone(self.line_ml.last_sync)
        self.assertEqual(CallLog.objects.filter(external_id="ml-1").count(), 1)
        self.assertEqual(CallLog.objects.get(external_id="ml-1").phone_number, "+22378803072")

    def test_import_ci_normalise_225(self):
        r = self.client.post("/api/v1/calls/import/", self._payload(self.line_ci, "0709090808", "ci-1"),
                             format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(CallLog.objects.get(external_id="ci-1").phone_number, "+2250709090808")

    def test_duree_definitive_ecrase_le_zero(self):
        now = timezone.now().isoformat()
        first = {"line_id": self.line_ml.id, "calls": [{
            "direction": "inbound", "phone_number": "78803072",
            "started_at": now, "duration_seconds": 0, "external_id": "ml-dur"}]}
        r1 = self.client.post("/api/v1/calls/import/", first, format="json")
        self.assertEqual(r1.data["created"], 1)
        second = {"line_id": self.line_ml.id, "calls": [{
            "direction": "inbound", "phone_number": "78803072",
            "started_at": now, "duration_seconds": 95, "external_id": "ml-dur"}]}
        r2 = self.client.post("/api/v1/calls/import/", second, format="json")
        self.assertEqual(r2.data["updated"], 1)
        self.assertEqual(CallLog.objects.get(external_id="ml-dur").duration_seconds, 95)

    def test_coupe_circuit_collecte(self):
        self.line_ml.collect_enabled = False
        self.line_ml.save(update_fields=["collect_enabled"])
        r = self.client.post("/api/v1/calls/import/", self._payload(self.line_ml, "78803072", "ml-off"),
                             format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(CallLog.objects.filter(external_id="ml-off").count(), 0)
        self.line_ml.collect_enabled = True
        self.line_ml.save(update_fields=["collect_enabled"])
        r2 = self.client.post("/api/v1/calls/import/", self._payload(self.line_ml, "78803072", "ml-off"),
                              format="json")
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r2.data["created"], 1)

    def test_import_lot_trop_grand_et_ligne_requise(self):
        big = {"line_id": self.line_ml.id, "calls": [
            {"direction": "inbound", "phone_number": "+22370000001",
             "started_at": timezone.now().isoformat(), "external_id": f"x-{i}"}
            for i in range(501)]}
        self.assertEqual(self.client.post("/api/v1/calls/import/", big, format="json").status_code, 400)
        bad = self._payload(self.line_ml, "78803072", "ml-2")
        bad.pop("line_id")
        self.assertEqual(self.client.post("/api/v1/calls/import/", bad, format="json").status_code, 400)


class ClotureAutomatiqueTest(TestCase):
    """Décision I : le Hub clôt tout seul à 20h00, l'écran est consultatif."""

    def test_avant_20h_la_journee_reste_ouverte(self):
        today = timezone.localdate()
        with at(19, 59):
            closed = close_day()
        self.assertNotIn(today.isoformat(), closed)
        self.assertFalse(DailyClosing.objects.filter(date=today).exists())

    def test_des_20h_la_journee_est_cloturee_sans_intervention(self):
        today = timezone.localdate()
        with at(20, 0):
            closed = close_day()
        self.assertIn(today.isoformat(), closed)
        closing = DailyClosing.objects.get(date=today)
        self.assertIsNone(closing.validated_by)

    def test_rattrape_les_jours_non_clotures(self):
        missed = timezone.localdate() - timedelta(days=2)
        with at(12, 0):
            closed = close_day()
        self.assertIn(missed.isoformat(), closed)
        self.assertTrue(DailyClosing.objects.filter(date=missed).exists())

    def test_reexecution_ne_recrase_ni_ne_duplique(self):
        today = timezone.localdate()
        with at(20, 0):
            close_day()
        first = DailyClosing.objects.get(date=today)
        with at(21, 0):
            second = close_day()
        self.assertEqual(second, [])
        self.assertEqual(DailyClosing.objects.filter(date=today).count(), 1)
        first.refresh_from_db()
        self.assertEqual(first.bookings_count, 0)
        self.assertIsNotNone(first.validated_at)

    def test_ecran_consultatif_lecture_seule(self):
        from rest_framework.test import APIClient

        agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")
        guide = User.objects.create_user(
            username="guide1", password="x", phone="+22370000008", role="guide")
        today = timezone.localdate().isoformat()
        client = APIClient()
        client.force_authenticate(user=agent)

        r = client.get(f"/api/v1/closings/?date={today}")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["closed"])
        self.assertEqual(r.data["closing_hour"], 20)
        self.assertIsNone(r.data["closing"])

        daily_closing(timezone.localdate())
        r = client.get(f"/api/v1/closings/?date={today}")
        self.assertTrue(r.data["closed"])
        self.assertIsNotNone(r.data["closing"])
        self.assertIn("validated_at", r.data["closing"])

        self.assertEqual(client.post("/api/v1/closings/", {}, format="json").status_code, 405)
        self.assertEqual(client.get("/api/v1/closings/?date=xx").status_code, 400)
        client.force_authenticate(user=guide)
        self.assertEqual(client.get("/api/v1/closings/").status_code, 403)

    def test_repli_consultation_apres_20h_cloture_quand_meme(self):
        """Worker/beat indisponible : la consultation rattrape la clôture (système)."""
        from rest_framework.test import APIClient

        agent = User.objects.create_user(
            username="agent2", password="x", phone="+22370000007", role="agent")
        client = APIClient()
        client.force_authenticate(user=agent)
        today = timezone.localdate().isoformat()

        with at(19, 30):
            self.assertFalse(client.get(f"/api/v1/closings/?date={today}").data["closed"])
        with at(20, 5):
            self.assertTrue(client.get(f"/api/v1/closings/?date={today}").data["closed"])
        self.assertTrue(DailyClosing.objects.filter(date=timezone.localdate()).exists())


class CloturePlanificationTest(TestCase):
    """La tâche planifiée doit viser la vraie tâche Celery, à 20h Bamako."""

    def test_beat_20h_et_rattrapage(self):
        from django.conf import settings

        from telephony.tasks import close_day

        self.assertEqual(close_day.name, "telephony.close_day")
        schedule = settings.CELERY_BEAT_SCHEDULE
        self.assertEqual(schedule["cloture-journee-20h"]["task"], close_day.name)
        self.assertEqual(
            set(schedule["cloture-journee-20h"]["schedule"].hour),
            {settings.BKO_CLOSING_HOUR})
        self.assertEqual(
            set(schedule["cloture-journee-20h"]["schedule"].minute), {0})
        rattrapage = schedule["cloture-rattrapage"]
        self.assertEqual(rattrapage["task"], close_day.name)
        self.assertEqual(set(rattrapage["schedule"].minute), {15})
        self.assertEqual(set(rattrapage["schedule"].hour), {0, 3, 6, 9, 12, 15, 18, 21})
