"""Services paiements : webhook seul passe à payé/confirmé, idempotent, facture sans trou (G)."""

from datetime import timedelta

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from bookings.models import Booking
from bookings.services import transition as booking_transition
from common.models import next_invoice_number
from finance.models import CashbookEntry
from finance.services import record_payment_entry
from payments.adapters import get_adapter
from payments.models import Invoice, Payment, PaymentLink


class PaymentError(ValueError):
    pass


def create_payment_link(*, booking_id, amount=None, provider="stub"):
    adapter = get_adapter(provider)
    with transaction.atomic():
        booking = Booking.objects.select_for_update().get(pk=booking_id)
        if booking.status != Booking.PENDING_DEPOSIT:
            raise PaymentError("Lien possible seulement en attente d'acompte.")
        amount = amount if amount is not None else booking.deposit_due
        if amount <= 0:
            raise PaymentError("Montant invalide.")
        expires_at = timezone.now() + timedelta(hours=24)
        res = adapter.create_link(booking_code=booking.code, amount=amount, expires_at=expires_at)
        link = PaymentLink.objects.create(
            booking=booking, provider=provider, reference=res.reference,
            amount=amount, expires_at=expires_at,
        )
        return link


def handle_webhook(*, provider, reference, amount, raw=None, signature="", signature_valid=True):
    """Idempotent : même référence deux fois = un seul paiement, sans erreur."""
    if not signature_valid:
        raise PaymentError("Signature webhook invalide.")
    with transaction.atomic():
        existing = Payment.objects.filter(reference=reference).first()
        if existing:
            return existing, False
        link = PaymentLink.objects.select_for_update().filter(reference=reference, provider=provider).first()
        if link is None:
            raise PaymentError("Référence de lien inconnue.")
        if link.status == "paid":
            raise PaymentError("Lien déjà payé.")
        if link.amount != amount:
            raise PaymentError("Montant ne correspond pas au lien.")
        link.status = "paid"
        link.save(update_fields=["status"])
        payment = Payment.objects.create(
            booking=link.booking, nature="deposit", mode="aggregator",
            amount=amount, reference=reference, status="paid",
            paid_at=timezone.now(), raw_payload=raw or {},
        )
        booking_transition(
            booking_id=link.booking_id, to_status=Booking.CONFIRMED, via_webhook=True,
        )
        if not CashbookEntry.objects.filter(payment=payment).exists():
            record_payment_entry(payment)
        _auto_invoice(link.booking_id)
        return payment, True


def _code_part(value, length, fallback="X"):
    import unicodedata

    ascii_only = unicodedata.normalize("NFKD", str(value).upper()).encode("ascii", "ignore").decode()
    keep = "".join(c for c in ascii_only if c.isalnum())
    return (keep or fallback)[:length]


def document_ref(booking, seq):
    """Référence affichée facture/reçu : BKO-{SITE}-{CLIENT}-{JJMMAAAA}-{NNNN}.
    Compteur unique partagé (scope « document ») : jamais deux fois le même numéro."""
    slot = booking.slot
    site = _code_part(slot.activity.site.name, 12, "BKO")
    client = _code_part(booking.customer.name, 8, "CLIENT")
    day = timezone.localdate()
    return f"BKO-{site}-{client}-{day:%d%m%Y}-{seq:04d}"


def _paid_total(booking_id):
    return Payment.objects.filter(booking_id=booking_id, status="paid") \
        .aggregate(s=Sum("amount"))["s"] or 0


def _auto_invoice(booking_id):
    """Facture automatique : paiement instantané à BKO Quad.

    Dès que le total de la réservation est couvert par un encaissement
    (espèces ou webhook aggrégateur), la facture reçoit son numéro
    séquentiel sans trou, sous la même transaction. Idempotent : une
    facture unique par réservation ; émission manuelle toujours possible
    (anciens reçus, corrections)."""
    paid = _paid_total(booking_id)
    total = Booking.objects.filter(pk=booking_id).values_list("total", flat=True).first()
    if total is None or paid < total:
        return
    issue_invoice(booking_id=booking_id)


