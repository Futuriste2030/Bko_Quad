"""Services audit + expiration auto (tâche Celery à brancher sur expire_overdue)."""

from datetime import date

from django.db.models import Sum
from django.utils import timezone


def log_action(*, actor=None, action, entity, before=None, after=None, ip=""):
    from audit.models import AuditLog

    return AuditLog.objects.create(
        actor=actor, action=action, entity=entity,
        before=before or {}, after=after or {}, ip=ip,
    )


def expire_overdue():
    """Réservations en attente d'acompte past expires_at -> expirées + événement."""
    from bookings.models import Booking
    from bookings.services import transition

    now = timezone.now()
    count = 0
    for b in Booking.objects.filter(status=Booking.PENDING_DEPOSIT, expires_at__lt=now):
        transition(booking_id=b.id, to_status=Booking.EXPIRED)
        count += 1
    return count


def weekly_report(year, week, recipients=""):
    from audit.models import WeeklyReport
    from bookings.models import Booking
    from payments.models import Payment
    from telephony.models import CallAnomaly

    iso_start = date.fromisocalendar(year, week, 1)
    bookings = Booking.objects.filter(created_at__date__gte=iso_start).count()
    amount = Payment.objects.filter(status="paid").aggregate(s=Sum("amount"))["s"] or 0
    anomalies = CallAnomaly.objects.filter(status="open").count()
    content = {"bookings": bookings, "amount_collected": amount, "anomalies_open": anomalies}
    report, _ = WeeklyReport.objects.update_or_create(
        year=year, week=week, defaults={"content": content, "recipients": recipients})
    return report
