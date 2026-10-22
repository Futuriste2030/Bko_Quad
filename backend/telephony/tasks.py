"""Clôture automatique de la journée (20h00, fuseau Africa/Bamako — décision I).

Les activités se terminent en journée : à 20h00 le Hub génère le bordereau du
jour sans intervention. L'écran /cloture est devenu consultatif.
"""

from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

CATCHUP_DAYS = 7


@shared_task(name="telephony.close_day")
def close_day():
    """Clôture les jours dus, sans jamais écrasser un bordereau existant.

    - aujourd'hui : seulement à partir de `BKO_CLOSING_HOUR` (20h00) ;
    - jours antérieurs non clôturés (serveur à l'arrêt) : rattrapage sur 7 jours.

    Renvoie la liste ISO des dates clôturées par cet appel (vide si rien à faire).
    """
    from telephony.models import DailyClosing
    from telephony.services import daily_closing

    now = timezone.localtime()
    today = now.date()
    oldest = today - timedelta(days=CATCHUP_DAYS)
    already = set(
        DailyClosing.objects.filter(date__gte=oldest, date__lte=today)
        .values_list("date", flat=True)
    )

    closed = []
    for offset in range(CATCHUP_DAYS, -1, -1):
        day = today - timedelta(days=offset)
        if day in already:
            continue
        if day == today and now.hour < settings.BKO_CLOSING_HOUR:
            continue
        daily_closing(day)
        closed.append(day.isoformat())
    return closed
