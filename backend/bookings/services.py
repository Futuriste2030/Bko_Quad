"""Services réservations : transitions tracées, capacité verrouillée. Webhook seul confirme."""

from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from bookings.models import Booking, BookingEvent, generate_code, generate_qr_token

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
    return {"status": b.status, "persons": b.persons, "total": b.total}


def create_booking(*, customer, slot_id, persons, quads=1, source="phone", created_by=None, call=None):
    from catalogue.models import Slot

    if persons < 1:
        raise BookingError("Au moins 1 personne.")
    with transaction.atomic():
        slot = Slot.objects.select_for_update().get(pk=slot_id)
        if slot.closed:
            raise BookingError("Ce créneau est fermé.")
        if slot.start <= timezone.now():
            raise BookingError("Ce créneau est passé.")
        active = {Booking.PENDING_DEPOSIT, Booking.CONFIRMED, Booking.CHECKED_IN}
        if Booking.objects.filter(customer=customer, slot=slot, status__in=active).exists():
            raise BookingError("Doublon : ce client a déjà une réservation active sur ce créneau.")
        used = (
            Booking.objects.filter(slot=slot, status__in=active).aggregate(s=Sum("persons"))["s"] or 0
        )
        if used + persons > slot.capacity:
            raise BookingError("Ce créneau est complet, choisissez-en un autre.")
        unit = slot.activity.base_price
        deposit = slot.activity.deposit * persons  # provisoire (H), validé au cadrage
        expiry_min = getattr(settings, "BKO_BOOKING_EXPIRY_MINUTES", 240)
        for _ in range(5):
            code = generate_code()
            qr = generate_qr_token()
            try:
                with transaction.atomic():
                    b = Booking.objects.create(
                        code=code,
                        customer=customer,
                        slot=slot,
                        persons=persons,
                        quads=quads,
                        unit_price=unit,
                        total=unit * persons,
                        deposit_due=deposit,
                        status=Booking.PENDING_DEPOSIT,
                        source=source,
                        call=call,
                        created_by=created_by,
                        expires_at=timezone.now() + timedelta(minutes=expiry_min),
                        qr_token=qr,
                    )
                    BookingEvent.objects.create(
                        booking=b, actor=created_by, action="created",
                        before={}, after=_snapshot(b),
                    )
                    return b
            except IntegrityError:
                continue
        raise BookingError("Impossible de générer un code unique, réessayez.")


def transition(*, booking_id, to_status, actor=None, reason="", via_webhook=False):
    if to_status == Booking.CONFIRMED and not via_webhook:
        raise BookingError("Seul le webhook de paiement peut confirmer.")
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
