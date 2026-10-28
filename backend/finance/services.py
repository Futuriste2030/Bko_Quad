"""Services caisse : bordereau auto, solde jamais négatif, verrou après clôture."""

from datetime import date

from django.db import transaction
from django.db.models import Sum

from finance.models import BankTransaction, CashbookEntry, MonthlyClosing


class FinanceError(ValueError):
    pass


def month_bounds(day):
    return date(day.year, day.month, 1)


def _site_id(site):
    if site is None:
        return None
    return getattr(site, "id", site)


def month_balance(day, site=None):
    """Solde courant = ouverture + recettes − dépenses (jamais de saisie libre).

    Par site : solde cumulé des écritures rattachées à ce site (rapport de
    site), avec report automatique des mois précédents. Sans site : solde réel
    de la caisse (ouverture reportée par clôture, sinon cumul historique).
    """
    first = month_bounds(day)
    sid = _site_id(site)
    base_qs = CashbookEntry.objects.all()
    if sid is not None:
        base_qs = base_qs.filter(site_id=sid)
    # Report automatique : l'ouverture est toujours le cumul des écritures
    # antérieures (indépendamment des clôtures), pour ne jamais perdre un
    # solde non utilisé d'un mois précédent.
    prior = base_qs.filter(date__lt=first).aggregate(
        inn=Sum("amount", filter=models_Q_in()),
        out=Sum("amount", filter=models_Q_out()),
    )
    opening = (prior["inn"] or 0) - (prior["out"] or 0)
    agg = base_qs.filter(date__year=day.year, date__month=day.month).aggregate(
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
    # Anti-doublon : même catégorie, libellé, montant et mois (et site)
    # ne peuvent être enregistrés deux fois (évite les doubles clics).
    from django.db.models import Q
    dup_qs = CashbookEntry.objects.filter(
        date__year=day.year, date__month=day.month,
        category=category, label=label, amount=amount,
        direction=direction,
    )
    sid = _site_id(site)
    if sid is not None:
        dup_qs = dup_qs.filter(site_id=sid)
    else:
        dup_qs = dup_qs.filter(site__isnull=True)
    if dup_qs.exists():
        raise FinanceError(
            "Écriture déjà enregistrée pour ce mois "
            "(même catégorie, libellé et montant). Vérifiez la Caisse "
            "ou modifiez l'écriture existante.")
    with transaction.atomic():
        if MonthlyClosing.objects.filter(month=month_bounds(day)).exists():
            raise FinanceError("Mois clos : écriture impossible.")
        bal = month_balance(day, site=site)
        if direction == CashbookEntry.OUT and bal - amount < 0:
            raise FinanceError(
                f"Sortie refusée : solde de la caisse "
                f"({bal} FCFA) insuffisant pour "
                f"{amount} FCFA. Enregistrez d'abord une recette "
                f"(entrée) ou réduisez le montant.")
        entry = CashbookEntry.objects.create(
            date=day, site=site, category=category, label=label,
            voucher=next_voucher(day), direction=direction, amount=amount,
            account=account, payment=payment, booking=booking,
            employee_name=employee_name, receipt=receipt, created_by=created_by,
        )
        return entry


def record_payment_entry(payment):
    """Recette depuis le paiement, jamais saisie libre.

    Le site est repris de la réservation : sans lui, la recette automatique
    échapperait au filtre par site de la caisse.
    """
    booking = payment.booking
    site = None
    if booking is not None and booking.slot_id:
        site = booking.slot.activity.site
    return add_entry(
        day=payment.paid_at.date() if payment.paid_at else date.today(),
        category="recette_reservation", label=f"Encaissement {payment.reference}",
        direction=CashbookEntry.IN, amount=payment.amount,
        site=site, booking=booking, payment=payment,
        created_by=payment.received_by,
    )


def close_month(year, month):
    first = date(year, month, 1)
    with transaction.atomic():
        prior = CashbookEntry.objects.filter(date__lt=first).aggregate(
            inn=Sum("amount", filter=models_Q_in()),
            out=Sum("amount", filter=models_Q_out()),
        )
        opening = (prior["inn"] or 0) - (prior["out"] or 0)
        agg = CashbookEntry.objects.filter(date__year=year, date__month=month).aggregate(
            inn=Sum("amount", filter=models_Q_in()),
            out=Sum("amount", filter=models_Q_out()),
        )
        closing_val = opening + (agg["inn"] or 0) - (agg["out"] or 0)
        closing, _ = MonthlyClosing.objects.update_or_create(
            month=first, defaults={"opening": opening, "closing": closing_val})
        CashbookEntry.objects.filter(date__year=year, date__month=month).update(locked=True)
        return closing


# --- Banque (compte distinct de la caisse) -----------------------------------

def bank_balance(site=None):
    """Solde bancaire = versements − retraits (jamais de saisie libre).

    Sans site : solde réel du compte unique. Avec site : cumul des
    mouvements rattachés à ce site (rapport de site).
    """
    qs = BankTransaction.objects.all()
    if site is not None:
        qs = qs.filter(site_id=site)
    agg = qs.aggregate(
        dep=Sum("amount", filter=models_Q_bank_in()),
        ret=Sum("amount", filter=models_Q_bank_out()),
    )
    return (agg["dep"] or 0) - (agg["ret"] or 0)


def models_Q_bank_in():
    from django.db.models import Q

    return Q(type__in=(BankTransaction.DEPOSIT, BankTransaction.TRANSFER))


def models_Q_bank_out():
    from django.db.models import Q

    return Q(type=BankTransaction.WITHDRAWAL)


def add_bank_transaction(*, type, day, reason, amount, first_name, last_name,
                         receipt_number="", check_number="", bank="",
                         counterparty_bank="", site=None, created_by=None):
    """Versement (bordereau requis), retrait (chèque/réf requis) ou
    virement reçu (sans référence : nom + banques).

    Banque BKO requise pour tous. Référence unique par type, retrait refusé
    si le solde deviendrait négatif. Le virement crédite (encaissement).
    """
    if type not in (BankTransaction.DEPOSIT, BankTransaction.WITHDRAWAL,
                    BankTransaction.TRANSFER):
        raise FinanceError("Type d'opération invalide (versement, retrait ou virement).")
    if amount is None or int(amount) <= 0:
        raise FinanceError("Montant invalide.")
    reason = str(reason or "").strip()
    first_name = str(first_name or "").strip()
    last_name = str(last_name or "").strip()
    receipt_number = str(receipt_number or "").strip()
    check_number = str(check_number or "").strip()
    bank = str(bank or "").strip()
    counterparty_bank = str(counterparty_bank or "").strip()
    if not reason:
        raise FinanceError("Motif requis.")
    if not bank:
        raise FinanceError("Banque BKO Quad requise.")
    if not first_name or (not last_name and type != BankTransaction.TRANSFER):
        raise FinanceError("Nom et prénom requis.")
    if type == BankTransaction.DEPOSIT:
        if not receipt_number:
            raise FinanceError("Numéro de bordereau requis pour un versement.")
        if BankTransaction.objects.filter(
                type=BankTransaction.DEPOSIT, receipt_number=receipt_number).exists():
            raise FinanceError("Bordereau déjà enregistré.")
    elif type == BankTransaction.WITHDRAWAL:
        if not check_number:
            raise FinanceError("Numéro de chèque / référence requis pour un retrait.")
        if BankTransaction.objects.filter(
                type=BankTransaction.WITHDRAWAL, check_number=check_number).exists():
            raise FinanceError("Chèque / référence déjà enregistré.")
    with transaction.atomic():
        if type == BankTransaction.WITHDRAWAL and bank_balance() - int(amount) < 0:
            raise FinanceError("Retrait refusé : solde bancaire deviendrait négatif, alerte direction.")
        tx = BankTransaction.objects.create(
            type=type, date=day, reason=reason, amount=int(amount),
            site=site,
            person_first_name=first_name, person_last_name=last_name,
            receipt_number=receipt_number, check_number=check_number,
            bank=bank, counterparty_bank=counterparty_bank,
            created_by=created_by,
        )
        return tx


def bank_month_rows(year, month, bank=None, site=None):
    """Lignes du mois triées + solde progressif (base = solde antérieur).

    Filtres optionnels par banque BKO et par site ; le solde progressif
    suit alors le périmètre filtré.
    """
    before_qs = BankTransaction.objects.filter(date__lt=date(year, month, 1))
    if bank:
        before_qs = before_qs.filter(bank=bank)
    if site is not None:
        before_qs = before_qs.filter(site_id=site)
    before = before_qs.aggregate(
        dep=Sum("amount", filter=models_Q_bank_in()),
        ret=Sum("amount", filter=models_Q_bank_out()),
    )
    running = (before["dep"] or 0) - (before["ret"] or 0)
    qs = BankTransaction.objects.filter(date__year=year, date__month=month)
    if bank:
        qs = qs.filter(bank=bank)
    if site is not None:
        qs = qs.filter(site_id=site)
    qs = qs.select_related("site")
    rows = []
    for tx in qs.order_by("date", "id"):
        credit = tx.amount if tx.type in (BankTransaction.DEPOSIT, BankTransaction.TRANSFER) else 0
        debit = tx.amount if tx.type == BankTransaction.WITHDRAWAL else 0
        running += credit - debit
        rows.append({"tx": tx, "credit": credit, "debit": debit, "running": running})
    return rows
