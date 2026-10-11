"""Rapprochement appels-réservations : normalisation, anomalie persistante, clôture."""

from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone

from telephony.models import CallAnomaly, CallLog, DailyClosing


class TelephonyError(ValueError):
    pass


def normalize_phone(raw):
    digits = "".join(c for c in raw if c.isdigit())
    if raw.strip().startswith("+"):
        return "+" + digits
    if digits.startswith("223") and len(digits) == 11:
        return "+" + digits
    if len(digits) == 8:
        return "+223" + digits
    return "+" + digits


def reconcile_call(call_id, window_hours=24):
    """Rapproche un appel d'une réservation ; sinon crée une anomalie persistante."""
    from bookings.models import Booking

    call = CallLog.objects.get(pk=call_id)
    phone = normalize_phone(call.phone_number)
    start = call.started_at - timedelta(hours=window_hours)
    end = call.started_at + timedelta(hours=window_hours)
    booking = (
        Booking.objects.filter(
            customer__phone=phone, created_at__range=(start, end)
        ).order_by("created_at").first()
    )
    if booking is not None:
        if booking.call_id is None:
            booking.call = call
            booking.save(update_fields=["call"])
        return booking, None
    anomaly, _ = CallAnomaly.objects.get_or_create(call=call)
    return None, anomaly


def resolve_anomaly(anomaly_id, reason, resolved_by=None, comment=""):
    valid = {c for c, _ in CallAnomaly.REASON_CHOICES}
    if reason not in valid:
        raise TelephonyError("Motif obligatoire pour clore (renseignement, annulation, faux numéro, autre).")
    anomaly = CallAnomaly.objects.get(pk=anomaly_id)
    anomaly.status = "resolved"
    anomaly.reason = reason
    anomaly.comment = comment
    anomaly.resolved_by = resolved_by
    anomaly.resolved_at = timezone.now()
    anomaly.save()
    return anomaly


def daily_closing(target_date, validated_by=None):
    from bookings.models import Booking
    from payments.models import Payment

    bookings_count = Booking.objects.filter(created_at__date=target_date).count()
    amount = (
        Payment.objects.filter(status="paid", created_at__date=target_date).aggregate(s=Sum("amount"))["s"] or 0
    )
    calls_count = CallLog.objects.filter(started_at__date=target_date).count()
    anomalies_open = CallAnomaly.objects.filter(status="open", call__started_at__date=target_date).count()
    closing, _ = DailyClosing.objects.update_or_create(
        date=target_date,
        defaults={"bookings_count": bookings_count, "amount_collected": amount,
                  "calls_count": calls_count, "anomalies_open": anomalies_open,
                  "validated_by": validated_by},
    )
    return closing
