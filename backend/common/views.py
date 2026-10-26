"""ViewSets API tranche 7 : services métier seuls, rôles vérifiés serveur."""

from datetime import date

from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from accounts.models import User
from accounts.totp import otpauth_url, random_secret, verify as totp_verify
from bookings.models import Booking, BookingEvent
from bookings.services import (
    BookingError, create_booking, fleet_availability, is_velo_activity, transition,
)
from catalogue.models import Activity, Maintenance, Site, Slot, SparePart, Vehicle
from clients.models import Customer
from comms.models import Message, Notice
from comms.services import log_whatsapp, wa_me_link
from common.models import CompanyProfile
from common.permissions import (
    AdminRoles, AgentRoles, CashRoles, ClosingReadRoles, GuideRoles, ManagerRoles,
    SuperAdminRoles,
)
from common.serializers import (
    ActivitySerializer,
    BankTransactionSerializer,
    BookingEventSerializer,
    BookingSerializer,
    CallAnomalySerializer,
    CallLogSerializer,
    CashbookEntrySerializer,
    CompanySerializer,
    CustomerSerializer,
    DailyClosingSerializer,
    DocumentSignatureSerializer,
    EmployeeSerializer,
    ContractSerializer,
    HRLetterSerializer,
    HRUserDirectorySerializer,
    InvoiceSerializer,
    MaintenanceSerializer,
    MessageSerializer,
    NoticeSerializer,
    PaymentLinkSerializer,
    PaymentSerializer,
    PayrollSheetSerializer,
    PayslipLineSerializer,
    PayslipSerializer,
    SiteSerializer,
    SlotSerializer,
    SparePartSerializer,
    TrackedLineSerializer,
    UserAdminSerializer,
    UserSerializer,
    VehicleSerializer,
)
from finance.models import BankTransaction, CashbookEntry, MonthlyClosing
from finance.services import (
    FinanceError,
    add_bank_transaction,
    add_entry,
    bank_balance,
    bank_month_rows,
    month_balance,
    month_bounds,
)
from payroll.hr_services import (
    HRPermissionError,
    HRWorkflowError,
    employee_for_user,
    preview_pdf,
    send_document,
    sign_document,
    signed_pdf_bytes,
)
from payroll.models import (
    DRAFT, PENDING_SIGNATURE, SIGNED, Contract, Employee, HRLetter, PayrollSheet,
    Payslip,
)
from payroll.services import (
    PayrollError,
    add_payslip_line,
    close_sheet,
    delete_sheet,
    fill_team,
    generate_payslip,
    open_sheet,
    pay_payslip,
)
from payments.services import (
    PaymentError,
    create_payment_link,
    handle_webhook,
    issue_invoice,
    record_cash_balance,
    record_cash_payment,
)
from payments.models import Invoice, Payment
from telephony.models import CallAnomaly, CallLog, DailyClosing, TrackedLine
from telephony.services import TelephonyError, import_calls, reconcile_call, resolve_anomaly


class LoginView(APIView):
    """Connexion agence : mot de passe + code TOTP quand la 2FA est activée (F).

    Endpoint `auth/token/` identique (access + refresh) ; si le compte a
    activé sa double authentification, la réponse exige `otp` (6 chiffres)
    et portes le drapeau `totp_required` tant qu'il manque ou est faux.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        from django.contrib.auth import authenticate
        from rest_framework_simplejwt.tokens import RefreshToken

        user = authenticate(
            username=str(request.data.get("username", "")),
            password=str(request.data.get("password", "")),
        )
        if user is None or not user.is_active:
            return Response({"detail": "Identifiants invalides."}, status=401)
        if user.totp_enabled:
            code = str(request.data.get("otp", ""))
            if not code:
                return Response(
                    {"detail": "Code de double authentification requis.",
                     "totp_required": True},
                    status=401)
            if not totp_verify(user.totp_secret, code):
                return Response(
                    {"detail": "Code de double authentification invalide.",
                     "totp_required": True},
                    status=401)
        refresh = RefreshToken.for_user(user)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh)})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        """Profil : prénom, nom, téléphone (vérifié, unique)."""
        user = request.user
        first_name = str(request.data.get("first_name", user.first_name)).strip()
        last_name = str(request.data.get("last_name", user.last_name)).strip()
        phone = str(request.data.get("phone", user.phone)).strip()
        if not phone:
            return Response({"detail": "Numéro de téléphone requis."}, status=400)
        if User.objects.filter(phone=phone).exclude(pk=user.pk).exists():
            return Response({"detail": "Ce numéro est déjà utilisé."}, status=400)
        user.first_name = first_name[:30]
        user.last_name = last_name[:150]
        user.phone = phone
        user.save(update_fields=["first_name", "last_name", "phone"])
        return Response(UserSerializer(user).data)


class VersionView(APIView):
    """Version du Hub (fichier VERSION) : diagnostics et support pilote."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.conf import settings

        return Response({"version": settings.BKO_VERSION})


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all().select_related("site").order_by("name")
    serializer_class = CustomerSerializer
    permission_classes = [AgentRoles]

    def get_queryset(self):
        qs = super().get_queryset()
        site = requested_site(self.request)
        if site is None:
            return qs
        return qs.filter(
            Q(site_id=site) | Q(bookings__slot__activity__site_id=site)).distinct()

    def create(self, request, *args, **kwargs):
        """Client idempotent par telephone : un doublon renvoie la fiche existante.

        Un client est partage entre les sites (son `site` est indicatif) : un
        agent qui ressaisit un numero deja connu recupere l'identifiant sans
        ecraser la fiche ni son rattachement.
        """
        phone = str(request.data.get("phone") or "").strip()
        if phone:
            existing = Customer.objects.select_related("site").filter(phone=phone).first()
            if existing is not None:
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                self.perform_create(serializer)
        except IntegrityError:
            existing = Customer.objects.select_related("site").filter(phone=phone).first()
            if existing is None:
                raise
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        site = scoped_site(self.request.user)
        if site is not None:
            serializer.save(site_id=site)
            return
        context_site = requested_site(self.request)
        if context_site is not None and not serializer.validated_data.get("site"):
            serializer.save(site_id=context_site)
            return
        serializer.save()

    def perform_update(self, serializer):
        site = scoped_site(self.request.user)
        if site is not None:
            serializer.save(site_id=site)
            return
        serializer.save()


RESTRICTED_SITE_ROLES = ("agent", "guide", "responsable")
GLOBAL_SITE_ROLES = ("admin", "superadmin", "comptable")


def scoped_site(user):
    """Site impose aux roles de terrain (agent, guide, responsable).

    Renvoie l'id du site si l'utilisateur est de ces roles et qu'un site
    lui est affecte ; None sinon (admin, comptable, ou sans site). Le
    journal d'appels est filtre par le site de l'appel ; les clients
    restent universels par convention.
    """
    if not getattr(user, "is_authenticated", False):
        return None
    if getattr(user, "role", None) in RESTRICTED_SITE_ROLES and user.site_id:
        return user.site_id
    return None


