"""Services comms P1 : gabarit FR (vouvoiement) + lien wa.me + journalisation."""

import urllib.parse
from zoneinfo import ZoneInfo

from django.utils import timezone

from comms.models import Message

BAMAKO = ZoneInfo("Africa/Bamako")


def fcfa(n):
    return f"{int(n):,}".replace(",", " ") + " FCFA"


def wa_me_link(phone_e164, text):
    digits = "".join(c for c in phone_e164 if c.isdigit())
    return f"https://wa.me/{digits}?text={urllib.parse.quote(text)}"


def booking_payment_text(*, booking, pay_reference="", invoice_number=None):
    start = booking.slot.start.astimezone(BAMAKO)
    date = start.strftime("%a %d/%m/%Y %H:%M").replace("Sat", "Sam.")
    lieu = booking.slot.activity.site.name
    lines = [
        f"Bonjour, votre réservation {booking.code} est en attente d'acompte.",
        f"Créneau : {booking.slot.activity.name}, {date}, {lieu}.",
        f"Personnes : {booking.persons}, Total : {fcfa(booking.total)}, Acompte : {fcfa(booking.deposit_due)}.",
    ]
    if pay_reference:
        lines.append(f"Lien de paiement : pay://stub/{pay_reference}.")
    if invoice_number is not None:
        lines.append(f"Facture n°{invoice_number:06d}.")
    lines.append("Merci de votre confiance, BKO Quad.")
    return "\n".join(lines)


def log_whatsapp(*, booking, text, sent_by=None, template="booking_payment", provider_ref=""):
    return Message.objects.create(
        booking=booking, channel="whatsapp_link", template=template,
        text=text, status="sent", sent_by=sent_by, provider_ref=provider_ref,
    )
