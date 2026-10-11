"""Serializers API tranche 7."""

from rest_framework import serializers

from accounts.models import User
from bookings.models import Booking, BookingEvent
from catalogue.models import Activity, Site, Slot
from clients.models import Customer
from comms.models import Message
from payments.models import Invoice, Payment, PaymentLink
from telephony.models import CallAnomaly, CallLog, DailyClosing


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "phone", "role", "totp_enabled"]


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "name", "phone", "whatsapp", "email", "notes", "created_at"]


class SiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = ["id", "name", "city"]


class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Activity
        fields = ["id", "site", "name", "duration_minutes", "base_price", "deposit", "max_group"]


class SlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = Slot
        fields = ["id", "activity", "start", "end", "capacity", "closed"]


class BookingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = ["id", "code", "customer", "slot", "persons", "quads", "unit_price",
                  "total", "deposit_due", "status", "source", "expires_at", "qr_token", "cancel_reason"]
        read_only_fields = ["code", "unit_price", "total", "deposit_due", "status", "expires_at", "qr_token"]


class BookingEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookingEvent
        fields = ["id", "booking", "actor", "action", "before", "after", "created_at"]


class PaymentLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentLink
        fields = ["id", "booking", "provider", "reference", "amount", "status", "expires_at"]
        read_only_fields = ["reference", "status", "expires_at"]


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "booking", "nature", "mode", "amount", "reference", "status", "paid_at"]


class InvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ["id", "booking", "number", "issued_at"]


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "booking", "channel", "template", "text", "status", "provider_ref"]


class CallLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = CallLog
        fields = ["id", "direction", "phone_number", "started_at", "duration_seconds", "source", "external_id"]


class CallAnomalySerializer(serializers.ModelSerializer):
    class Meta:
        model = CallAnomaly
        fields = ["id", "call", "status", "reason", "comment", "resolved_at"]


class DailyClosingSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyClosing
        fields = ["id", "date", "bookings_count", "amount_collected", "calls_count", "anomalies_open"]