def requested_site(request):
    """Site effectif d'une lecture : choix du profil transverse ou site impose.

    Les roles de terrain restent verrouilles sur leur site, quoi qu'ils
    passent en query string. Direction, super administrateur et comptable
    peuvent lire un site precis via `?site=<id>` ; sans parametre (ou avec
    `reseau`) ils voient tout le reseau.
    """
    user = getattr(request, "user", None)
    if not getattr(user, "is_authenticated", False):
        return None
    if getattr(user, "role", None) in RESTRICTED_SITE_ROLES:
        return user.site_id or None
    raw = (request.query_params.get("site") or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return None


def site_guard(user, obj, message="Hors de votre site."):
    """Refus 403 si `obj` n'appartient pas au site de l'utilisateur scope."""
    site = scoped_site(user)
    if site is None:
        return None
    obj_site = getattr(obj, "site_id", None)
    if obj_site is None:
        obj_site = obj.site_id if hasattr(obj, "site") else None
    if obj_site and obj_site != site:
        return Response({"detail": message}, status=403)
    return None


class SiteScopeMixin:
    """Filtre de lecture par site (roles de terrain + choix des profils globaux).

    Agent, guide et responsable sont verrouilles sur leur site. Direction,
    super administrateur et comptable filtrent via `?site=<id>` ; sans
    parametre ils voient le tout. Le mixin ne touche ni aux permissions ni
    au serializer.
    """

    site_lookup = "site"

    def get_queryset(self):
        qs = super().get_queryset()
        site = requested_site(self.request)
        if site is not None:
            qs = qs.filter(**{self.site_lookup: site})
        return qs


class CatalogueViewSetMixin:
    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return [ManagerRoles()]


class SiteViewSet(SiteScopeMixin, CatalogueViewSetMixin, viewsets.ModelViewSet):
    queryset = Site.objects.all()
    serializer_class = SiteSerializer
    site_lookup = "pk"

    def get_permissions(self):
        # Lecture publique (site web client) : sites et formules visibles sans auth.
        if self.action in ("list", "retrieve"):
            from rest_framework.permissions import AllowAny
            return [AllowAny()]
        return super().get_permissions()

    def destroy(self, request, *args, **kwargs):
        from django.db.models import ProtectedError

        site = self.get_object()
        # Suppression en cascade : formules (et leurs créneaux), engins,
        # pièces, maintenance du site. Les écritures comptables/bancaires sont
        # détachées (SET_NULL) par le modèle.
        try:
            from bookings.models import Booking
            if Booking.objects.filter(slot__activity__site=site).exists():
                return Response(
                    {"detail": "Site avec des réservations : annulez-les d'abord."},
                    status=400)
            from catalogue.models import Activity, Maintenance, Slot, SparePart, Vehicle
            Slot.objects.filter(activity__site=site).delete()
            Activity.objects.filter(site=site).delete()
            Maintenance.objects.filter(vehicle__site=site).delete()
            SparePart.objects.filter(site=site).delete()
            Vehicle.objects.filter(site=site).delete()
        except ProtectedError as e:
            return Response({"detail": str(e)}, status=400)
        return super().destroy(request, *args, **kwargs)


class ActivityViewSet(SiteScopeMixin, CatalogueViewSetMixin, viewsets.ModelViewSet):
    queryset = Activity.objects.all()
    serializer_class = ActivitySerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            from rest_framework.permissions import AllowAny
            return [AllowAny()]
        return super().get_permissions()

    def destroy(self, request, *args, **kwargs):
        from django.db.models import ProtectedError

        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Formule utilisée par des créneaux : supprimez d'abord les "
                           "créneaux libres, ou conservez-la pour l'historique."},
                status=400)


class SlotViewSet(SiteScopeMixin, CatalogueViewSetMixin, viewsets.ModelViewSet):
    queryset = Slot.objects.all()
    serializer_class = SlotSerializer
    site_lookup = "activity__site"

    def get_permissions(self):
        # Main libre aux agents : un créneau peut naître pendant la réservation.
        # Modification/suppression : responsables et admin seuls.
        if self.action == "create":
            return [AgentRoles()]
        return super().get_permissions()

    def destroy(self, request, *args, **kwargs):
        from bookings.models import Booking
        ACTIVE = ["pending_deposit", "confirmed", "checked_in"]
        slot = self.get_object()
        qs = Booking.objects.filter(slot=slot)
        if qs and qs.exclude(status__in=["cancelled", "no_show", "expired"]).exists():
            return Response(
                {"detail": "Ce créneau a des réservations en cours : annulez-les d'abord (motif tracé)."},
                status=400)
        if qs.exists():
            # Historique (annulées/absents/expirés) : conservé, jamais supprimé.
            return Response(
                {"detail": "Ce créneau porte un historique de réservations : il est conservé pour la piste d'audit."},
                status=400)
        return super().destroy(request, *args, **kwargs)


class BookingViewSet(SiteScopeMixin, viewsets.ModelViewSet):
    queryset = (Booking.objects.all()
                .select_related("customer", "slot__activity__site")
                .order_by("-created_at"))
    serializer_class = BookingSerializer
    site_lookup = "slot__activity__site"
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action == "create":
            return [AgentRoles()]
        if self.action == "check_in":
            return [GuideRoles()]
        return [IsAuthenticated()]

    @action(detail=False, methods=["get"])
    def availability(self, request):
        slot = (Slot.objects.select_related("activity__site")
                .filter(pk=request.query_params.get("slot")).first())
        if slot is None:
            return Response({"detail": "Créneau invalide."}, status=400)
        site = scoped_site(request.user)
        if site is not None and slot.activity.site_id != site:
            return Response({"detail": "Créneau hors de votre site."}, status=403)
        context_site = requested_site(request)
        if context_site is not None and slot.activity.site_id != context_site:
            return Response({"detail": "Créneau hors du site demandé."}, status=403)
        pricing = slot.activity
        activity_id = request.query_params.get("activity")
        if activity_id:
            pricing = Activity.objects.filter(pk=activity_id).first()
            if pricing is None or pricing.site_id != slot.activity.site_id:
                return Response({"detail": "Formule hors du site du créneau."}, status=400)
        resource_type = (
            Booking.RESOURCE_VELO if is_velo_activity(pricing.name)
            else Booking.RESOURCE_QUAD)
        data = fleet_availability(
            site=slot.activity.site, resource_type=resource_type,
            start=slot.start, end=slot.end)
        return Response({
            "slot": slot.id, "resource_type": resource_type,
            "total": data["total"], "used": data["used"], "free": data["free"],
        })

    def create(self, request, *args, **kwargs):
        site = requested_site(request)
        if site is not None:
            slot = Slot.objects.filter(pk=request.data.get("slot"),
                                       activity__site_id=site).first()
            if slot is None:
                return Response({"detail": "Creneau hors de votre site."}, status=403)
        raw_lines = request.data.get("lines", None)
        lines = None
        if raw_lines is not None:
            try:
                lines = [
                    {"persons": int(x.get("persons", 0)), "quads": int(x.get("quads", 0)),
                     "discount": int(x.get("discount", 0) or 0)}
                    for x in raw_lines
                ]
            except (ValueError, TypeError, AttributeError):
                return Response({"detail": "Lignes invalides (personnes et quads requis)."}, status=400)
        try:
            b = create_booking(
                customer=Customer.objects.get(pk=request.data["customer"]),
                slot_id=request.data["slot"],
                persons=int(request.data.get("persons", 1)),
                quads=int(request.data.get("quads", 1)),
                source=request.data.get("source", "phone"),
                created_by=request.user,
                activity_id=request.data.get("activity"),
                lines=lines,
                code=request.data.get("code"),
                offline_at=self._offline_at(request),
                offline_ref=str(request.data.get("offline_ref", "")
                               or request.headers.get("Idempotency-Key", ""))[:80],
            )
        except (KeyError, Customer.DoesNotExist):
            return Response({"detail": "Client ou créneau invalide."}, status=400)
        except BookingError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(BookingSerializer(b).data, status=201)

    @staticmethod
    def _offline_at(request):
        """J : heure de saisie hors ligne (appareil), tracée sur la réservation."""
        from django.utils.dateparse import parse_datetime

        raw = str(request.data.get("offline_at", "") or "").strip()
        if not raw:
            return None
        parsed = parse_datetime(raw)
        if parsed is None:
            return None
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed)
        return parsed

    def _act(self, request, pk, to_status, need_reason=False):
        try:
            b = transition(
                booking_id=pk, to_status=to_status, actor=request.user,
                reason=request.data.get("reason", ""),
            )
        except Booking.DoesNotExist:
            return self._out_of_site(pk)
        except BookingError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(BookingSerializer(b).data)

    def _out_of_site(self, pk):
        site = scoped_site(self.request.user)
        booking = Booking.objects.filter(pk=pk).first() if site is not None else None
        if booking is not None and booking.slot.activity.site_id != site:
            return Response({"detail": "Reservation hors de votre site."}, status=403)
        return Response({"detail": "Reservation introuvable."}, status=404)

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

    @action(detail=True, methods=["post"])
    def discount(self, request, pk=None):
        # Remise manuelle : moniteur, responsable ou admin. Motif obligatoire,
        # tracée. Interdite après encaissement (sinon remboursement à gérer).
        if not (request.user.is_superuser
                or getattr(request.user, "role", None) in ("guide", "responsable", "admin")):
            return Response({"detail": "Non autorisé."}, status=403)
        site = scoped_site(self.request.user)
        if site is not None:
            check = Booking.objects.filter(pk=pk,
                                           slot__activity__site_id=site).exists()
            if not check:
                return self._out_of_site(pk)
        from bookings.services import apply_discount

        try:
            b = apply_discount(
                booking_id=pk, discount=request.data.get("discount"),
                actor=request.user, reason=request.data.get("reason", ""))
        except Booking.DoesNotExist:
            return Response({"detail": "Réservation introuvable."}, status=404)
        except BookingError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(BookingSerializer(b).data)

    @action(detail=True, methods=["post"], url_path="vehicles")
    def set_vehicles(self, request, pk=None):
        # Correction a posteriori (anciens reçus) : fige les N° d'engins, tracée.
        if getattr(request.user, "role", None) not in ("responsable", "admin") \
                and not request.user.is_superuser:
            return Response({"detail": "Non autorisé."}, status=403)
        site = scoped_site(self.request.user)
        if site is not None:
            check = Booking.objects.filter(pk=pk,
                                           slot__activity__site_id=site).exists()
            if not check:
                return self._out_of_site(pk)
        from bookings.services import set_booking_vehicles

        try:
            b = set_booking_vehicles(
                booking_id=pk, vehicle_ids=request.data.get("vehicles", []),
                actor=request.user)
        except BookingError as e:
            return Response({"detail": str(e)}, status=400)
        except Booking.DoesNotExist:
            return Response({"detail": "Réservation introuvable."}, status=404)
        return Response(BookingSerializer(b).data)


