"""Comms P1 : journal de tous les envois (wa.me + SMS repli). API WhatsApp Business = phase 2."""

from django.conf import settings
from django.db import models


class Message(models.Model):
    CHANNEL_CHOICES = [
        ("whatsapp_link", "Lien WhatsApp (wa.me)"),
        ("sms", "SMS de repli"),
    ]
    STATUS_CHOICES = [("sent", "Envoyé"), ("failed", "Échoué")]

    booking = models.ForeignKey(
        "bookings.Booking", null=True, blank=True, on_delete=models.SET_NULL, related_name="messages"
    )
    channel = models.CharField(max_length=15, choices=CHANNEL_CHOICES, default="whatsapp_link")
    template = models.CharField(max_length=50, default="booking_payment")
    text = models.TextField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="sent")
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="messages"
    )
    provider_ref = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.channel} {self.created_at:%d/%m %H:%M}"