def record_cash_payment(*, booking_id, amount, nature="balance", received_by=None):
    """Encaissement espèces unique : une facture = un seul versement du total.
    Le versement complet confirme la réservation en attente (événement tracé).
    Tout est vérifié sous verrou (deux clics rapprochés = un seul encaissement)."""
    if nature not in ("deposit", "balance"):
        raise PaymentError("Nature invalide (acompte ou solde).")
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        raise PaymentError("Montant invalide.")
    if amount <= 0:
        raise PaymentError("Montant invalide.")
    with transaction.atomic():
        try:
            booking = Booking.objects.select_for_update().select_related(
                "customer", "slot__activity__site").get(pk=booking_id)
        except Booking.DoesNotExist:
            raise PaymentError("Réservation introuvable.")
        if nature == "deposit" and booking.status != Booking.PENDING_DEPOSIT:
            raise PaymentError("Acompte espèces possible seulement en attente d'acompte.")
        if nature == "balance" and booking.status not in (Booking.CONFIRMED, Booking.CHECKED_IN):
            raise PaymentError("Solde possible seulement si confirmée ou arrivée validée.")
        if Payment.objects.filter(booking=booking, status="paid").exists():
            raise PaymentError("Réservation déjà encaissée : un seul encaissement par facture.")
        if amount != booking.total:
            raise PaymentError(f"Encaissement unique : versez le total ({booking.total} FCFA).")
        seq = next_invoice_number("document")
        ref = document_ref(booking, seq)
        payment = Payment.objects.create(
            booking=booking, nature=nature, mode="cash", amount=amount,
            reference=ref, status="paid", received_by=received_by, paid_at=timezone.now(),
        )
        record_payment_entry(payment)
        if nature == "deposit":
            total = Payment.objects.filter(
                booking=booking, nature="deposit", status="paid"
            ).aggregate(s=Sum("amount"))["s"] or 0
            # Sans acompte (deposit_due = 0), le paiement complet confirme.
            threshold = booking.deposit_due if booking.deposit_due > 0 else booking.total
            if total >= threshold:
                booking_transition(
                    booking_id=booking.id, to_status=Booking.CONFIRMED,
                    actor=received_by, reason="Paiement espèces encaissé", via_cash=True,
                )
                booking.refresh_from_db()
        _auto_invoice(booking.id)
    return payment, booking


def record_cash_balance(*, booking_id, amount, received_by=None):
    """Solde espèces à l'arrivée : écriture tracée, pas de webhook."""
    from bookings.services import BookingError as _BE

    try:
        booking = Booking.objects.get(pk=booking_id)
    except Booking.DoesNotExist:
        raise PaymentError("Réservation introuvable.")
    if booking.status not in (Booking.CONFIRMED, Booking.CHECKED_IN):
        raise PaymentError("Solde possible seulement si confirmée ou arrivée validée.")
    ref = f"CASH-{booking.code}-{amount}"
    payment, created = Payment.objects.get_or_create(
        reference=ref,
        defaults={"booking": booking, "nature": "balance", "mode": "cash",
                  "amount": amount, "status": "paid",
                  "received_by": received_by, "paid_at": timezone.now()},
    )
    if created:
        _auto_invoice(booking.id)
    return payment, created


def issue_invoice(*, booking_id):
    """Une seule facture par réservation (renvoie l'existante, sans nouveau numéro)."""
    with transaction.atomic():
        booking = Booking.objects.select_for_update().get(pk=booking_id)
        existing = Invoice.objects.filter(booking=booking).order_by("id").first()
        if existing:
            return existing, False
        number = next_invoice_number("document")
        return Invoice.objects.create(booking=booking, number=number), True