class BookingEventViewSet(SiteScopeMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = BookingEvent.objects.all()
    serializer_class = BookingEventSerializer
    site_lookup = "booking__slot__activity__site"
    permission_classes = [IsAuthenticated]


class PaymentView(APIView):
    permission_classes = [AgentRoles]

    def post(self, request):
        site = scoped_site(self.request.user)
        if site is not None:
            from bookings.models import Booking as _B

            check = _B.objects.filter(pk=request.data.get("booking"),
                                      slot__activity__site_id=site).exists()
            if not check:
                return Response({"detail": "Reservation hors de votre site."}, status=403)
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
        site = scoped_site(self.request.user)
        if site is not None:
            check = Booking.objects.filter(pk=request.data.get("booking"),
                                           slot__activity__site_id=site).exists()
            if not check:
                return Response({"detail": "Reservation hors de votre site."}, status=403)
        try:
            payment, booking = record_cash_payment(
                booking_id=request.data["booking"], amount=request.data.get("amount"),
                nature=request.data.get("nature", "balance"), received_by=request.user,
            )
        except (KeyError, ValueError, PaymentError) as e:
            return Response({"detail": str(e)}, status=400)
        return Response({
            "created": True,
            "payment": PaymentSerializer(payment).data,
            "booking": BookingSerializer(booking).data,
            "reference": payment.reference,
        })


class FinanceReadRoles(BasePermission):
    """Lecture finance : responsable, admin, comptable (comptable hors CashRoles)."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and (
            getattr(request.user, "role", None) in ("responsable", "admin", "comptable")
            or request.user.is_superuser))


class PaymentViewSet(SiteScopeMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Mouvements réellement enregistrés : source de la caisse et de la recette."""
    queryset = Payment.objects.all().order_by("-created_at")
    serializer_class = PaymentSerializer
    site_lookup = "booking__slot__activity__site"
    permission_classes = [FinanceReadRoles]


class InvoiceView(APIView):
    permission_classes = [AgentRoles]

    def post(self, request):
        site = scoped_site(self.request.user)
        if site is not None:
            check = Booking.objects.filter(pk=request.data.get("booking"),
                                           slot__activity__site_id=site).exists()
            if not check:
                return Response({"detail": "Reservation hors de votre site."}, status=403)
        try:
            inv, created = issue_invoice(booking_id=request.data["booking"])
        except Exception as e:
            return Response({"detail": str(e)}, status=400)
        return Response(InvoiceSerializer(inv).data, status=201 if created else 200)


class InvoiceReadRoles(BasePermission):
    """Lecture factures : agent, responsable, admin, comptable."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and (
            getattr(request.user, "role", None) in ("agent", "responsable", "admin", "comptable")
            or request.user.is_superuser))


class InvoiceViewSet(SiteScopeMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Invoice.objects.all().order_by("-issued_at")
    serializer_class = InvoiceSerializer
    site_lookup = "booking__slot__activity__site"
    permission_classes = [InvoiceReadRoles]


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
        phone = booking.customer.whatsapp or booking.customer.phone
        wa_link = wa_me_link(phone, text)
        return Response({**MessageSerializer(msg).data, "wa_me": wa_link}, status=201)


class CallLogViewSet(SiteScopeMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                     viewsets.GenericViewSet):
    queryset = CallLog.objects.select_related("line", "site", "imported_by")
    serializer_class = CallLogSerializer
    permission_classes = [AgentRoles]
    site_lookup = "site"

    @action(detail=True, methods=["post"])
    def reconcile(self, request, pk=None):
        call = self.get_object()
        booking, anomaly = reconcile_call(call.id)
        return Response({
            "booking": BookingSerializer(booking).data if booking else None,
            "anomaly": CallAnomalySerializer(anomaly).data if anomaly else None,
        })

    @action(detail=False, methods=["post"], url_path="import")
    def import_bulk(self, request):
        """Remontée APK collecteur : lots ≤ 500, idempotent, multi-pays.

        Corps : {line_id, calls: [{direction, phone_number, started_at,
        duration_seconds, external_id}]}.
        """
        from django.utils.dateparse import parse_datetime

        line_id = request.data.get("line_id")
        raw_calls = request.data.get("calls", [])
        if not isinstance(raw_calls, list) or len(raw_calls) > 500:
            return Response({"detail": "Lot invalide (liste, 500 max)."}, status=400)
        line = TrackedLine.objects.select_related("site").filter(
            pk=line_id, active=True).first()
        if line is None:
            return Response({"detail": "Ligne d'entreprise requise (line_id actif)."}, status=400)
        if not line.collect_enabled:
            return Response({"detail": "Collecte désactivée pour cette ligne (voir Paramètres)."},
                            status=403)
        user_site = scoped_site(request.user)
        if getattr(request.user, "role", None) in RESTRICTED_SITE_ROLES and not user_site:
            return Response(
                {"detail": "Compte sans site : affectez un site avant d'importer des appels."},
                status=403)
        if line.site_id and user_site and line.site_id != user_site:
            return Response({"detail": "Ligne hors de votre site."}, status=403)
        entries = []
        for c in raw_calls:
            started = c.get("started_at")
            if isinstance(started, str):
                started = parse_datetime(started)
            entries.append({**c, "started_at": started})
            if entries[-1]["started_at"] is None:
                return Response({"detail": "started_at ISO requis."}, status=400)
        try:
            created, skipped, updated, fresh = import_calls(
                entries, line=line,
                site=request.user.site if user_site else None,
                imported_by=request.user)
        except TelephonyError as e:
            return Response({"detail": str(e)}, status=400)
        line.refresh_from_db()
        if created or updated:
            from audit.services import log_action

            log_action(
                actor=request.user, action="call.import", entity=f"line:{line.id}",
                after={"created": created, "updated": updated, "skipped": skipped,
                       "site": line.site_id or user_site})
        return Response({"created": created, "skipped": skipped, "updated": updated,
                         "fresh": fresh, "last_sync": line.last_sync},
                        status=201)


class AnomalyViewSet(SiteScopeMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                     viewsets.GenericViewSet):
    queryset = CallAnomaly.objects.select_related("call", "call__line", "call__site",
                                                  "resolved_by")
    serializer_class = CallAnomalySerializer
    permission_classes = [ManagerRoles]
    site_lookup = "call__site"

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        anomaly = self.get_object()
        try:
            anomaly = resolve_anomaly(anomaly.id, request.data.get("reason", ""),
                                      resolved_by=request.user,
                                      comment=request.data.get("comment", ""))
        except TelephonyError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(CallAnomalySerializer(anomaly).data)


class TrackedLineViewSet(SiteScopeMixin, viewsets.ModelViewSet):
    """Numéros d'entreprise suivis : lecture agence, gestion responsable/admin."""
    queryset = TrackedLine.objects.select_related("site").order_by("label")
    serializer_class = TrackedLineSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    site_lookup = "site"

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [AgentRoles()]
        return [ManagerRoles()]

    def perform_create(self, serializer):
        line = serializer.save()
        from audit.services import log_action

        log_action(actor=self.request.user, action="line.create",
                   entity=f"line:{line.id}",
                   after={"label": line.label, "site": line.site_id})

    def perform_update(self, serializer):
        own_site = scoped_site(self.request.user)
        new_site = serializer.validated_data.get("site", serializer.instance.site)
        if own_site is not None and new_site is not None and new_site.id != own_site:
            raise PermissionDenied("Ligne hors de votre site.")
        serializer.save()


class ClosingView(APIView):
    """Bordereau du jour : lecture seule.

    La clôture est automatique à `BKO_CLOSING_HOUR` (20h00) — aucune
    validation manuelle : l'existence d'une ligne pour la date = journée clôturée.
    """

    permission_classes = [ClosingReadRoles]

    def get(self, request):
        from django.conf import settings

        from telephony.tasks import close_day

        # Repli : si le beat/worker a manqué 20h00 (Redis à l'arrêt, poste éteint),
        # le système rattrape la clôture dès la consultation du bordereau.
        close_day()
        raw = request.query_params.get("date") or timezone.localdate().isoformat()
        try:
            year, month, day_n = (int(x) for x in str(raw).split("-"))
            target = date(year, month, day_n)
        except (ValueError, TypeError):
            return Response({"detail": "Date invalide."}, status=400)
        closing = DailyClosing.objects.filter(date=target).first()
        return Response({
            "date": target.isoformat(),
            "closed": closing is not None,
            "closing_hour": settings.BKO_CLOSING_HOUR,
            "closing": DailyClosingSerializer(closing).data if closing else None,
        })


class VehicleViewSet(SiteScopeMixin, CatalogueViewSetMixin, viewsets.ModelViewSet):
    queryset = Vehicle.objects.all().order_by("plate")
    serializer_class = VehicleSerializer

    def destroy(self, request, *args, **kwargs):
        from django.db.models import ProtectedError

        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Engin utilisé (maintenances ou créneaux) : passez-le hors service."},
                status=400)


