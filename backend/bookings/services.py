"""Services réservations : transitions tracées, capacité verrouillée. Webhook seul confirme."""

import math
import unicodedata
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from bookings.models import Booking, BookingEvent, BookingLine, generate_code, generate_qr_token

# Tarifs quad adulte (montants entiers FCFA) : 25 000 le quad pour 1 personne
# seule, majoration +5 000 si 2 personnes partagent le même quad (30 000).
# Quads enfants : prix du catalogue, 1 seule personne par quad,
# uniquement sur le site Hôtel Orpheus. Vélos : prix du catalogue,
# 1 personne par vélo.
PRICE_SOLO_QUAD = 25000
PRICE_DUO_QUAD = 30000
PRICE_DUO_EXTRA = PRICE_DUO_QUAD - PRICE_SOLO_QUAD

TRANSITIONS = {
    Booking.PENDING_DEPOSIT: [Booking.CONFIRMED, Booking.CANCELLED, Booking.EXPIRED],
    Booking.CONFIRMED: [Booking.CHECKED_IN, Booking.CANCELLED, Booking.NO_SHOW],
    Booking.CHECKED_IN: [Booking.COMPLETED],
    Booking.COMPLETED: [],
    Booking.CANCELLED: [],
    Booking.NO_SHOW: [],
    Booking.EXPIRED: [],
}


class BookingError(ValueError):
    pass


def _snapshot(b):
    return {"status": b.status, "persons": b.persons, "units": b.units,
            "total": b.total, "discount_total": sum(l.discount for l in b.lines.all()),
            "offline_at": b.offline_at.isoformat() if b.offline_at else None,
            "offline_ref": b.offline_ref}


DISCOUNT_ROLES = ("guide", "responsable", "admin")


def _valid_offline_code(value):
    """Code proposé par l'appareil : même format que le code serveur, sinon ignoré."""
    import re

    code = str(value or "").strip().upper()
    if not re.fullmatch(r"BKO-\d{6}-[A-Z0-9]{4}", code):
        return None
    return code


def _norm_txt(value):
    ascii_only = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    return ascii_only.lower()


def is_kids_activity(name):
    """Formule enfant : nom contenant « kid » ou « enfant » (ex. « Quad kid », « Quad enfant »)."""
    n = _norm_txt(name)
    return "kid" in n or "enfant" in n


