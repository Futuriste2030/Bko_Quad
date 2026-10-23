"""Rapprochement appels-réservations : normalisation, anomalie persistante, clôture."""

from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone

from telephony.models import CallAnomaly, CallLog, DailyClosing


class TelephonyError(ValueError):
    pass


def normalize_phone(raw, default_country="223"):
    """Normalise vers +223 (Mali, 8 chiffres) ou +225 (Côte d'Ivoire, 10 chiffres).

    - International déjà préfixé : gardé tel quel.
    - 8 chiffres : Mali -> +223XXXXXXXX.
    - 10 chiffres commençant par 0 : Côte d'Ivoire -> +225XXXXXXXXXX.
    - Sinon : préfixe du pays de la ligne émettrice (default_country).
    """
    digits = "".join(c for c in raw if c.isdigit())
    if raw.strip().startswith("+"):
        return "+" + digits
    if digits.startswith("223") and len(digits) == 11:
        return "+" + digits
    if digits.startswith("225") and len(digits) == 13:
        return "+" + digits
    if len(digits) == 8:
        return "+223" + digits
    if len(digits) == 10 and digits.startswith("0"):
        return "+225" + digits
    if default_country == "225" and len(digits) == 10:
        return "+225" + digits
    return "+" + default_country + digits


def import_calls(entries, line=None, site=None, imported_by=None):
    """Importe un lot du journal collecteur (APK entreprise).

    - lots ≤ 500 (contrôlé aussi côté vue), `external_id` idempotent.
    - normalisation +223/+225 selon le pays de la ligne (défaut Mali).
    - rattache chaque appel à sa ligne, au site de la ligne (ou au site de
      l'importateur en repli) et au compte qui a remonté le lot.
    - met à jour `line.last_sync` en cas de succès.
    - auto-correction : si la durée définitive arrive après un 0 s
      (synchro pendant l'appel), elle écrase l'ancienne valeur. Les
      métadonnées manquantes d'un appel déjà connu sont complétées.
    Retourne (created, skipped, updated, fresh) où fresh liste les créés
    (téléphone + direction, 20 max) pour les notifications natives.
    """
    from django.utils import timezone as _tz

    if len(entries) > 500:
        raise TelephonyError("Lot limité à 500 appels.")
    default_country = "223"
    if line is not None and line.number.startswith("+225"):
        default_country = "225"
    call_site = line.site if line is not None and line.site_id else site
    created, skipped, updated = 0, 0, 0
    fresh = []
    for e in entries:
        direction = e.get("direction", "")
        if direction not in ("inbound", "outbound", "missed"):
            raise TelephonyError("Direction invalide (entrant, sortant, manqué).")
        raw_phone = str(e.get("phone_number", ""))
        if not raw_phone:
            raise TelephonyError("Numéro requis.")
        phone = normalize_phone(raw_phone, default_country=default_country)
        external_id = str(e.get("external_id", ""))
        if not external_id:
            raise TelephonyError("external_id requis (idempotence).")
        started_at = e.get("started_at")
        if started_at is None:
            raise TelephonyError("started_at requis.")
        duration = int(e.get("duration_seconds", 0) or 0)
        obj, was_created = CallLog.objects.get_or_create(
            external_id=external_id,
            defaults={
                "direction": direction,
                "phone_number": phone,
                "started_at": started_at,
                "duration_seconds": duration,
                "source": "android_app",
                "line": line,
                "site": call_site,
                "imported_by": imported_by,
            },
        )
        if was_created:
            created += 1
            if len(fresh) < 20:
                fresh.append({"phone_number": phone, "direction": direction})
            continue
        changed = []
        if duration > obj.duration_seconds:
            obj.duration_seconds = duration
            changed.append("duration_seconds")
        if obj.line_id is None and line is not None:
            obj.line = line
            changed.append("line")
        if obj.site_id is None and call_site is not None:
            obj.site = call_site
            changed.append("site")
        if obj.imported_by_id is None and imported_by is not None:
            obj.imported_by = imported_by
            changed.append("imported_by")
        if changed:
            obj.save(update_fields=changed)
            updated += 1
        else:
            skipped += 1
    if line is not None and (created or updated):
        line.last_sync = _tz.now()
        line.save(update_fields=["last_sync"])
    return created, skipped, updated, fresh


def reconcile_call(call_id, window_hours=24):
    """Rapproche un appel d'une réservation ; sinon crée une anomalie persistante."""
    from bookings.models import Booking

    call = CallLog.objects.get(pk=call_id)
    phone = normalize_phone(call.phone_number)
    start = call.started_at - timedelta(hours=window_hours)
    end = call.started_at + timedelta(hours=window_hours)
    filters = {"customer__phone": phone, "created_at__range": (start, end)}
    if call.site_id:
        filters["slot__activity__site_id"] = call.site_id
    booking = (
        Booking.objects.filter(**filters).order_by("created_at").first()
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