class MaintenanceViewSet(SiteScopeMixin, CatalogueViewSetMixin, viewsets.ModelViewSet):
    queryset = Maintenance.objects.all()
    serializer_class = MaintenanceSerializer
    site_lookup = "vehicle__site"

    def perform_create(self, serializer):
        entry = serializer.save(created_by=self.request.user)
        vehicle = entry.vehicle
        if entry.new_status:
            vehicle.status = entry.new_status
            vehicle.save(update_fields=["status"])
        if entry.cost:
            category = "reparation" if entry.kind == "reparation" else "autre"
            try:
                add_entry(
                    day=entry.date, category=category,
                    label=f"Maintenance {vehicle.plate} ({entry.get_kind_display()})",
                    direction=CashbookEntry.OUT, amount=entry.cost,
                    site=vehicle.site, booking=None, created_by=self.request.user,
                )
            except FinanceError as e:
                raise ValidationError({"cost": str(e)})


class SparePartViewSet(SiteScopeMixin, viewsets.ModelViewSet):
    """Stock de pièces de rechange.

    Lecture : guide, responsable, admin (écran Flotte). Écriture :
    responsable et admin seuls ; une pièce consommée est en lecture seule
    et ne peut jamais disparaître du stock (historique).
    """

    queryset = SparePart.objects.all().select_related("site", "added_by", "used_in__vehicle")
    serializer_class = SparePartSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [GuideRoles()]
        return [ManagerRoles()]

    def perform_create(self, serializer):
        from rest_framework.exceptions import PermissionDenied

        site = scoped_site(self.request.user)
        if site is not None and serializer.validated_data["site"].id != site:
            raise PermissionDenied("Vous ne pouvez enregistrer une pièce que sur votre site.")
        part = serializer.save(added_by=self.request.user)
        from audit.services import log_action

        log_action(actor=self.request.user, action="spare_part.create",
                   entity=f"spare_part:{part.id}",
                   after=SparePartSerializer(part).data)

    def perform_update(self, serializer):
        from rest_framework.exceptions import PermissionDenied

        if self.get_object().status == SparePart.USED:
            raise PermissionDenied("Pièce utilisée : fiche en lecture seule.")
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        part = self.get_object()
        if part.status == SparePart.USED:
            return Response(
                {"detail": "Pièce utilisée en maintenance : elle reste dans l’historique."},
                status=400)
        return super().destroy(request, *args, **kwargs)


