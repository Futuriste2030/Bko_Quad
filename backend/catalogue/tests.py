"""Tests flotte : états, maintenance, affectation aux créneaux."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from catalogue.models import Activity, Maintenance, Site, Slot, SparePart, Vehicle
from finance.models import CashbookEntry
from finance.services import add_entry


def make_admin():
    return User.objects.create_user(
        username="boss", password="x", phone="+22370000001", role="admin")


def make_site_slot():
    site = Site.objects.create(name="Konibabougou", city="Bamako")
    act = Activity.objects.create(
        site=site, name="Quad 1h", duration_minutes=60,
        base_price=25000, deposit=10000, max_group=10)
    start = timezone.now() + timedelta(days=1)
    slot = Slot.objects.create(activity=act, start=start, end=start + timedelta(hours=1), capacity=6)
    return site, slot


class FleetTest(TestCase):
    def test_maintenance_change_etat_et_poste_depense(self):
        admin = make_admin()
        site, _ = make_site_slot()
        add_entry(day=timezone.localdate(), category="autre", label="Fonds",
                  direction="in", amount=50000, created_by=admin)
        v = Vehicle.objects.create(site=site, type="quad", model="Grizzly", plate="Q-001")
        client = APIClient()
        client.force_authenticate(user=admin)
        r = client.post("/api/v1/maintenances/", {
            "vehicle": v.id, "kind": "reparation", "date": timezone.localdate().isoformat(),
            "cost": 15000, "new_status": "hors_service", "notes": "embrayage",
        })
        self.assertEqual(r.status_code, 201)
        v.refresh_from_db()
        self.assertEqual(v.status, "hors_service")
        entry = CashbookEntry.objects.filter(direction="out").first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.amount, 15000)

    def test_hors_service_refuse_sur_creneau(self):
        admin = make_admin()
        site, slot = make_site_slot()
        v = Vehicle.objects.create(site=site, type="quad", model="Grizzly", plate="Q-002", status="hors_service")
        client = APIClient()
        client.force_authenticate(user=admin)
        r = client.patch(f"/api/v1/slots/{slot.id}/", {"vehicles": [v.id]}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_site_different_refuse(self):
        admin = make_admin()
        _, slot = make_site_slot()
        other = Site.objects.create(name="Ailleurs", city="Bamako")
        v = Vehicle.objects.create(site=other, type="quad", model="X", plate="Q-003")
        client = APIClient()
        client.force_authenticate(user=admin)
        r = client.patch(f"/api/v1/slots/{slot.id}/", {"vehicles": [v.id]}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_affectation_ok(self):
        admin = make_admin()
        site, slot = make_site_slot()
        v = Vehicle.objects.create(site=site, type="quad", model="Grizzly", plate="Q-004")
        client = APIClient()
        client.force_authenticate(user=admin)
        r = client.patch(f"/api/v1/slots/{slot.id}/", {"vehicles": [v.id]}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn(v.id, r.data["vehicles"])
        self.assertEqual(Maintenance.objects.count(), 0)

    def test_vidange_quantite_huile_et_pneus_quantite(self):
        admin = make_admin()
        site, _ = make_site_slot()
        add_entry(day=timezone.localdate(), category="autre", label="Fonds",
                  direction="in", amount=100000, created_by=admin)
        v = Vehicle.objects.create(site=site, type="quad", model="Grizzly", plate="Q-020")
        client = APIClient()
        client.force_authenticate(user=admin)
        r = client.post("/api/v1/maintenances/", {
            "vehicle": v.id, "kind": "vidange", "date": timezone.localdate().isoformat(),
            "cost": 8000, "oil_liters": "1.5", "notes": "10W40",
        })
        self.assertEqual(r.status_code, 201)
        self.assertEqual(str(r.data["oil_liters"]), "1.50")
        r2 = client.post("/api/v1/maintenances/", {
            "vehicle": v.id, "kind": "pneus", "date": timezone.localdate().isoformat(),
            "cost": 40000, "quantity": 2, "notes": "avant + arrière",
        })
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r2.data["quantity"], 2)

    def test_agent_cree_creneau_guide_refuse(self):
        site, slot = make_site_slot()
        agent = User.objects.create_user(
            username="agent9", password="x", phone="+22370000019", role="agent")
        guide = User.objects.create_user(
            username="guide9", password="x", phone="+22370000018", role="guide")
        start = timezone.now() + timedelta(days=2)
        payload = {"activity": slot.activity_id,
                   "start": start.isoformat(),
                   "end": (start + timedelta(hours=1)).isoformat(),
                   "capacity": 8}
        client = APIClient()
        client.force_authenticate(user=agent)
        r = client.post("/api/v1/slots/", payload, format="json")
        self.assertEqual(r.status_code, 201)
        client.force_authenticate(user=guide)
        r2 = client.post("/api/v1/slots/", payload, format="json")
        self.assertEqual(r2.status_code, 403)

    def test_creation_vehicule_statut_defaut(self):
        admin = make_admin()
        site, _ = make_site_slot()
        client = APIClient()
        client.force_authenticate(user=admin)
        r = client.post("/api/v1/vehicles/", {
            "site": site.id, "type": "quad", "model": "Grizzly", "plate": "Q-010",
        })
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["status"], "en_service")

    def test_photo_vehicule_convertie_en_webp(self):
        """Photo de flotte : convertie en WebP côté serveur (taille réduite)."""
        import io

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (900, 600), color=(200, 80, 10)).save(buf, format="PNG")
        png = SimpleUploadedFile("quad.png", buf.getvalue(), content_type="image/png")
        admin = make_admin()
        site, _ = make_site_slot()
        client = APIClient(enforce_csrf_checks=False)
        client.force_authenticate(user=admin)
        r = client.post("/api/v1/vehicles/", {
            "site": site.id, "type": "quad", "model": "Grizzly", "plate": "Q-012",
            "photo": png,
        }, format="multipart")
        self.assertEqual(r.status_code, 201, r.content[:300])
        v = Vehicle.objects.get(plate="Q-012")
        self.assertTrue(str(v.photo.name).endswith(".webp"))
        with v.photo.open("rb") as f:
            head = f.read(16)
        self.assertEqual(head[:4], b"RIFF")
        self.assertIn(b"WEBP", head)

    def test_suppression_sans_historique_possible(self):
        from catalogue.models import Vehicle

        admin = make_admin()
        site, _ = make_site_slot()
        v = Vehicle.objects.create(site=site, type="quad", model="X", plate="Q-011")
        client = APIClient()
        client.force_authenticate(user=admin)
        self.assertEqual(client.delete(f"/api/v1/vehicles/{v.id}/").status_code, 204)
        self.assertEqual(Vehicle.objects.filter(pk=v.id).count(), 0)

    def test_creneau_libre_supprimable_pas_creneau_reserve(self):
        """Suppression de créneau : possible s'il est vierge, refusée s'il est déjà réservé."""
        import uuid

        from bookings.models import Booking
        from clients.models import Customer

        admin = make_admin()
        _site_sun, slot_vierge = make_site_slot()
        site = Site.objects.get(name="Konibabougou")
        start = timezone.now() + timedelta(days=2)
        slot_reserve = Slot.objects.create(
            activity=slot_vierge.activity, start=start,
            end=start + timedelta(hours=1), capacity=6)
        cust = Customer.objects.create(name="Awa Dicko", phone="+22378803099")
        Booking.objects.create(
            code=f"BQ-{uuid.uuid4().hex[:8].upper()}", customer=cust, slot=slot_reserve,
            persons=1, unit_price=25000, total=25000, deposit_due=10000,
            expires_at=start + timedelta(minutes=30), qr_token=uuid.uuid4().hex,)
        client = APIClient()
        client.force_authenticate(user=admin)
        r = client.delete(f"/api/v1/slots/{slot_reserve.id}/")
        self.assertEqual(r.status_code, 400, getattr(r, 'data', None))
        self.assertIn("a des réservations en cours", str(r.data["detail"]))
        self.assertTrue(Slot.objects.filter(pk=slot_reserve.id).exists())
        self.assertEqual(client.delete(f"/api/v1/slots/{slot_vierge.id}/").status_code, 204)
        self.assertFalse(Slot.objects.filter(pk=slot_vierge.id).exists())


class SparePartTest(TestCase):
    """Stock de pièces : achat tracé, consommation par maintenance, rôles."""

    def setUp(self):
        self.admin = make_admin()
        self.site, _ = make_site_slot()
        self.vehicle = Vehicle.objects.create(
            site=self.site, type="quad", model="Grizzly", plate="Q-030")
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def create_part(self, serial="SN-001", **overrides):
        payload = {
            "site": self.site.id, "name": "Kit embrayage", "serial_number": serial,
            "color": "noir", "reason": "Achat pour réparation",
            "bought_on": timezone.localdate().isoformat(),
        }
        payload.update(overrides)
        return self.client.post("/api/v1/parts/", payload, format="json")

    def maintenance_piece(self, serial, vehicle=None):
        return self.client.post("/api/v1/maintenances/", {
            "vehicle": (vehicle or self.vehicle).id, "kind": "piece",
            "date": timezone.localdate().isoformat(), "part_name": "Kit embrayage",
            "part_serial": serial, "cost": 0,
        }, format="json")

    def test_achat_piece_trace_auteur_et_date(self):
        r = self.create_part()
        self.assertEqual(r.status_code, 201, r.content[:300])
        self.assertEqual(r.data["status"], "available")
        self.assertEqual(r.data["added_by"], self.admin.id)
        self.assertEqual(r.data["added_by_name"], self.admin.username)
        part = SparePart.objects.get(serial_number="SN-001")
        self.assertEqual(part.added_by, self.admin)
        self.assertEqual(str(part.bought_on), timezone.localdate().isoformat())

    def test_numero_serie_unique_meme_casse_differente(self):
        self.assertEqual(self.create_part("SN-ABC").status_code, 201)
        r = self.create_part("sn-abc", name="Autre pièce")
        self.assertEqual(r.status_code, 400)
        self.assertIn("déjà enregistré", str(r.data["serial_number"][0]))

    def test_maintenance_piece_consomme_piece_et_affiche_engin(self):
        self.create_part("SN-USE")
        r = self.maintenance_piece("sn-use")
        self.assertEqual(r.status_code, 201, r.content[:300])
        self.assertEqual(r.data["part_serial"], "SN-USE")
        part = SparePart.objects.get(serial_number="SN-USE")
        self.assertEqual(part.status, "used")
        self.assertIsNotNone(part.used_at)
        self.assertEqual(part.used_in.vehicle.plate, "Q-030")
        stock = self.client.get("/api/v1/parts/").data
        row = next(x for x in stock if x["serial_number"] == "SN-USE")
        self.assertEqual(row["status"], "used")
        self.assertEqual(row["used_vehicle_plate"], "Q-030")
        self.assertEqual(row["used_vehicle_model"], "Grizzly")
        self.assertEqual(row["used_on"], timezone.localdate().isoformat())
        # Deuxième passage : la pièce ne peut pas servir deux fois.
        r2 = self.maintenance_piece("SN-USE")
        self.assertEqual(r2.status_code, 400)
        self.assertIn("déjà utilisée", str(r2.data["part_serial"][0]))

    def test_maintenance_piece_numero_obligatoire_et_inconnu_refuse(self):
        r = self.client.post("/api/v1/maintenances/", {
            "vehicle": self.vehicle.id, "kind": "piece",
            "date": timezone.localdate().isoformat(), "part_name": "Kit embrayage",
        }, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("part_serial", r.data)
        r2 = self.maintenance_piece("SN-INCONNU")
        self.assertEqual(r2.status_code, 400)
        self.assertIn("Aucune pièce", str(r2.data["part_serial"][0]))

    def test_piece_d_un_autre_site_refusee(self):
        other = Site.objects.create(name="Autre site", city="Bamako")
        self.create_part("SN-SITE", site=other.id)
        r = self.maintenance_piece("SN-SITE")
        self.assertEqual(r.status_code, 400)
        self.assertIn("appartient au site", str(r.data["part_serial"][0]))

    def test_roles_lecture_guide_ecriture_responsable(self):
        self.create_part("SN-ROLE")
        guide = User.objects.create_user(
            username="guide-parts", password="x", phone="+22370000031",
            role="guide", site=self.site)
        agent = User.objects.create_user(
            username="agent-parts", password="x", phone="+22370000032", role="agent")
        client = APIClient()
        client.force_authenticate(user=guide)
        r = client.get("/api/v1/parts/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(client.post("/api/v1/parts/", {}, format="json").status_code, 403)
        client.force_authenticate(user=agent)
        self.assertEqual(client.get("/api/v1/parts/").status_code, 403)

    def test_piece_utilisee_non_supprimable(self):
        self.create_part("SN-KEEP")
        self.maintenance_piece("SN-KEEP")
        part = SparePart.objects.get(serial_number="SN-KEEP")
        r = self.client.delete(f"/api/v1/parts/{part.id}/")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(SparePart.objects.filter(pk=part.id).exists())


class CatalogueSeedTest(TestCase):
    """Sites vides : catalogue standard créé au démarrage, jamais écrasé."""

    def test_catalogue_standard_selon_les_regles_du_site(self):
        from io import StringIO

        from django.core.management import call_command

        orpheus = Site.objects.create(name="Hotel Orpheus", city="Bamako")
        koni = Site.objects.create(name="Konibabougou", city="Bamako")
        autre = Site.objects.create(name="Karting 26 Mars", city="Bamako")

        call_command("seed_catalogue", stdout=StringIO())

        orpheus_names = set(orpheus.activities.values_list("name", flat=True))
        self.assertEqual(orpheus_names, {
            "Quad enfant 15 min", "Vélo électrique 1H",
            "Vélo manuel 1H", "Créneau libre",
        })
        self.assertNotIn("Quad 1H", orpheus_names)

        koni_names = set(koni.activities.values_list("name", flat=True))
        self.assertEqual(koni_names, {"Quad 1H", "Créneau libre"})

        autre_names = set(autre.activities.values_list("name", flat=True))
        self.assertEqual(autre_names, {
            "Quad 1H", "Vélo électrique 1H",
            "Vélo manuel 1H", "Créneau libre",
        })
        formule = autre.activities.get(name="Quad 1H")
        self.assertEqual(formule.base_price, 25000)
        self.assertEqual(formule.duration_minutes, 60)

    def test_relance_idempotente_et_catalogue_existant_intact(self):
        from io import StringIO

        from django.core.management import call_command

        site = Site.objects.create(name="Konibabougou", city="Bamako")
        call_command("seed_catalogue", stdout=StringIO())
        self.assertEqual(site.activities.count(), 2)
        call_command("seed_catalogue", stdout=StringIO())
        self.assertEqual(site.activities.count(), 2)

        configure = Site.objects.create(name="Site configuré", city="Bamako")
        Activity.objects.create(
            site=configure, name="Formule maison", duration_minutes=30,
            base_price=7000, deposit=0, max_group=4)
        call_command("seed_catalogue", stdout=StringIO())
        self.assertEqual(
            list(configure.activities.values_list("name", flat=True)),
            ["Formule maison"])

    def test_formule_utilisee_non_supprimable(self):
        admin = make_admin()
        _site, slot = make_site_slot()
        client = APIClient()
        client.force_authenticate(user=admin)
        r = client.delete(f"/api/v1/activities/{slot.activity_id}/")
        self.assertEqual(r.status_code, 400)
        self.assertIn("créneaux", str(r.data["detail"]))
        self.assertTrue(Activity.objects.filter(pk=slot.activity_id).exists())

    def test_formule_vierge_supprimable(self):
        admin = make_admin()
        site, _ = make_site_slot()
        libre = Activity.objects.create(
            site=site, name="Formule vierge", duration_minutes=30,
            base_price=1000, deposit=0, max_group=4)
        client = APIClient()
        client.force_authenticate(user=admin)
        r = client.delete(f"/api/v1/activities/{libre.id}/")
        self.assertEqual(r.status_code, 204)
        self.assertFalse(Activity.objects.filter(pk=libre.id).exists())
