"""ViewSets API tranche 7 : services métier seuls, rôles vérifiés serveur."""

from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from bookings.models import Booking, BookingEvent
from bookings.services import BookingError, create_booking, transition
from catalogue.models import Activity, Site, Slot
from clients.models import Customer
from comms.models import Message
from comms.services import log_whatsapp, wa_me_link
from common.permissions import AdminRoles, AgentRoles, CashRoles, GuideRoles, ManagerRoles
from common.serializers import (
    ActivitySerializer,
    BookingEventSerializer,
    BookingSerializer,
    CallAnomalySerializer,
    CallLogSerializer,
    CustomerSerializer,
    DailyClosingSerializer,
    InvoiceSerializer,
    MessageSerializer,
    PaymentLinkSerializer,
    PaymentSerializer,
    SiteSerializer,
    SlotSerializer,
    UserSerializer,
)
from payments.services import (
    PaymentError,
    create_payment_link,
    handle_webhook,
    issue_invoice,
    record_cash_balance,
)
from telephony.models import CallAnomaly, CallLog, DailyClosing
from telephony.services import TelephonyError, daily_closing, reconcile_call, resolve_anomaly


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    permission_classes = [AgentRoles]


class CatalogueViewSetMixin:
    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return [ManagerRoles()]


class SiteViewSet(CatalogueViewSetMixin, viewsets.ModelViewSet):
    queryset = Site.objects.all()
    serializer_class = SiteSerializer


class ActivityViewSet(CatalogueViewSetMixin, viewsets.ModelViewSet):
    queryset = Activity.objects.all()
    serializer_class = ActivitySerializer


class SlotViewSet(CatalogueViewSetMixin, viewsets.ModelViewSet):
    queryset = Slot.objects.all()
    serializer_class = SlotSerializer


class BookingViewSet(viewsets.ModelViewSet):
    queryset = Booking.objects.all().order_by("-created_at")
    serializer_class = BookingSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action == "create":
            return [AgentRoles()]
        if self.action == "check_in":
            return [GuideRoles()]
        return [IsAuthenticated()]

    def create(self, request, *args, **kwargs):
        try:
            b = create_booking(
                customer=Customer.objects.get(pk=request.data["customer"]),
                slot_id=request.data["slot"],
                persons=int(request.data.get("persons", 1)),
                quads=int(request.data.get("quads", 1)),
                source=request.data.get("source", "phone"),
                created_by=request.user,
            )
        except (KeyError, Customer.DoesNotExist):
            return Response({"detail": "Client ou créneau invalide."}, status=400)
        except BookingError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(BookingSerializer(b).data, status=201)

    def _act(self, request, pk, to_status, need_reason=False):
        try:
            b = transition(
                booking_id=pk, to_status=to_status, actor=request.user,
                reason=request.data.get("reason", ""),
            )
        except BookingError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(BookingSerializer(b).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        if not request.user.role in ("agent", "responsable", "admin") and not request.user.is_superuser:
            return Response({"detail": "Non autorisé."}, status=403)
        return self._act(request, pk, Booking.CANCELLED, need_reason=True)

    @action(detail=True, methods=["post"])
    def check_in(self, request, pk=None):
        return self._act(request, pk, Booking.CHECKED_IN)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return self._act(request, pk, Booking.COMPLETED)

    @action(detail=True, methods=["post"])
    def no_show(self, request, pk=None):
        return self._act(request, pk, Booking.NO_SHOW)

    @action(detail=True, methods=["post"])
    def expire(self, request, pk=None):
        return self._act(request, pk, Booking.EXPIRED)


class BookingEventViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = BookingEvent.objects.all()
    serializer_class = BookingEventSerializer
    permission_classes = [IsAuthenticated]


class PaymentView(APIView):
    permission_classes = [AgentRoles]

    def post(self, request):
        try:
            link = create_payment_link(booking_id=request.data["booking"])
        except (KeyError, PaymentError, Booking.DoesNotExist) as e:
            return Response({"detail": str(e)}, status=400)
        return Response(PaymentLinkSerializer(link).data, status=201)


class WebhookView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            payment, created = handle_webhook(
                provider=request.data.get("provider", "stub"),
                reference=request.data["reference"],
                amount=int(request.data["amount"]),
                raw=request.data.get("raw", {}),
                signature_valid=request.data.get("signature_valid", True),
            )
        except (KeyError, PaymentError) as e:
            return Response({"detail": str(e)}, status=400)
        return Response({"created": created, "payment": PaymentSerializer(payment).data})


class CashView(APIView):
    permission_classes = [CashRoles]

    def post(self, request):
        try:
            payment, created = record_cash_balance(
                booking_id=request.data["booking"], amount=int(request.data["amount"]),
                received_by=request.user,
            )
        except (KeyError, PaymentError) as e:
            return Response({"detail": str(e)}, status=400)
        return Response({"created": created, "payment": PaymentSerializer(payment).data})


class InvoiceView(APIView):
    permission_classes = [AgentRoles]

    def post(self, request):
        try:
            inv = issue_invoice(booking_id=request.data["booking"])
        except Exception as e:
            return Response({"detail": str(e)}, status=400)
        return Response(InvoiceSerializer(inv).data, status=201)


class MessageViewSet(mixins.CreateModelMixin, mixins.ListModelMixin,
                     mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Message.objects.all()
    serializer_class = MessageSerializer
    permission_classes = [AgentRoles]

    def create(self, request, *args, **kwargs):
        booking = Booking.objects.filter(pk=request.data.get("booking")).first()
        text = request.data.get("text", "")
        if not text or booking is None:
            return Response({"detail": "Réservation et texte requis."}, status=400)
        msg = log_whatsapp(booking=booking, text=text, sent_by=request.user)
        wa_link = wa_me_link(booking.customer.phone, text)
        return Response({**MessageSerializer(msg).data, "wa_me": wa_link}, status=201)


class CallLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = CallLog.objects.all()
    serializer_class = CallLogSerializer
    permission_classes = [AgentRoles]

    @action(detail=True, methods=["post"])
    def reconcile(self, request, pk=None):
        booking, anomaly = reconcile_call(pk)
        return Response({
            "booking": BookingSerializer(booking).data if booking else None,
            "anomaly": CallAnomalySerializer(anomaly).data if anomaly else None,
        })


class AnomalyViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = CallAnomaly.objects.all()
    serializer_class = CallAnomalySerializer
    permission_classes = [ManagerRoles]

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        try:
            anomaly = resolve_anomaly(pk, request.data.get("reason", ""),
                                      resolved_by=request.user,
                                      comment=request.data.get("comment", ""))
        except TelephonyError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(CallAnomalySerializer(anomaly).data)


class ClosingView(APIView):
    permission_classes = [ManagerRoles]

    def post(self, request):
        closing = daily_closing(request.data.get("date", timezone.now().date()),
                                validated_by=request.user)
        return Response(DailyClosingSerializer(closing).data, status=201)