class ExpenseView(APIView):
    """Dépense, ou recette manuelle (anciens encaissements hors Hub).

    Direction IN réservée à `recette_manuelle` (les recettes réservations
    restent automatiques). Mois clos = écriture impossible.
    """

    permission_classes = [ManagerRoles]

    def post(self, request):
        try:
            day = request.data.get("day") or timezone.localdate().isoformat()
            year, month, day_n = (int(x) for x in str(day).split("-"))
            category = request.data["category"]
            label = str(request.data.get("label", "")).strip()
            if category not in ("carburant", "reparation", "loyer", "autre",
                                "recette_manuelle"):
                return Response({"detail": "Catégorie invalide (recettes réservations automatiques)."}, status=400)
            if not label:
                return Response({"detail": "Libellé requis."}, status=400)
            direction = request.data.get("direction", CashbookEntry.OUT)
            if direction == CashbookEntry.IN and category != "recette_manuelle":
                return Response({"detail": "Seules les recettes manuelles (ancien) se saisissent à la main."}, status=400)
            site = None
            imposed = scoped_site(request.user)
            if imposed is not None:
                # Responsable de site : écriture ratachee a son site, toujours.
                try:
                    site = Site.objects.get(pk=imposed)
                except Site.DoesNotExist:
                    return Response({"detail": "Site manquant sur votre compte."}, status=403)
            else:
                raw_site = request.data.get("site") or requested_site(request)
                if raw_site:
                    site = Site.objects.filter(pk=raw_site).first()
                    if site is None:
                        return Response({"detail": "Site introuvable."}, status=400)
            entry = add_entry(
                day=date(year, month, day_n),
                category=category,
                label=label,
                direction=direction,
                amount=int(request.data["amount"]),
                site=site,
                receipt=str(request.data.get("receipt", "")).strip(),
                created_by=request.user,
            )
        except FinanceError as e:
            return Response({"detail": str(e)}, status=400)
        except (KeyError, ValueError, TypeError):
            return Response({"detail": "Date, catégorie, libellé et montant requis."}, status=400)
        return Response(CashbookEntrySerializer(entry).data, status=201)