def slot_units(activity, slot):
    """Unité de facturation (H) : durée du créneau en unités de la formule.

    Formule « Quad 1H » (60 min) réservée 2 h = 2 unités (facturées 2 × 25 000).
    Créneau de la durée de la formule = 1 unité, prix inchangé. Arrondi au
    dessus (ex. 30 min sur une formule de 15 min = 2 unités).
    """
    booked = max(0, int((slot.end - slot.start).total_seconds() // 60))
    base = max(1, int(activity.duration_minutes))
    return max(1, math.ceil(booked / base))


def is_orpheus_site(name):
    """Site Hôtel Orpheus : seul site autorisé pour les quads enfants."""
    return "orpheus" in _norm_txt(name)


def is_koni_site(name):
    """Site Konibabougou : quads uniquement (ni vélo électrique, ni vélo manuel)."""
    return "koni" in _norm_txt(name)


def is_velo_activity(name):
    """Formule vélo : prix du catalogue, 1 personne par vélo (pas de tarif quad)."""
    return "velo" in _norm_txt(name)


def price_for_occupancy(*, persons, quads):
    """Détail tarifaire standard : quads solo à 25 000, quads duo à 30 000.

    Chaque quad prend 1 ou 2 personnes : duo = persons - quads (quads à 2),
    solo = 2 * quads - persons (quads à 1). Total entier FCFA.
    """
    duo = persons - quads
    solo = 2 * quads - persons
    total = solo * PRICE_SOLO_QUAD + duo * PRICE_DUO_QUAD
    return {"solo": solo, "duo": duo, "total": total}


def price_line(*, pricing, persons, quads):
    """Prix d'une ligne de commande : valide la ligne, renvoie (unit, total).

    - Quad enfant : Hôtel Orpheus uniquement, 1 seule personne par quad,
      prix du catalogue (1 ligne = 1 personne sur son quad).
    - Hôtel Orpheus : quads enfants et vélos uniquement (pas de quad adulte).
    - Vélo : 1 seule personne par vélo, prix du catalogue × personnes.
    - Quad adulte : 1 ou 2 personnes par quad, 25 000 seul,
      +5 000 si 2 sur le même quad (30 000).
    """
    if persons < 1:
        raise BookingError("Au moins 1 personne par ligne.")
    if quads < 1:
        raise BookingError("Au moins 1 quad (ou vélo) par ligne.")
    if pricing.base_price <= 0:
        raise BookingError("Formule à prix zéro : choisissez une vraie formule.")
    if (is_orpheus_site(pricing.site.name)
            and not is_kids_activity(pricing.name)
            and not is_velo_activity(pricing.name)):
        raise BookingError("Site Hôtel Orpheus : pas de quad adulte (enfants et vélos uniquement).")
    if is_kids_activity(pricing.name):
        if not is_orpheus_site(pricing.site.name):
            raise BookingError("Formule enfant : uniquement sur le site Hôtel Orpheus.")
        if persons != quads:
            raise BookingError(
                "Quad enfant : une seule personne par quad "
                "(1 ligne = 1 personne sur son quad)."
            )
        return pricing.base_price, pricing.base_price * persons
    if is_velo_activity(pricing.name):
        if is_koni_site(pricing.site.name):
            raise BookingError("Site Konibabougou : quads uniquement (pas de vélos).")
        if persons != quads:
            raise BookingError(
                "Vélo : une seule personne par vélo "
                "(1 ligne = 1 personne sur son vélo)."
            )
        return pricing.base_price, pricing.base_price * persons
    if quads > persons:
        raise BookingError(
            "Nombre de quads supérieur au nombre de personnes "
            "(1 ou 2 personnes par quad)."
        )
    if persons > 2 * quads:
        raise BookingError(
            "Chaque quad prend 1 ou 2 personnes : prévoyez plus de quads."
        )
    parts = price_for_occupancy(persons=persons, quads=quads)
    return PRICE_SOLO_QUAD, parts["total"]


def _taken_vehicle_ids(site, start, end, exclude_booking=None):
    """Immatriculations déjà prises sur les créneaux qui se chevauchent (même site)."""
    from catalogue.models import Slot

    overlapping = Slot.objects.filter(
        activity__site=site, start__lt=end, end__gt=start)
    qs = Booking.objects.filter(
        slot__in=overlapping,
        status__in=[Booking.PENDING_DEPOSIT, Booking.CONFIRMED, Booking.CHECKED_IN])
    if exclude_booking is not None:
        qs = qs.exclude(pk=exclude_booking)
    taken = qs.exclude(vehicles__id__isnull=True).values_list("vehicles__id", flat=True)
    return set(x for x in taken if x is not None)


def assign_vehicles(*, site, vehicle_type, needed, start, end):
    """Affecte `needed` engins en service du site, hors chevauchements.

    Engins déjà pris = affectés aux réservations actives sur des créneaux
    qui se chevauchent (même site). Flotte non inventoriée (0 engin en
    service) : on ne bloque pas, sans immatriculations.
    """
    from catalogue.models import Vehicle

    pool = list(Vehicle.objects.select_for_update().filter(
        site=site, type=vehicle_type, status="en_service",
    ).order_by("plate").values_list("id", flat=True))
    if not pool:
        return []
    free = [vid for vid in pool if vid not in _taken_vehicle_ids(site, start, end)]
    if len(free) < needed:
        name = "vélos" if vehicle_type == "velo" else "quads"
        raise BookingError(
            f"Flotte insuffisante sur {site.name} : {len(free)} {name} libre(s) "
            f"pour {needed} demandé(s). Ajoutez des engins ou choisissez un autre créneau.")
    return free[:needed]


def set_booking_vehicles(*, booking_id, vehicle_ids, actor=None):
    """Correction a posteriori (anciens reçus) : fige les N° d'engins, tracée.

    Engins du site, en service. Chevauchement contrôlé seulement si le
    créneau est à venir (le passé est documentaire).
    """
    from catalogue.models import Vehicle

    with transaction.atomic():
        booking = Booking.objects.select_for_update().get(pk=booking_id)
        site = booking.slot.activity.site
        ids = [int(v) for v in (vehicle_ids or [])]
        if not ids:
            raise BookingError("Sélectionnez au moins un engin.")
        found = list(Vehicle.objects.filter(pk__in=ids).select_related("site"))
        if len(found) != len(set(ids)):
            raise BookingError("Engin introuvable.")
        for v in found:
            if v.site_id != site.id:
                raise BookingError(f"{v.plate} n'appartient pas au site {site.name}.")
            if v.status != "en_service":
                raise BookingError(f"{v.plate} n'est pas en service.")
        if booking.slot.start > timezone.now():
            taken = _taken_vehicle_ids(
                site, booking.slot.start, booking.slot.end,
                exclude_booking=booking.pk)
            busy = [v.plate for v in found if v.pk in taken]
            if busy:
                raise BookingError(
                    f"Déjà pris sur un créneau qui se chevauche : {', '.join(busy)}.")
        before = sorted(v.plate for v in booking.vehicles.all())
        booking.vehicles.set([v.pk for v in found])
        after = sorted(v.plate for v in found)
        BookingEvent.objects.create(
            booking=booking, actor=actor, action="vehicles_assigned",
            before={"plates": before}, after={"plates": after})
        return booking


def create_booking(*, customer, slot_id, persons, quads=1, source="phone", created_by=None, call=None,
                   activity_id=None, lines=None, code=None, offline_at=None, offline_ref=""):
    """La formule choisie (activité) fixe le prix ; le créneau donne date, heures et capacité.

    Groupes : `lines` = plusieurs lignes [{persons, quads}] (ex. 30 personnes
    deux par deux = 15 lignes de 2 pers. / 1 quad). Sans `lines`, une seule
    ligne (persons, quads). persons/quads/total = sommes des lignes.

    J (hors ligne) : `code` est le code proposé par l'appareil (même format que
    le code serveur) et `offline_at` l'heure de la saisie sur le terrain. Le code
    proposé est conservé s'il est libre ; sinon le serveur en regénère un.
    """
    from catalogue.models import Activity, Slot

    if lines is not None:
        norm_lines = []
        for entry in lines:
            try:
                if isinstance(entry, dict):
                    norm_lines.append((int(entry["persons"]), int(entry["quads"]),
                                       int(entry.get("discount", 0) or 0)))
                else:
                    norm_lines.append((int(entry[0]), int(entry[1]), 0))
            except (KeyError, IndexError, ValueError, TypeError):
                raise BookingError("Ligne invalide (personnes, quads et remise requis).")
        if not norm_lines:
            raise BookingError("Au moins 1 ligne de commande.")
    else:
        if persons < 1:
            raise BookingError("Au moins 1 personne.")
        if quads < 1:
            raise BookingError("Au moins 1 quad.")
        norm_lines = [(int(persons), int(quads), 0)]
    with transaction.atomic():
        slot = Slot.objects.select_for_update().get(pk=slot_id)
        if slot.closed:
            raise BookingError("Ce créneau est fermé.")
        if slot.start <= timezone.now():
            raise BookingError("Ce créneau est passé.")
        pricing = slot.activity
        if activity_id is not None:
            pricing = Activity.objects.filter(pk=activity_id).first()
            if pricing is None:
                raise BookingError("Formule inconnue.")
            if pricing.site_id != slot.activity.site_id:
                raise BookingError("La formule doit appartenir au même site que le créneau.")
        priced = [price_line(pricing=pricing, persons=p, quads=q) for p, q, _ in norm_lines]
        units = slot_units(pricing, slot)
        priced = [(u, t * units) for u, t in priced]  # H : durée en unités de formule
        total_persons = sum(p for p, _, _ in norm_lines)
        total_quads = sum(q for _, q, _ in norm_lines)
        unit = priced[0][0]
        gross = sum(t for _, t in priced)
        discounts = [d for _, _, d in norm_lines]
        discount_total = sum(discounts)
        if any(d < 0 for d in discounts):
            raise BookingError("Remise invalide (montant positif).")
        if any(d > t for (_, t), d in zip(priced, discounts)):
            raise BookingError("Remise supérieure au montant de la ligne.")
        if discount_total > 0:
            role = getattr(created_by, "role", None)
            is_super = getattr(created_by, "is_superuser", False)
            if not is_super and role not in DISCOUNT_ROLES:
                raise BookingError("Remise réservée au moniteur, responsable ou admin.")
        total = gross - discount_total
        deposit = pricing.deposit * total_persons  # 0 = sans acompte (paiement au comptant)
        active = {Booking.PENDING_DEPOSIT, Booking.CONFIRMED, Booking.CHECKED_IN}
        if Booking.objects.filter(customer=customer, slot=slot, status__in=active).exists():
            raise BookingError("Doublon : ce client a déjà une réservation active sur ce créneau.")
        used = (
            Booking.objects.filter(slot=slot, status__in=active).aggregate(s=Sum("persons"))["s"] or 0
        )
        if used + total_persons > slot.capacity:
            raise BookingError("Ce créneau est complet, choisissez-en un autre.")
        # Flotte réelle : affecte les engins en service du site (alerte si dépassement).
        vehicle_type = "velo" if is_velo_activity(pricing.name) else "quad"
        assigned = assign_vehicles(
            site=slot.activity.site, vehicle_type=vehicle_type,
            needed=total_quads, start=slot.start, end=slot.end)
        expiry_min = getattr(settings, "BKO_BOOKING_EXPIRY_MINUTES", 240)
        # J : la fenêtre d'acompte part de l'heure de saisie hors ligne ; si elle
        # est déjà écoulée au rejeu, elle repart de maintenant (l'acompte reste
        # à encaisser, la réservation n'est pas encore payée).
        base = offline_at or timezone.now()
        expires_at = base + timedelta(minutes=expiry_min)
        if expires_at <= timezone.now():
            expires_at = timezone.now() + timedelta(minutes=expiry_min)
        proposed = _valid_offline_code(code)
        for _ in range(5):
            booking_code = proposed or generate_code()
            qr = generate_qr_token()
            try:
                with transaction.atomic():
                    b = Booking.objects.create(
                        code=booking_code,
                        customer=customer,
                        slot=slot,
                        persons=total_persons,
                        quads=total_quads,
                        unit_price=unit,
                        total=total,
                        units=units,
                        deposit_due=deposit,
                        status=Booking.PENDING_DEPOSIT,
                        source=source,
                        call=call,
                        created_by=created_by,
                        expires_at=expires_at,
                        qr_token=qr,
                        offline_at=offline_at,
                        offline_ref=offline_ref or "",
                    )
                    for rank, ((p, q, d), (_, t)) in enumerate(zip(norm_lines, priced), start=1):
                        BookingLine.objects.create(
                            booking=b, rank=rank, persons=p, quads=q, line_total=t,
                            discount=d,
                        )
                    if assigned:
                        b.vehicles.set(assigned)
                    BookingEvent.objects.create(
                        booking=b, actor=created_by, action="created",
                        before={}, after=_snapshot(b),
                    )
                    return b
            except IntegrityError:
                # Code déjà pris (proposition de l'appareil) : on regénère.
                proposed = None
                continue
        raise BookingError("Impossible de générer un code unique, réessayez.")


def apply_discount(*, booking_id, discount, actor=None, reason=""):
    """Remise manuelle (moniteur/responsable/admin) sur une réservation vivante.

    Total saisi par le moniteur, réparti au prorata des lignes. La remise ne
    peut être appliquée qu'avant tout encaissement, avec motif obligatoire ;
    tout est tracé (qui, quand, avant, après)."""
    try:
        discount = int(discount or 0)
    except (TypeError, ValueError):
        raise BookingError("Remise invalide.")
    if discount < 0:
        raise BookingError("Remise invalide (montant positif).")
    role = getattr(actor, "role", None)
    if not (getattr(actor, "is_superuser", False) or role in DISCOUNT_ROLES):
        raise BookingError("Remise réservée au moniteur, responsable ou admin.")
    if not str(reason).strip():
        raise BookingError("Motif obligatoire pour la remise.")
    with transaction.atomic():
        b = Booking.objects.select_for_update().get(pk=booking_id)
        if b.status not in (Booking.PENDING_DEPOSIT, Booking.CONFIRMED, Booking.CHECKED_IN):
            raise BookingError("Remise impossible : réservation close ou sortie du livre.")
        if b.payments.filter(status="paid").exists():
            raise BookingError("Remise impossible : réservation déjà encaissée.")
        lines = list(BookingLine.objects.filter(booking=b).order_by("rank"))
        if not lines:
            raise BookingError("Aucune ligne de commande.")
        gross = sum(l.line_total for l in lines)
        if discount > gross:
            raise BookingError(f"Remise supérieure au total brut ({gross} FCFA).")
        old = _snapshot(b)
        for line in lines:
            line.discount = discount * line.line_total // gross
        left = discount - sum(l.discount for l in lines)
        i = 0
        while left > 0:
            line = lines[i % len(lines)]
            if line.discount + 1 <= line.line_total:
                line.discount += 1
                left -= 1
            i += 1
        BookingLine.objects.bulk_update(lines, ["discount"])
        b.total = gross - discount
        if b.deposit_due > b.total:
            b.deposit_due = b.total
        b.save(update_fields=["total", "deposit_due"])
        BookingEvent.objects.create(
            booking=b, actor=actor, action="discount",
            before=old, after={**_snapshot(b), "reason": str(reason).strip()},
        )
        return b


def transition(*, booking_id, to_status, actor=None, reason="", via_webhook=False, via_cash=False):
    # Évolution validée : un acompte espèces encaissé et tracé confirme comme le webhook.
    if to_status == Booking.CONFIRMED and not (via_webhook or via_cash):
        raise BookingError("Seul un encaissement tracé (webhook ou espèces) peut confirmer.")
    if to_status == Booking.CANCELLED and not reason.strip():
        raise BookingError("Motif obligatoire pour annuler.")
    with transaction.atomic():
        b = Booking.objects.select_for_update().get(pk=booking_id)
        allowed = TRANSITIONS.get(b.status, [])
        if to_status not in allowed:
            raise BookingError(f"Transition {b.status} -> {to_status} interdite.")
        before = _snapshot(b)
        b.status = to_status
        if to_status == Booking.CANCELLED:
            b.cancel_reason = reason.strip()
        b.save(update_fields=["status", "cancel_reason"])
        BookingEvent.objects.create(
            booking=b, actor=actor, action=f"status->{to_status}",
            before=before, after=_snapshot(b),
        )
        return b
