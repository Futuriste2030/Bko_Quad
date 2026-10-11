"""Services caisse : bordereau auto, solde jamais négatif, verrou après clôture."""

from datetime import date

from django.db import transaction
from django.db.models import Sum

from finance.models import CashbookEntry, MonthlyClosing


class FinanceError(ValueError):
    pass


def month_bounds(day):
    return date(day.year, day.month, 1)


def month_balance(day):
    """Solde courant = ouverture + recettes − dépenses (jamais de saisie libre)."""
    first = month_bounds(day)
    try:
        opening = MonthlyClosing.objects.get(month=first).opening
    except MonthlyClosing.DoesNotExist:
        opening = 0
    agg = CashbookEntry.objects.filter(date__year=day.year, date__month=day.month).aggregate(
        inn=Sum("amount", filter=models_Q_in()),
        out=Sum("amount", filter=models_Q_out()),
    )
    return opening + (agg["inn"] or 0) - (agg["out"] or 0)


def models_Q_in():
    from django.db.models import Q

    return Q(direction=CashbookEntry.IN)


def models_Q_out():
    from django.db.models import Q

    return Q(direction=CashbookEntry.OUT)


def next_voucher(day):
    prefix = f"{day.year}{day.month:02d}-"
    last = (
        CashbookEntry.objects.filter(voucher__startswith=prefix)
        .order_by("-voucher").values_list("voucher", flat=True).first()
    )
    n = int(last.split("-")[1]) + 1 if last else 1
    return f"{prefix}{n:03d}"


def add_entry(*, day, category, label, direction, amount, created_by=None,
              site=None, account=None, payment=None, booking=None,
              employee_name="", receipt=""):
    if amount <= 0:
        raise FinanceError("Montant invalide.")
    if direction not in (CashbookEntry.IN, CashbookEntry.OUT):
        raise FinanceError("Sens invalide.")
    with transaction.atomic():
        if MonthlyClosing.objects.filter(month=month_bounds(day)).exists():
            raise FinanceError("Mois clos : écriture impossible.")
        if direction == CashbookEntry.OUT and month_balance(day) - amount < 0:
            raise FinanceError("Sortie refusée : solde deviendrait négatif, alerte direction.")
        entry = CashbookEntry.objects.create(
            date=day, site=site, category=category, label=label,
            voucher=next_voucher(day), direction=direction, amount=amount,
            account=account, payment=payment, booking=booking,
            employee_name=employee_name, receipt=receipt, created_by=created_by,
        )
        return entry


def record_payment_entry(payment):
    """Recette depuis le paiement, jamais saisie libre."""
    return add_entry(
        day=payment.paid_at.date() if payment.paid_at else date.today(),
        category="recette_reservation", label=f"Encaissement {payment.reference}",
        direction=CashbookEntry.IN, amount=payment.amount,
        booking=payment.booking, payment=payment,
        created_by=payment.received_by,
    )


def close_month(year, month):
    first = date(year, month, 1)
    with transaction.atomic():
        opening = 0
        prev = MonthlyClosing.objects.filter(month__lt=first).order_by("-month").first()
        if prev:
            opening = prev.closing
        else:
            old = MonthlyClosing.objects.filter(month=first).first()
            if old:
                opening = old.opening
        agg = CashbookEntry.objects.filter(date__year=year, date__month=month).aggregate(
            inn=Sum("amount", filter=models_Q_in()),
            out=Sum("amount", filter=models_Q_out()),
        )
        closing_val = opening + (agg["inn"] or 0) - (agg["out"] or 0)
        closing, _ = MonthlyClosing.objects.update_or_create(
            month=first, defaults={"opening": opening, "closing": closing_val})
        CashbookEntry.objects.filter(date__year=year, date__month=month).update(locked=True)
        return closing
