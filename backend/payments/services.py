"""Services paiements : webhook seul passe à payé/confirmé, idempotent, facture sans trou (G)."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from bookings.models import Booking
from bookings.services import transition as booking_transition
from common.models import next_invoice_number
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
        return payment, True


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
    return payment, created


def issue_invoice(*, booking_id):
    with transaction.atomic():
        booking = Booking.objects.select_for_update().get(pk=booking_id)
        number = next_invoice_number("invoice")
        return Invoice.objects.create(booking=booking, number=number)
