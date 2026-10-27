"""Tests tranche 3 : 7 statuts (A), anti-doublon, capacité, webhook seul confirme."""

from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import User
from bookings.models import Booking, BookingEvent
from bookings.services import (
    PRICE_DUO_QUAD,
    PRICE_SOLO_QUAD,
    BookingError,
    apply_discount,
    create_booking,
    fleet_availability,
    price_for_occupancy,
    transition,
)
from catalogue.models import Activity, Site, Slot, Vehicle
from catalogue.testing import add_fleet
from clients.models import Customer


def make_setup(capacity=4, fleet=True):
    site = Site.objects.create(name="Bamako", city="Bamako")
    act = Activity.objects.create(
        site=site, name="Quad 1h", duration_minutes=60,
        base_price=25000, deposit=10000, max_group=10,
    )
    if fleet:
        add_fleet(site)
    start = timezone.now() + timedelta(days=1)
    slot = Slot.objects.create(activity=act, start=start, end=start + timedelta(hours=1), capacity=capacity)
    cust = Customer.objects.create(name="M. Traoré", phone="+22370000001")
    agent = User.objects.create_user(username="agent1", password="x", phone="+22370000009", role="agent")
    return cust, slot, agent


class BookingTest(TestCase):
    def test_7_statuts_sans_brouillon(self):
        codes = [c for c, _ in Booking.STATUS_CHOICES]
        self.assertEqual(
            codes,
            ["pending_deposit", "confirmed", "checked_in", "completed", "cancelled", "no_show", "expired"],
        )
        self.assertNotIn("draft", codes)

    def test_create_calcule_prix_et_trace(self):
        cust, slot, agent = make_setup()
        # 2 personnes sur 1 quad = 30 000 FCFA (majoration duo).
        b = create_booking(customer=cust, slot_id=slot.id, persons=2, quads=1,
                           source="phone", created_by=agent)
        self.assertTrue(b.code.startswith("BKO-"))
        self.assertEqual(b.unit_price, PRICE_SOLO_QUAD)
        self.assertEqual(b.total, PRICE_DUO_QUAD)
        self.assertEqual(b.deposit_due, 20000)
        self.assertEqual(b.status, "pending_deposit")
        self.assertEqual(b.events.count(), 1)

    def test_flotte_affecte_immatriculations(self):
        cust, slot, agent = make_setup(fleet=False)
        site = slot.activity.site
        for plate in ("Q-101", "Q-102", "Q-103"):
            Vehicle.objects.create(site=site, type="quad", model="Grizzly", plate=plate)
        b = create_booking(customer=cust, slot_id=slot.id, persons=2, quads=1, created_by=agent)
        self.assertEqual(
            sorted(v.plate for v in b.vehicles.all()), ["Q-101"])
        self.assertEqual(b.quads, 1)

    def test_flotte_insuffisante_alerte(self):
        cust, slot, agent = make_setup(fleet=False)
        site = slot.activity.site
        Vehicle.objects.create(site=site, type="quad", model="Grizzly", plate="Q-101")
        cust2 = Customer.objects.create(name="Mme Diallo", phone="+22370000002")
        with self.assertRaises(BookingError) as ctx:
            create_booking(customer=cust2, slot_id=slot.id, persons=3, quads=2, created_by=agent)
        self.assertIn("Flotte insuffisante", str(ctx.exception))
        self.assertEqual(Booking.objects.count(), 0)

    def test_chevauchement_partage_flotte(self):
        from datetime import timedelta

        cust, slot, agent = make_setup(fleet=False)
        site = slot.activity.site
        for plate in ("Q-101", "Q-102", "Q-103"):
            Vehicle.objects.create(site=site, type="quad", model="Grizzly", plate=plate)
        create_booking(customer=cust, slot_id=slot.id, persons=4, quads=2, created_by=agent)
        # Créneau chevauchant : 2 + 2 > 3 → alerte.
        over = Slot.objects.create(
            activity=slot.activity, start=slot.start + timedelta(minutes=30),
            end=slot.end + timedelta(minutes=30), capacity=10)
        cust2 = Customer.objects.create(name="Mme Diallo", phone="+22370000002")
        with self.assertRaises(BookingError):
            create_booking(customer=cust2, slot_id=over.id, persons=4, quads=2, created_by=agent)
        # Créneau disjoint : réutilisation des mêmes quads.
        later = Slot.objects.create(
            activity=slot.activity, start=slot.end + timedelta(hours=1),
            end=slot.end + timedelta(hours=2), capacity=10)
        b2 = create_booking(customer=cust2, slot_id=later.id, persons=4, quads=2, created_by=agent)
        self.assertEqual(b2.vehicles.count(), 2)

    def test_scenario_dg_flotte_six_quads(self):
        cust, slot, agent = make_setup(capacity=10, fleet=False)
        site = slot.activity.site
        for index in range(6):
            Vehicle.objects.create(
                site=site, type="quad", model="Grizzly", plate=f"DG-{index:03d}")

        s25 = Slot.objects.create(
            activity=slot.activity, start=slot.start, end=slot.end, capacity=10)
        s26_15 = Slot.objects.create(
            activity=slot.activity, start=slot.start + timedelta(days=1),
            end=slot.end + timedelta(days=1), capacity=10)
        s26_10 = Slot.objects.create(
            activity=slot.activity, start=slot.start + timedelta(days=1, hours=-5),
            end=slot.end + timedelta(days=1, hours=-5), capacity=10)

        def book(name, phone, slot_id, quads):
            customer = Customer.objects.create(name=name, phone=phone)
            return create_booking(
                customer=customer, slot_id=slot_id, persons=quads,
                quads=quads, created_by=agent)

        book("Client 1", "+22371000001", s25.id, 2)
        book("Client 2", "+22371000002", s25.id, 2)
        self.assertEqual(
            fleet_availability(site=site, resource_type="quad",
                               start=s25.start, end=s25.end)["free"], 2)
        b26 = book("Client 3", "+22371000003", s26_15.id, 2)
        self.assertEqual(b26.resource_type, "quad")
        # 2 + 4 = 6 quads : le groupe suivant tient exactement dans la flotte.
        book("Client 4", "+22371000004", s26_15.id, 4)
        self.assertEqual(
            fleet_availability(site=site, resource_type="quad",
                               start=s26_15.start, end=s26_15.end)["free"], 0)
        with self.assertRaisesRegex(BookingError, "Flotte insuffisante"):
            book("Client 5", "+22371000005", s26_15.id, 1)
        book("Client 6", "+22371000006", s26_10.id, 1)
        self.assertEqual(Booking.objects.filter(status=Booking.PENDING_DEPOSIT).count(), 5)

    def test_velos_consomment_la_flotte_velo_uniquement(self):
        cust, slot, agent = make_setup(fleet=False)
        site = slot.activity.site
        velo = Activity.objects.create(
            site=site, name="Vélo manuel 1H", duration_minutes=60,
            base_price=3000, deposit=0, max_group=10)
        v = Vehicle.objects.create(
            site=site, type="velo", model="VTT", plate="V-001")
        Vehicle.objects.create(
            site=site, type="quad", model="Grizzly", plate="Q-001")
        start = slot.start
        velo_slot = Slot.objects.create(
            activity=velo, start=start, end=start + timedelta(hours=1), capacity=10)
        b = create_booking(
            customer=cust, slot_id=velo_slot.id, persons=1, quads=1,
            created_by=agent)
        self.assertEqual(b.resource_type, "velo")
        self.assertEqual([x.plate for x in b.vehicles.all()], [v.plate])
        other = Customer.objects.create(name="Mme Vélo", phone="+22371000006")
        with self.assertRaisesRegex(BookingError, "vélos"):
            create_booking(
                customer=other, slot_id=velo_slot.id, persons=1, quads=1,
                created_by=agent)

    def test_flotte_isolee_par_site(self):
        cust, slot, agent = make_setup(fleet=False)
        site = slot.activity.site
        add_fleet(site, quads=2, velos=0)
        other = Site.objects.create(name="Ailleurs", city="Bamako")
        add_fleet(other, quads=2, velos=0)
        other_act = Activity.objects.create(
            site=other, name="Quad 1h", duration_minutes=60,
            base_price=25000, deposit=0, max_group=10)
        other_slot = Slot.objects.create(
            activity=other_act, start=slot.start, end=slot.end, capacity=10)
        create_booking(customer=cust, slot_id=slot.id, persons=2, quads=2,
                       created_by=agent)
        customer_b = Customer.objects.create(name="Client B", phone="+22371000007")
        b = create_booking(customer=customer_b, slot_id=other_slot.id,
                           persons=2, quads=2, created_by=agent)
        self.assertEqual(b.slot.activity.site, other)

    def test_annulation_libere_la_flotte(self):
        cust, slot, agent = make_setup(capacity=10, fleet=False)
        add_fleet(slot.activity.site, quads=6, velos=0)
        b = create_booking(customer=cust, slot_id=slot.id, persons=2, quads=2,
                           created_by=agent)
        transition(booking_id=b.id, to_status=Booking.CANCELLED,
                   actor=agent, reason="Client absent")
        other = Customer.objects.create(name="Groupe", phone="+22371000008")
        b2 = create_booking(customer=other, slot_id=slot.id, persons=6, quads=6,
                            created_by=agent)
        self.assertEqual(b2.quads, 6)

    @override_settings(BKO_FLEET_STRICT=False)
    def test_mode_souple_trace_sans_flotte(self):
        cust, slot, agent = make_setup(fleet=False)
        b = create_booking(customer=cust, slot_id=slot.id, persons=1,
                           quads=1, created_by=agent)
        self.assertEqual(b.vehicles.count(), 0)
        self.assertTrue(b.events.filter(action="created_fleet_soft").exists())

    def test_correction_vehicules_anciens_recus_tracee(self):
        from bookings.services import set_booking_vehicles

        cust, slot, agent = make_setup()
        site = slot.activity.site
        v1 = Vehicle.objects.create(site=site, type="quad", model="Grizzly", plate="Q-101")
        v2 = Vehicle.objects.create(site=site, type="quad", model="Grizzly", plate="Q-102")
        b = create_booking(customer=cust, slot_id=slot.id, persons=2, quads=1, created_by=agent)
        # Ancienne réservation (créneau passé) : correction documentaire.
        future = Slot.objects.create(
            activity=slot.activity, start=slot.start + timedelta(days=1),
            end=slot.start + timedelta(days=1) + timedelta(hours=1), capacity=10)
        cust2 = Customer.objects.create(name="Mme Diallo", phone="+22370000002")
        old = create_booking(customer=cust2, slot_id=future.id, persons=2, quads=1,
                             created_by=agent)
        Slot.objects.filter(pk=future.pk).update(
            start=slot.start - timedelta(days=2), end=slot.start - timedelta(days=2))
        old.refresh_from_db()
        fixed = set_booking_vehicles(booking_id=old.id, vehicle_ids=[v1.id, v2.id],
                                     actor=agent)
        self.assertEqual(sorted(v.plate for v in fixed.vehicles.all()), ["Q-101", "Q-102"])
        self.assertTrue(old.events.filter(action="vehicles_assigned").exists())
        # Mauvais site refusé.
        other = Site.objects.create(name="Ailleurs", city="Bamako")
        vx = Vehicle.objects.create(site=other, type="quad", model="X", plate="Q-999")
        with self.assertRaises(BookingError):
            set_booking_vehicles(booking_id=old.id, vehicle_ids=[vx.id], actor=agent)
        # API : responsable OK, agent refusé.
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=agent)
        self.assertEqual(client.post(
            f"/api/v1/bookings/{old.id}/vehicles/", {"vehicles": [v1.id]},
            format="json").status_code, 403)
        resp = User.objects.create_user(
            username="resp1", password="x", phone="+22370000003", role="responsable")
        client.force_authenticate(user=resp)
        r = client.post(f"/api/v1/bookings/{old.id}/vehicles/", {"vehicles": [v1.id]},
                        format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["vehicle_plates"], ["Q-101"])

    def test_remise_manuelle_net_facture(self):
        cust, slot, agent = make_setup()
        guide = User.objects.create_user(
            username="guide1", password="x", phone="+22370000007", role="guide")
        # 2 pers. / 1 quad = 30 000 brut, remise 10 000 → net 20 000.
        b = create_booking(customer=cust, slot_id=slot.id, persons=2, quads=1,
                           lines=[{"persons": 2, "quads": 1, "discount": 10000}],
                           created_by=guide)
        self.assertEqual(b.total, 20000)
        self.assertEqual(b.lines.get().discount, 10000)
        # Remise supérieure au brut refusée.
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=1, quads=1,
                           lines=[{"persons": 1, "quads": 1, "discount": 99999}],
                           created_by=guide)
        # Agent sans droit de remise.
        with self.assertRaises(BookingError) as ctx:
            create_booking(customer=cust, slot_id=slot.id, persons=1, quads=1,
                           lines=[{"persons": 1, "quads": 1, "discount": 1000}],
                           created_by=agent)
        self.assertIn("moniteur", str(ctx.exception))

    def test_appliquer_remise_apres_creation(self):
        from payments.models import Payment

        cust, slot, agent = make_setup()
        guide = User.objects.create_user(
            username="guide2", password="x", phone="+22370000006", role="guide")
        b = create_booking(
            customer=cust, slot_id=slot.id,
            persons=3, quads=2,
            lines=[{"persons": 1, "quads": 1}, {"persons": 2, "quads": 1}],
            created_by=agent)  # 55 000 brut : solo 25 000 + duo 30 000
        # Motif obligatoire.
        with self.assertRaises(BookingError):
            apply_discount(booking_id=b.id, discount=5000, actor=guide, reason="  ")
        # Agent refusé.
        with self.assertRaises(BookingError) as ctx:
            apply_discount(booking_id=b.id, discount=5000, actor=agent, reason="x")
        self.assertIn("moniteur", str(ctx.exception))
        # Remise répartie au prorata : 25 000 → 4 546, 30 000 → 5 454 (reste à la 1re).
        d = apply_discount(booking_id=b.id, discount=10000, actor=guide,
                           reason="Client résident")
        self.assertEqual(d.total, 45000)
        ranks = list(b.lines.order_by("rank"))
        self.assertEqual([l.discount for l in ranks], [4546, 5454])
        self.assertTrue(b.events.filter(action="discount").exists())
        # Déjà encaissée : refus.
        Payment.objects.create(booking=b, amount=d.total, nature="balance",
                               reference="CASH-1", status="paid")
        with self.assertRaises(BookingError):
            apply_discount(booking_id=b.id, discount=1000, actor=guide, reason="Deux fois")
        # Réservation close : refus.
        cust2 = Customer.objects.create(name="Mme Sissoko", phone="+22370000004")
        b2 = create_booking(customer=cust2, slot_id=slot.id, persons=1, quads=1,
                            created_by=agent)
        transition(booking_id=b2.id, to_status=Booking.CANCELLED, actor=agent, reason="Rien")
        with self.assertRaises(BookingError):
            apply_discount(booking_id=b2.id, discount=1000, actor=guide, reason="Fermé")
        # Remise zéro (annuler la remise) autorisée, tracée.
        cust3 = Customer.objects.create(name="M. Bamba", phone="+22370000005")
        b3 = create_booking(customer=cust3, slot_id=slot.id, persons=1, quads=1,
                            created_by=agent)
        d3 = apply_discount(booking_id=b3.id, discount=5000, actor=guide, reason="Trop cher")
        self.assertEqual(d3.total, 20000)
        d3 = apply_discount(booking_id=b3.id, discount=0, actor=guide, reason="Sans remise")
        self.assertEqual(d3.total, 25000)

    def test_tarif_solo_25000(self):
        cust, slot, agent = make_setup()
        b = create_booking(customer=cust, slot_id=slot.id, persons=1, quads=1, created_by=agent)
        self.assertEqual(b.total, 25000)

    def test_tarif_mixte_3_pers_2_quads(self):
        # 1 quad solo (25 000) + 1 quad duo (30 000) = 55 000.
        cust, slot, agent = make_setup()
        b = create_booking(customer=cust, slot_id=slot.id, persons=3, quads=2, created_by=agent)
        self.assertEqual(b.total, 55000)
        self.assertEqual(
            price_for_occupancy(persons=3, quads=2),
            {"solo": 1, "duo": 1, "total": 55000},
        )

    def test_3_personnes_1_quad_refuse(self):
        cust, slot, agent = make_setup()
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=3, quads=1, created_by=agent)

    def test_quads_sup_personnes_refuse(self):
        cust, slot, agent = make_setup()
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=1, quads=2, created_by=agent)

    def test_formule_enfant_orpheus_solo_uniquement(self):
        site = Site.objects.create(name="Hôtel Orpheus", city="Bamako")
        add_fleet(site)
        formule = Activity.objects.create(
            site=site, name="Quad kid 15 min", duration_minutes=15,
            base_price=5000, deposit=0, max_group=6,
        )
        start = timezone.now() + timedelta(days=1)
        slot = Slot.objects.create(
            activity=formule, start=start, end=start + timedelta(minutes=15), capacity=6)
        cust = Customer.objects.create(name="M. Traoré", phone="+22370000001")
        agent = User.objects.create_user(username="agent1", password="x", phone="+22370000009", role="agent")
        b = create_booking(customer=cust, slot_id=slot.id, persons=2, quads=2,
                           activity_id=formule.id, created_by=agent)
        self.assertEqual(b.unit_price, 5000)
        self.assertEqual(b.total, 10000)
        cust2 = Customer.objects.create(name="Mme Diallo", phone="+22370000002")
        with self.assertRaises(BookingError):
            create_booking(customer=cust2, slot_id=slot.id, persons=2, quads=1,
                           activity_id=formule.id, created_by=agent)

    def test_formule_enfant_hors_orpheus_refusee(self):
        cust, slot, agent = make_setup()
        formule = Activity.objects.create(
            site=slot.activity.site, name="Quad enfant 15 min", duration_minutes=15,
            base_price=5000, deposit=0, max_group=6,
        )
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=1, quads=1,
                           activity_id=formule.id, created_by=agent)

    def test_orpheus_sans_quad_adulte_mais_velo_ok(self):
        # Orpheus : quads enfants et vélos, pas de quad adulte.
        site = Site.objects.create(name="Hôtel Orpheus", city="Bamako")
        add_fleet(site)
        quad = Activity.objects.create(
            site=site, name="Quad 1H", duration_minutes=60,
            base_price=25000, deposit=0, max_group=10,
        )
        velo = Activity.objects.create(
            site=site, name="Vélo manuel 1H", duration_minutes=60,
            base_price=3000, deposit=0, max_group=10,
        )
        start = timezone.now() + timedelta(days=1)
        slot = Slot.objects.create(
            activity=quad, start=start, end=start + timedelta(hours=1), capacity=10)
        cust = Customer.objects.create(name="M. Traoré", phone="+22370000001")
        agent = User.objects.create_user(username="agent1", password="x", phone="+22370000009", role="agent")
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=2, quads=1,
                           activity_id=quad.id, created_by=agent)
        self.assertEqual(Booking.objects.count(), 0)
        b = create_booking(customer=cust, slot_id=slot.id, persons=1, quads=1,
                           activity_id=velo.id, created_by=agent)
        self.assertEqual(b.total, 3000)

    def test_konibabougou_quads_uniquement(self):
        # Konibabougou : ni vélo électrique ni vélo manuel, quads adultes OK.
        site = Site.objects.create(name="Konibabougou", city="Bamako")
        add_fleet(site)
        quad = Activity.objects.create(
            site=site, name="Quad 1H", duration_minutes=60,
            base_price=25000, deposit=0, max_group=10,
        )
        velo = Activity.objects.create(
            site=site, name="Vélo électrique 1H", duration_minutes=60,
            base_price=5000, deposit=0, max_group=10,
        )
        start = timezone.now() + timedelta(days=1)
        slot = Slot.objects.create(
            activity=quad, start=start, end=start + timedelta(hours=1), capacity=10)
        cust = Customer.objects.create(name="M. Traoré", phone="+22370000001")
        agent = User.objects.create_user(username="agent1", password="x", phone="+22370000009", role="agent")
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=1, quads=1,
                           activity_id=velo.id, created_by=agent)
        self.assertEqual(Booking.objects.count(), 0)
        b = create_booking(customer=cust, slot_id=slot.id, persons=2, quads=1,
                           activity_id=quad.id, created_by=agent)
        self.assertEqual(b.total, 30000)

    def test_groupe_30_personnes_plusieurs_lignes_duo(self):
        # 30 personnes deux par deux = 15 lignes de 2 pers. / 1 quad.
        cust, slot, agent = make_setup(capacity=40)
        b = create_booking(
            customer=cust, slot_id=slot.id, persons=30, quads=15,
            lines=[{"persons": 2, "quads": 1}] * 15, created_by=agent,
        )
        self.assertEqual(b.persons, 30)
        self.assertEqual(b.quads, 15)
        self.assertEqual(b.total, 15 * 30000)
        self.assertEqual(b.lines.count(), 15)
        self.assertTrue(all(x.line_total == 30000 for x in b.lines.all()))
        self.assertEqual([x.rank for x in b.lines.all()], list(range(1, 16)))

    def test_ligne_invalide_annule_tout_sans_trace(self):
        cust, slot, agent = make_setup()
        with self.assertRaises(BookingError):
            create_booking(
                customer=cust, slot_id=slot.id, persons=5, quads=2,
                lines=[{"persons": 2, "quads": 1}, {"persons": 3, "quads": 1}],
                created_by=agent,
            )
        self.assertEqual(Booking.objects.count(), 0)

    def test_velo_prix_catalogue_1_par_velo(self):
        cust, slot, agent = make_setup()
        velo = Activity.objects.create(
            site=slot.activity.site, name="Vélo manuel 1H", duration_minutes=60,
            base_price=3000, deposit=0, max_group=10,
        )
        b = create_booking(
            customer=cust, slot_id=slot.id, persons=2, quads=2,
            lines=[{"persons": 1, "quads": 1}, {"persons": 1, "quads": 1}],
            activity_id=velo.id, created_by=agent,
        )
        self.assertEqual(b.unit_price, 3000)
        self.assertEqual(b.total, 6000)
        cust2 = Customer.objects.create(name="Mme Diallo", phone="+22370000002")
        with self.assertRaises(BookingError):
            create_booking(customer=cust2, slot_id=slot.id, persons=2, quads=1,
                           activity_id=velo.id, created_by=agent)

    def test_enfant_plusieurs_lignes_individuelles(self):
        site = Site.objects.create(name="Hôtel Orpheus", city="Bamako")
        add_fleet(site)
        formule = Activity.objects.create(
            site=site, name="Quad kid 15 min", duration_minutes=15,
            base_price=5000, deposit=0, max_group=6,
        )
        start = timezone.now() + timedelta(days=1)
        slot = Slot.objects.create(
            activity=formule, start=start, end=start + timedelta(minutes=15), capacity=6)
        cust = Customer.objects.create(name="M. Traoré", phone="+22370000001")
        agent = User.objects.create_user(username="agent1", password="x", phone="+22370000009", role="agent")
        b = create_booking(
            customer=cust, slot_id=slot.id, persons=2, quads=2,
            lines=[{"persons": 1, "quads": 1}, {"persons": 1, "quads": 1}],
            activity_id=formule.id, created_by=agent,
        )
        self.assertEqual(b.total, 10000)
        self.assertEqual(b.lines.count(), 2)

    def test_catalogue_enfant_hors_orpheus_refuse(self):
        from common.serializers import ActivitySerializer

        site = Site.objects.create(name="Konibabougou", city="Bamako")
        data = {"site": site.id, "name": "Quad kid 15 min", "duration_minutes": 15,
                "base_price": 5000, "deposit": 0, "max_group": 6}
        s = ActivitySerializer(data=data)
        self.assertFalse(s.is_valid())
        self.assertIn("Orpheus", str(s.errors))
        orpheus = Site.objects.create(name="Hôtel Orpheus", city="Bamako")
        ok = ActivitySerializer(data={**data, "site": orpheus.id})
        self.assertTrue(ok.is_valid(), ok.errors)

    def test_formule_autre_site_refusee(self):
        cust, slot, agent = make_setup()
        far = Site.objects.create(name="Ailleurs", city="X")
        formule = Activity.objects.create(
            site=far, name="Quad 1h", duration_minutes=60,
            base_price=25000, deposit=0, max_group=10,
        )
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=1,
                           activity_id=formule.id, created_by=agent)

    def test_anti_doublon(self):
        cust, slot, agent = make_setup()
        create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)

    def test_capacite_complete(self):
        cust, slot, agent = make_setup(capacity=2)
        cust2 = Customer.objects.create(name="Mme Diallo", phone="+22370000002")
        create_booking(customer=cust, slot_id=slot.id, persons=2, created_by=agent)
        with self.assertRaises(BookingError) as cm:
            create_booking(customer=cust2, slot_id=slot.id, persons=1, created_by=agent)
        self.assertIn("complet", str(cm.exception))

    def test_seul_webhook_confirme(self):
        cust, slot, agent = make_setup()
        b = create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)
        with self.assertRaises(BookingError):
            transition(booking_id=b.id, to_status="confirmed", actor=agent)
        b = transition(booking_id=b.id, to_status="confirmed", actor=agent, via_webhook=True)
        self.assertEqual(b.status, "confirmed")

    def test_annulation_motif_obligatoire(self):
        cust, slot, agent = make_setup()
        b = create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)
        with self.assertRaises(BookingError):
            transition(booking_id=b.id, to_status="cancelled", actor=agent)
        b = transition(booking_id=b.id, to_status="cancelled", actor=agent, reason="Client indisponible")
        self.assertEqual(b.cancel_reason, "Client indisponible")

    def test_jamais_supprime_event_append_only(self):
        cust, slot, agent = make_setup()
        b = create_booking(customer=cust, slot_id=slot.id, persons=1, created_by=agent)
        with self.assertRaises(RuntimeError):
            b.delete()
        ev = b.events.first()
        with self.assertRaises(RuntimeError):
            ev.save()
        with self.assertRaises(RuntimeError):
            ev.delete()

    def test_prix_zero_refuse(self):
        cust, slot, agent = make_setup()
        zero = Activity.objects.create(
            site=slot.activity.site, name="Gratuit", duration_minutes=60,
            base_price=0, deposit=0, max_group=10,
        )
        with self.assertRaises(BookingError):
            create_booking(customer=cust, slot_id=slot.id, persons=1,
                           activity_id=zero.id, created_by=agent)