class CashbookEntryViewSet(SiteScopeMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = CashbookEntry.objects.all().order_by("-date", "-id")
    serializer_class = CashbookEntrySerializer
    permission_classes = [FinanceReadRoles]


class MonthSummaryView(APIView):
    """Solde du mois : ouverture + entrées − sorties, verrou inclus."""

    permission_classes = [FinanceReadRoles]

    def get(self, request):
        today = timezone.localdate()
        try:
            year = int(request.query_params.get("year", today.year))
            month = int(request.query_params.get("month", today.month))
            first = date(year, month, 1)
        except (ValueError, TypeError):
            return Response({"detail": "Mois invalide."}, status=400)
        closing = MonthlyClosing.objects.filter(month=first).first()
        site = requested_site(self.request)
        if site is not None:
            base = CashbookEntry.objects.filter(site_id=site)
            opening, balance, locked = 0, None, False
        else:
            base = CashbookEntry.objects.all()
            opening = closing.opening if closing else 0
            balance, locked = month_balance(date(year, month, 28)), closing is not None
        inn = base.filter(
            date__year=year, date__month=month, direction=CashbookEntry.IN
        ).aggregate(s=Sum("amount"))["s"] or 0
        out = base.filter(
            date__year=year, date__month=month, direction=CashbookEntry.OUT
        ).aggregate(s=Sum("amount"))["s"] or 0
        if site is not None:
            balance = inn - out
        site_name = Site.objects.filter(pk=site).values_list("name", flat=True).first() if site else ""
        return Response({
            "month": first.isoformat(),
            "site": site,
            "site_name": site_name or "",
            "opening": opening,
            "inn": inn,
            "out": out,
            "balance": balance,
            "locked": locked,
        })


class BankTransactionViewSet(SiteScopeMixin, mixins.ListModelMixin,
                             mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Historique bancaire : écritures jamais modifiées ni supprimées.

    Filtre site : imposé aux rôles de terrain, choisi par les profils
    globaux via `?site=` (voir SiteScopeMixin).
    """
    queryset = BankTransaction.objects.all().order_by("-date", "-id")
    serializer_class = BankTransactionSerializer
    permission_classes = [FinanceReadRoles]

    def get_queryset(self):
        qs = super().get_queryset()
        bank = (self.request.query_params.get("bank") or "").strip()
        if bank:
            qs = qs.filter(bank=bank)
        kind = (self.request.query_params.get("type") or "").strip()
        if kind in (BankTransaction.DEPOSIT, BankTransaction.WITHDRAWAL,
                    BankTransaction.TRANSFER):
            qs = qs.filter(type=kind)
        return qs


class BankWriteView(APIView):
    """Versement (bordereau requis), retrait (chèque/réf requis) ou virement (sans réf).

    Le site est imposé aux rôles de terrain ; les profils globaux le
    joignent au corps (`site`) ou le laissent vide (opération réseau).
    """

    permission_classes = [ManagerRoles]
    tx_type = None

    def post(self, request):
        if self.tx_type not in (BankTransaction.DEPOSIT, BankTransaction.WITHDRAWAL,
                                BankTransaction.TRANSFER):
            return Response({"detail": "Type d'opération invalide."}, status=500)
        try:
            day_raw = request.data.get("date") or timezone.localdate().isoformat()
            year, month, day_n = (int(x) for x in str(day_raw).split("-"))
            imposed = scoped_site(request.user)
            raw_site = imposed or request.data.get("site") or requested_site(request)
            site = None
            if raw_site:
                site = Site.objects.filter(pk=raw_site).first()
                if site is None:
                    return Response({"detail": "Site introuvable."}, status=400)
            tx = add_bank_transaction(
                type=self.tx_type,
                day=date(year, month, day_n),
                reason=request.data.get("reason", ""),
                amount=int(request.data.get("amount", 0)),
                first_name=request.data.get("person_first_name", ""),
                last_name=request.data.get("person_last_name", ""),
                receipt_number=request.data.get("receipt_number", ""),
                check_number=request.data.get("check_number", ""),
                bank=request.data.get("bank", ""),
                counterparty_bank=request.data.get("counterparty_bank", ""),
                site=site,
                created_by=request.user,
            )
        except FinanceError as e:
            return Response({"detail": str(e)}, status=400)
        except (KeyError, ValueError, TypeError):
            return Response({"detail": "Date, motif, nom et montant requis."}, status=400)
        from audit.services import log_action

        log_action(actor=request.user, action="bank.create",
                   entity=f"bank_transaction:{tx.id}",
                   after=BankTransactionSerializer(tx).data)
        return Response({**BankTransactionSerializer(tx).data,
                         "balance": bank_balance()}, status=201)


class BankDepositView(BankWriteView):
    tx_type = BankTransaction.DEPOSIT


class BankWithdrawalView(BankWriteView):
    tx_type = BankTransaction.WITHDRAWAL


class BankTransferView(BankWriteView):
    """Virement reçu : nom (entreprise/personne) + banques, sans bordereau ni chèque."""
    tx_type = BankTransaction.TRANSFER


class BankSummaryView(APIView):
    """Rapprochement : solde global + lignes du mois avec solde progressif.

    Filtres optionnels : `?site=` (rôles globaux ; imposé aux rôles de
    terrain) et `?bank=`. Les lignes, totaux et cumul suivent le site ;
    `balance` reste le solde réel du compte bancaire (global).
    """

    permission_classes = [FinanceReadRoles]

    def get(self, request):
        today = timezone.localdate()
        try:
            year = int(request.query_params.get("year", today.year))
            month = int(request.query_params.get("month", today.month))
        except (ValueError, TypeError):
            return Response({"detail": "Mois invalide."}, status=400)
        bank = (request.query_params.get("bank") or "").strip() or None
        site = requested_site(request)
        rows = bank_month_rows(year, month, bank=bank, site=site)
        deposits = sum(r["credit"] for r in rows)
        withdrawals = sum(r["debit"] for r in rows)
        site_name = Site.objects.filter(pk=site).values_list("name", flat=True).first() if site else ""
        return Response({
            "month": date(year, month, 1).isoformat(),
            "balance": bank_balance(),
            "site": site,
            "site_name": site_name or "",
            "site_balance": bank_balance(site=site) if site else None,
            "bank": bank,
            "deposits": deposits,
            "withdrawals": withdrawals,
            "net": deposits - withdrawals,
            "rows": [{
                "id": r["tx"].id,
                "date": r["tx"].date.isoformat(),
                "type": r["tx"].type,
                "reason": r["tx"].reason,
                "ref": r["tx"].receipt_number or r["tx"].check_number
                or r["tx"].counterparty_bank or r["tx"].bank or "—",
                "bank": r["tx"].bank,
                "site": r["tx"].site_id,
                "site_name": r["tx"].site.name if r["tx"].site_id else "",
                "counterparty_bank": r["tx"].counterparty_bank,
                "person_first_name": r["tx"].person_first_name,
                "person_last_name": r["tx"].person_last_name,
                "debit": r["debit"],
                "credit": r["credit"],
                "running": r["running"],
            } for r in rows],
        })


class DocumentPdfView(APIView):
    """Reçu / facture en vrai PDF (à envoyer au client)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, booking_id, kind):
        from django.http import FileResponse

        from common import pdf_docs

        if kind not in ("recu", "facture"):
            return Response({"detail": "Document inconnu (recu ou facture)."}, status=400)
        site = scoped_site(self.request.user)
        if site is not None:
            from bookings.models import Booking

            if not Booking.objects.filter(pk=booking_id,
                                          slot__activity__site_id=site).exists():
                return Response({"detail": "Reservation hors de votre site."}, status=403)
        try:
            if kind == "recu":
                filename, content = pdf_docs.pdf_recu(booking_id)
            else:
                filename, content = pdf_docs.pdf_facture(booking_id)
        except Exception as e:
            from bookings.models import Booking

            if not Booking.objects.filter(pk=booking_id).exists():
                return Response({"detail": "Réservation introuvable."}, status=404)
            return Response({"detail": str(e)}, status=400)
        import io

        return FileResponse(io.BytesIO(content), as_attachment=True,
                            filename=filename, content_type="application/pdf")


class BankReportPdfView(APIView):
    """Rapprochement bancaire en PDF, filtrable par site et par banque."""

    permission_classes = [FinanceReadRoles]

    def get(self, request):
        import io

        from django.http import FileResponse

        from common import pdf_docs
        from finance.services import bank_balance, bank_month_rows

        today = timezone.localdate()
        try:
            year = int(request.query_params.get("year", today.year))
            month = int(request.query_params.get("month", today.month))
        except (ValueError, TypeError):
            return Response({"detail": "Mois invalide."}, status=400)
        bank = (request.query_params.get("bank") or "").strip() or None
        site = requested_site(request)
        site_name = Site.objects.filter(pk=site).values_list("name", flat=True).first() if site else None
        try:
            fees = int(request.query_params.get("fees") or 0)
        except ValueError:
            fees = 0
        try:
            statement = request.query_params.get("statement")
            statement = int(statement) if statement not in (None, "") else None
        except ValueError:
            statement = None
        rows = bank_month_rows(year, month, bank=bank, site=site)
        filename, content = pdf_docs.pdf_bank_report(
            year=year, month=month, bank=bank, site_name=site_name, rows=rows,
            balance=bank_balance(site=site),
            deposits=sum(r["credit"] for r in rows),
            withdrawals=sum(r["debit"] for r in rows),
            fees=fees, statement=statement)
        return FileResponse(io.BytesIO(content), as_attachment=True,
                            filename=filename, content_type="application/pdf")


class RecettePdfView(APIView):
    """Fiche de recette mensuelle (caisse) en PDF, filtrable par site."""
    permission_classes = [FinanceReadRoles]

    def get(self, request):
        import io

        from django.http import FileResponse

        from common import pdf_docs
        from bookings.models import Booking
        from finance.models import CashbookEntry, MonthlyClosing

        today = timezone.localdate()
        try:
            year = int(request.query_params.get("year", today.year))
            month = int(request.query_params.get("month", today.month))
            first = date(year, month, 1)
        except (ValueError, TypeError):
            return Response({"detail": "Mois invalide."}, status=400)
        site = requested_site(request)
        site_name = Site.objects.filter(pk=site).values_list("name", flat=True).first() if site else None
        base = CashbookEntry.objects.all()
        if site is not None:
            base = base.filter(site_id=site)
        entries = base.filter(date__year=year, date__month=month).order_by("date", "id")
        closing = None
        opening = 0
        locked = False
        if site is None:
            closing = MonthlyClosing.objects.filter(month=first).first()
            opening = closing.opening if closing else 0
            locked = closing is not None
        inn = sum(e.amount for e in entries if e.direction == CashbookEntry.IN)
        out = sum(e.amount for e in entries if e.direction == CashbookEntry.OUT)
        balance = (opening + inn - out) if site is None else (inn - out)
        att_qs = Booking.objects.filter(status="pending_deposit",
                                       expires_at__year=year,
                                       expires_at__month=month)
        if site is not None:
            att_qs = att_qs.filter(slot__activity__site_id=site)
        att = sum(b.deposit_due for b in att_qs)
        filename, content = pdf_docs.pdf_recette_mensuelle(
            year=year, month=month, site_name=site_name, entries=entries,
            opening=opening, inn=inn, out=out, balance=balance,
            locked=locked, att=att)
        return FileResponse(io.BytesIO(content), as_attachment=True,
                            filename=filename, content_type="application/pdf")


class UserViewSet(SiteScopeMixin, viewsets.ModelViewSet):
    """Comptes du système : réservés au super administrateur."""

    queryset = User.objects.all().select_related("site").order_by("username")
    serializer_class = UserAdminSerializer
    permission_classes = [SuperAdminRoles]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def perform_update(self, serializer):
        # Garde : on ne désactive jamais son propre compte (verrouillage du Hub).
        if (serializer.instance == self.request.user
                and serializer.validated_data.get("is_active") is False):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Vous ne pouvez pas désactiver votre propre compte.")
        serializer.save()

    @action(detail=True, methods=["post"])
    def reset_password(self, request, pk=None):
        user = self.get_object()
        password = request.data.get("password", "")
        if len(password) < 8:
            return Response({"detail": "8 caractères minimum."}, status=400)
        user.set_password(password)
        user.save(update_fields=["password"])
        return Response({"detail": "Mot de passe réinitialisé."})


class PasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        if not user.check_password(request.data.get("old_password", "")):
            return Response({"detail": "Ancien mot de passe incorrect."}, status=400)
        new = request.data.get("new_password", "")
        if len(new) < 8:
            return Response({"detail": "8 caractères minimum."}, status=400)
        user.set_password(new)
        user.save(update_fields=["password"])
        return Response({"detail": "Mot de passe modifié."})


class TotpEnrollView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        secret = random_secret()
        request.user.totp_secret = secret
        request.user.totp_enabled = False
        request.user.save(update_fields=["totp_secret", "totp_enabled"])
        return Response({
            "secret": secret,
            "otpauth_url": otpauth_url(secret, request.user.username),
        }, status=201)


class TotpVerifyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.totp_secret:
            return Response({"detail": "Enrôlez d’abord un secret."}, status=400)
        if not totp_verify(request.user.totp_secret, request.data.get("code", "")):
            return Response({"detail": "Code invalide."}, status=400)
        request.user.totp_enabled = True
        request.user.save(update_fields=["totp_enabled"])
        return Response({"detail": "Double authentification activée."})


class CompanyView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated()]
        return [AdminRoles()]

    def get(self, request):
        profile, _ = CompanyProfile.objects.get_or_create(pk=1)
        return Response(CompanySerializer(profile).data)

    def put(self, request):
        profile, _ = CompanyProfile.objects.get_or_create(pk=1)
        serializer = CompanySerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class NoticeViewSet(viewsets.ModelViewSet):
    queryset = Notice.objects.select_related("site")
    serializer_class = NoticeSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return [ManagerRoles()]

    def get_queryset(self):
        qs = super().get_queryset()
        site = requested_site(self.request)
        if site is None:
            return qs
        return qs.filter(Q(site_id=site) | Q(site__isnull=True))

    def perform_create(self, serializer):
        site = scoped_site(self.request.user)
        site_obj = serializer.validated_data.get("site")
        site_id = site or (site_obj.pk if site_obj is not None else requested_site(self.request))
        serializer.save(created_by=self.request.user, site_id=site_id)

    def perform_update(self, serializer):
        site = scoped_site(self.request.user)
        if site is None:
            serializer.save()
            return
        serializer.validated_data.pop("site", None)
        if serializer.instance.site_id is not None:
            serializer.save(site_id=site)
        else:
            serializer.save()

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        notice = self.get_object()
        notice.status = "published"
        notice.published_at = timezone.now()
        notice.save(update_fields=["status", "published_at"])
        return Response(NoticeSerializer(notice).data)


class PayrollReadRoles(BasePermission):
    """Paie : direction + comptable en lecture (responsable exclu, PRD)."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and (
            getattr(request.user, "role", None) in ("admin", "comptable")
            or request.user.is_superuser))


class EmployeeViewSet(SiteScopeMixin, CatalogueViewSetMixin, viewsets.ModelViewSet):
    queryset = Employee.objects.all().order_by("name")
    serializer_class = EmployeeSerializer

    def _guard_site(self, site):
        own_site = scoped_site(self.request.user)
        if own_site is not None and site is not None and site.id != own_site:
            raise PermissionDenied("Salarié hors de votre site.")

    def perform_create(self, serializer):
        self._guard_site(serializer.validated_data.get("site"))
        serializer.save()

    def perform_update(self, serializer):
        site = serializer.validated_data.get("site", serializer.instance.site)
        self._guard_site(site)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        from django.db.models import ProtectedError

        employee = self.get_object()
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Ce salarié a un historique (contrats, courriers, paie) : "
                           "désactivez-le au lieu de le supprimer."}, status=400)


def hr_document_queryset(user, model):
    """Documents RH visibles : direction/comptable tout, responsable son site,
    salarié les siens. Le client n'en voit aucun."""
    qs = model.objects.select_related(
        "employee__site", "employee__user", "created_by").prefetch_related("signatures")
    role = getattr(user, "role", None)
    if user.is_superuser or role in ("admin", "comptable"):
        return qs
    if role == "responsable":
        site = scoped_site(user)
        if site is None:
            return qs
        return qs.filter(Q(employee__site_id=site) | Q(employee__site__isnull=True))
    if role in ("agent", "guide"):
        return qs.filter(employee__user=user).exclude(status=DRAFT)
    return qs.none()


class HRDocumentViewSetMixin:
    model = None

    def get_queryset(self):
        qs = hr_document_queryset(self.request.user, self.model)
        site = requested_site(self.request)
        if site is not None:
            qs = qs.filter(Q(employee__site_id=site) | Q(employee__site__isnull=True))
        return qs

    def _fresh(self, document):
        # Les signatures viennent d'être créées : le prefetch de get_object()
        # est périmé, on relit le document avec ses signatures à jour.
        return self.get_queryset().get(pk=document.pk)

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy", "send"):
            return [ManagerRoles()]
        return [IsAuthenticated()]

    def _guard_employee(self, employee):
        site = scoped_site(self.request.user)
        if site is not None and employee.site_id not in (None, site):
            raise PermissionDenied("Salarié hors de votre site.")

    def perform_create(self, serializer):
        self._guard_employee(serializer.validated_data["employee"])
        serializer.save()

    def perform_update(self, serializer):
        employee = serializer.validated_data.get("employee", serializer.instance.employee)
        self._guard_employee(employee)
        if serializer.instance.status != DRAFT:
            raise PermissionDenied("Document déjà envoyé en signature : lecture seule.")
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        document = self.get_object()
        if document.status != DRAFT:
            return Response(
                {"detail": "Seul un brouillon peut être supprimé. "
                           "Un document envoyé est conservé pour la piste d'audit."},
                status=400)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], permission_classes=[ManagerRoles])
    def send(self, request, pk=None):
        document = self.get_object()
        try:
            document = send_document(document, request.user, request)
        except HRWorkflowError as e:
            return Response({"detail": str(e)}, status=400)
        except HRPermissionError as e:
            return Response({"detail": str(e)}, status=403)
        return Response(self.get_serializer(self._fresh(document)).data)

    @action(detail=True, methods=["post"])
    def sign(self, request, pk=None):
        document = self.get_object()
        consent = request.data.get("consent") in (True, 1, "1", "true", "True", "on")
        try:
            document = sign_document(
                document, request.user,
                full_name=request.data.get("full_name", ""),
                signature_data=request.data.get("signature", ""),
                consent=consent, request=request)
        except HRWorkflowError as e:
            return Response({"detail": str(e)}, status=400)
        except HRPermissionError as e:
            return Response({"detail": str(e)}, status=403)
        return Response(self.get_serializer(self._fresh(document)).data)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        import io

        from django.http import FileResponse

        document = self.get_object()
        try:
            if document.signed_pdf:
                content = signed_pdf_bytes(document)
                filename = f"{document.reference}.pdf"
            else:
                content = preview_pdf(document)
                filename = f"{document.reference}-apercu.pdf"
        except HRWorkflowError as e:
            return Response({"detail": str(e)}, status=400)
        return FileResponse(io.BytesIO(content), as_attachment=True,
                            filename=filename, content_type="application/pdf")


class ContractViewSet(HRDocumentViewSetMixin, viewsets.ModelViewSet):
    queryset = Contract.objects.all()
    model = Contract
    serializer_class = ContractSerializer


class HRLetterViewSet(HRDocumentViewSetMixin, viewsets.ModelViewSet):
    queryset = HRLetter.objects.all()
    model = HRLetter
    serializer_class = HRLetterSerializer


class HRUserDirectoryView(APIView):
    """Annuaire minimal des comptes pouvant porter un dossier salarié.

    Réservé aux rôles RH : le super administrateur (système) en est exclu.
    """

    permission_classes = [ManagerRoles]

    def get(self, request):
        users = (User.objects.filter(is_active=True)
                 .exclude(role="client")
                 .exclude(role="superadmin")
                 .exclude(is_superuser=True))
        site = scoped_site(request.user)
        if site is not None:
            users = users.filter(Q(site_id=site) | Q(site__isnull=True))
        return Response(
            HRUserDirectorySerializer(users.order_by("username"), many=True).data)


class MyHRDocumentsView(APIView):
    """Espace du salarié : ses contrats et courriers, à signer ou signés."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = employee_for_user(request.user)
        if employee is None:
            return Response({"employee": None, "contracts": [], "letters": []})
        contracts = list(Contract.objects.filter(employee=employee)
                         .exclude(status=DRAFT).prefetch_related("signatures"))
        contracts.sort(key=lambda c: (c.status != PENDING_SIGNATURE,
                                      -c.start.toordinal() if c.start else 0))
        letters = list(HRLetter.objects.filter(employee=employee)
                       .exclude(status=DRAFT).prefetch_related("signatures"))
        letters.sort(key=lambda letter: (letter.status != PENDING_SIGNATURE,
                                         -letter.date.toordinal() if letter.date else 0))
        context = {"request": request}
        return Response({
            "employee": EmployeeSerializer(employee).data,
            "contracts": ContractSerializer(contracts, many=True, context=context).data,
            "letters": HRLetterSerializer(letters, many=True, context=context).data,
        })


class HRActivityView(APIView):
    """Compteur de notifications RH : documents à signer et signatures récentes."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        role = getattr(request.user, "role", None)
        to_sign = []
        employee = employee_for_user(request.user)
        if employee is not None:
            for contract in Contract.objects.filter(
                    employee=employee, status=PENDING_SIGNATURE).prefetch_related("signatures"):
                to_sign.append({
                    "type": "contract", "id": contract.id,
                    "reference": contract.reference,
                    "title": f"Contrat {contract.reference}",
                    "employee_name": employee.name,
                    "url": "/mes-documents",
                })
            for letter in HRLetter.objects.filter(
                    employee=employee, status=PENDING_SIGNATURE).prefetch_related("signatures"):
                to_sign.append({
                    "type": "letter", "id": letter.id,
                    "reference": letter.reference,
                    "title": letter.title or letter.get_kind_display(),
                    "employee_name": employee.name,
                    "url": "/mes-documents",
                })
        signed = []
        if request.user.is_superuser or role in ("admin", "responsable"):
            for model, doc_type in ((Contract, "contract"), (HRLetter, "letter")):
                for document in (hr_document_queryset(request.user, model)
                                 .filter(status=SIGNED, signed_at__isnull=False)
                                 .order_by("-signed_at")[:10]):
                    signed.append({
                        "type": doc_type, "id": document.id,
                        "reference": document.reference,
                        "title": (f"Contrat {document.reference}"
                                  if doc_type == "contract"
                                  else (document.title or document.get_kind_display())),
                        "employee_name": document.employee.name,
                        "signed_at": document.signed_at.isoformat(),
                        "url": "/rh",
                    })
            signed.sort(key=lambda item: item["signed_at"], reverse=True)
        return Response({"to_sign": to_sign, "signed": signed[:10]})


class PayrollSheetViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Fiche mensuelle unique (façon Hub Digi) : 1 mois = 1 fiche d'équipe."""
    queryset = PayrollSheet.objects.all().order_by("-month")
    serializer_class = PayrollSheetSerializer
    permission_classes = [PayrollReadRoles]

    @action(detail=False, methods=["post"], permission_classes=[AdminRoles])
    def create_sheet(self, request):
        try:
            sheet = open_sheet(int(request.data["year"]), int(request.data["month"]))
        except PayrollError as e:
            return Response({"detail": str(e)}, status=400)
        except (KeyError, ValueError, TypeError):
            return Response({"detail": "Année et mois requis."}, status=400)
        return Response(PayrollSheetSerializer(sheet).data, status=201)

    def destroy(self, request, *args, **kwargs):
        # Brouillon seul, jamais si un versement existe (archive sinon).
        if not (request.user.is_superuser or getattr(request.user, "role", None) == "admin"):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Suppression réservée à l'admin.")
        try:
            delete_sheet(sheet_id=kwargs["pk"])
        except PayrollError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(status=204)

    @action(detail=True, methods=["post"], permission_classes=[AdminRoles])
    def fill_team(self, request, pk=None):
        try:
            created = fill_team(sheet_id=pk)
        except PayrollError as e:
            return Response({"detail": str(e)}, status=400)
        sheet = PayrollSheet.objects.get(pk=pk)
        return Response({**PayrollSheetSerializer(sheet).data, "created": created})

    @action(detail=True, methods=["post"], permission_classes=[AdminRoles])
    def close(self, request, pk=None):
        try:
            sheet = close_sheet(sheet_id=pk, actor=request.user)
        except PayrollError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(PayrollSheetSerializer(sheet).data)

    @action(detail=True, methods=["post", "delete"], permission_classes=[AdminRoles])
    def stamp(self, request, pk=None):
        try:
            sheet = PayrollSheet.objects.get(pk=pk)
        except PayrollSheet.DoesNotExist:
            return Response({"detail": "Fiche introuvable."}, status=404)
        if sheet.status != "draft":
            return Response({"detail": "Fiche clôturée, lecture seule."}, status=400)
        if request.method == "DELETE":
            if sheet.stamp:
                sheet.stamp.delete(save=False)
            sheet.stamp = None
            sheet.save()
            return Response(PayrollSheetSerializer(sheet).data)
        fichier = request.FILES.get("stamp")
        if not fichier:
            return Response({"detail": "Image requise."}, status=400)
        if not fichier.content_type.startswith("image/"):
            return Response({"detail": "Image uniquement (PNG, JPG)."}, status=400)
        if fichier.size > 2 * 1024 * 1024:
            return Response({"detail": "2 Mo maximum."}, status=400)
        from common.images import to_webp

        try:
            contenu = to_webp(fichier)
        except Exception:
            return Response({"detail": "Image invalide."}, status=400)
        sheet.stamp.save("tampon.webp", contenu, save=True)
        return Response(PayrollSheetSerializer(sheet).data)


class PayslipViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Payslip.objects.all().order_by("-id")
    serializer_class = PayslipSerializer
    permission_classes = [PayrollReadRoles]

    def get_queryset(self):
        qs = Payslip.objects.all().order_by("-id")
        sheet = self.request.query_params.get("sheet")
        if sheet:
            qs = qs.filter(sheet_id=int(sheet))
        return qs

    @action(detail=False, methods=["post"], permission_classes=[AdminRoles])
    def generate(self, request):
        try:
            slip = generate_payslip(
                sheet_id=int(request.data["sheet"]),
                user_id=int(request.data["user"]) if request.data.get("user") else None,
                employee_id=int(request.data["employee"]) if request.data.get("employee") else None,
                bonuses=[(b["label"], int(b["amount"])) for b in request.data.get("bonuses", [])],
                legal_deductions=[(b["label"], int(b["amount"])) for b in request.data.get("legal_deductions", [])],
            )
        except PayrollError as e:
            return Response({"detail": str(e)}, status=400)
        except (KeyError, ValueError, TypeError):
            return Response({"detail": "Fiche et compte requis."}, status=400)
        return Response(PayslipSerializer(slip).data, status=201)

    @action(detail=True, methods=["post"], permission_classes=[AdminRoles])
    def set_base(self, request, pk=None):
        # Base saisie librement (brouillon seul) ; N°, statut et date restent automatiques.
        try:
            from payroll.services import set_base_amount
            slip = set_base_amount(payslip_id=pk, amount=int(request.data.get("amount", -1)))
        except (ValueError, TypeError):
            return Response({"detail": "Montant requis."}, status=400)
        except PayrollError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(PayslipSerializer(slip).data)

    @action(detail=True, methods=["post"], permission_classes=[AdminRoles])
    def add_line(self, request, pk=None):
        try:
            line = add_payslip_line(
                payslip_id=pk, kind=request.data.get("kind", "gain"),
                label=request.data.get("label", ""), amount=int(request.data.get("amount", 0)),
            )
        except (ValueError, TypeError):
            return Response({"detail": "Nature, libellé et montant requis."}, status=400)
        except PayrollError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(PayslipLineSerializer(line).data, status=201)

    @action(detail=True, methods=["post"], permission_classes=[AdminRoles])
    def pay(self, request, pk=None):
        try:
            amount = int(request.data.get("amount", 0))
            if amount <= 0:
                return Response({"detail": "Montant invalide."}, status=400)
            pay_payslip(payslip_id=pk, amount=amount, paid_by=request.user)
        except (ValueError, TypeError):
            return Response({"detail": "Montant invalide."}, status=400)
        except PayrollError as e:
            return Response({"detail": str(e)}, status=400)
        slip = Payslip.objects.get(pk=pk)
        return Response(PayslipSerializer(slip).data)
