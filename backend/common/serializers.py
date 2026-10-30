"""Serializers API tranche 7."""

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from accounts.models import User
from bookings.models import Booking, BookingEvent, BookingLine
from bookings.services import is_kids_activity, is_orpheus_site
from catalogue.models import Activity, Maintenance, Site, Slot, SparePart, Vehicle
from clients.models import Customer
from comms.models import Message, Notice
from finance.models import BankTransaction, CashbookEntry
from payroll.hr_content import HRContentError, content_is_empty, sanitize_content
from payroll.models import (
    Contract, DocumentSignature, Employee, HRLetter, PayrollSheet, Payslip,
    PayslipLine, PayslipPayment,
)
from payments.models import Invoice, Payment, PaymentLink
from telephony.models import CallAnomaly, CallLog, DailyClosing, TrackedLine

from common.models import CompanyProfile


class UserSerializer(serializers.ModelSerializer):
    site_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "phone",
                  "role", "site", "site_name", "totp_enabled", "is_superuser"]
        read_only_fields = ["is_superuser"]

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""


class CustomerSerializer(serializers.ModelSerializer):
    site_name = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = ["id", "name", "phone", "whatsapp", "email", "notes", "site",
                  "site_name", "created_at"]
        read_only_fields = ["site_name"]

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""


class SiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = ["id", "name", "city"]


class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Activity
        fields = ["id", "site", "name", "duration_minutes", "base_price", "deposit", "max_group"]

    def validate(self, attrs):
        # Quads enfants : seul l'Hôtel Orpheus en propose.
        name = attrs.get("name", getattr(self.instance, "name", ""))
        site = attrs.get("site", getattr(self.instance, "site", None))
        site_name = site.name if site is not None else ""
        if is_kids_activity(name) and not is_orpheus_site(site_name):
            raise serializers.ValidationError(
                "Formule enfant : uniquement sur le site Hôtel Orpheus."
            )
        return attrs


class SlotSerializer(serializers.ModelSerializer):
    vehicles = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Vehicle.objects.all(), required=False)

    class Meta:
        model = Slot
        fields = ["id", "activity", "start", "end", "capacity", "closed", "vehicles"]

    def validate_vehicles(self, vehicles):
        act_id = self.initial_data.get("activity", getattr(self.instance, "activity_id", None))
        act = Activity.objects.filter(pk=act_id).first()
        for v in vehicles:
            if v.status != "en_service":
                raise serializers.ValidationError(f"{v.plate} n’est pas en service.")
            if act and v.site_id != act.site_id:
                raise serializers.ValidationError(f"{v.plate} appartient à un autre site.")
        return vehicles


class BookingLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookingLine
        fields = ["rank", "persons", "quads", "line_total", "discount"]


class BookingSerializer(serializers.ModelSerializer):
    lines = BookingLineSerializer(many=True, read_only=True)
    vehicle_plates = serializers.SerializerMethodField()
    discount_total = serializers.SerializerMethodField()
    site = serializers.SerializerMethodField()
    site_name = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = ["id", "code", "customer", "slot", "site", "site_name", "persons", "quads",
                  "resource_type", "unit_price", "units", "total", "deposit_due", "status",
                  "source", "expires_at", "qr_token", "cancel_reason", "lines",
                  "vehicle_plates", "discount_total", "offline_at"]
        read_only_fields = ["code", "resource_type", "unit_price", "units", "total",
                            "deposit_due", "status", "expires_at", "qr_token"]

    def get_site(self, o):
        return o.slot.activity.site_id

    def get_site_name(self, o):
        return o.slot.activity.site.name

    def get_vehicle_plates(self, o):
        return [v.plate for v in o.vehicles.all().order_by("plate")]

    def get_discount_total(self, o):
        return sum(l.discount for l in o.lines.all())


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
    line_label = serializers.SerializerMethodField()
    site_name = serializers.SerializerMethodField()
    imported_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CallLog
        fields = ["id", "direction", "phone_number", "started_at", "duration_seconds",
                  "source", "external_id", "line", "line_label", "site", "site_name",
                  "imported_by", "imported_by_name"]
        read_only_fields = ["line", "site", "imported_by"]

    def get_line_label(self, o):
        return o.line.label if o.line_id else ""

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""

    def get_imported_by_name(self, o):
        if not o.imported_by_id:
            return ""
        return o.imported_by.get_full_name() or o.imported_by.username


class CallAnomalySerializer(serializers.ModelSerializer):
    class Meta:
        model = CallAnomaly
        fields = ["id", "call", "status", "reason", "comment", "resolved_at"]


class DailyClosingSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyClosing
        fields = ["id", "date", "bookings_count", "amount_collected",
                  "calls_count", "anomalies_open", "validated_at"]


class VehicleSerializer(serializers.ModelSerializer):
    site_name = serializers.SerializerMethodField()
    status = serializers.CharField(default="en_service", required=False)
    plate = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = Vehicle
        fields = ["id", "site", "site_name", "type", "model", "plate", "color", "photo", "status"]
        extra_kwargs = {"plate": {"required": False}}

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""

    def _webp_photo(self, attrs):
        photo = attrs.get("photo", None)
        if photo is not None:
            from common.images import to_webp

            try:
                attrs["photo"] = to_webp(photo)
            except Exception:
                raise serializers.ValidationError({"photo": "Image invalide."})
        return attrs

    def _gen_plate(self, site, model):
        import re, random
        from catalogue.models import Vehicle, Site
        if isinstance(site, int):
            site = Site.objects.filter(pk=site).first()
        site_slug = re.sub(r"[^A-Za-z0-9]", "", (site.name if site else "SITE")).upper()[:8] or "SITE"
        brand_slug = re.sub(r"[^A-Za-z0-9]", "", (model or "QUAD")).upper()[:8] or "QUAD"
        for _ in range(100):
            num = "".join(str(random.randint(0, 9)) for _ in range(8))
            plate = f"Quad-{site_slug}-{brand_slug}-{num}"
            if not Vehicle.objects.filter(plate=plate).exists():
                return plate
        # fallback sequentiel garanti unique
        n = 1
        while True:
            plate = f"Quad-{site_slug}-{brand_slug}-{n:08d}"
            if not Vehicle.objects.filter(plate=plate).exists():
                return plate
            n += 1

    def create(self, validated_data):
        validated_data = self._webp_photo(validated_data)
        if not (validated_data.get("plate") or "").strip():
            site = validated_data.get("site")
            if site is None:
                sid = validated_data.get("site")
                from catalogue.models import Site
                if isinstance(sid, int):
                    site = Site.objects.filter(pk=sid).first()
            validated_data["plate"] = self._gen_plate(site, validated_data.get("model", ""))
        from django.db import IntegrityError
        for _ in range(5):
            try:
                return super().create(validated_data)
            except IntegrityError as exc:
                if "plate" not in str(exc).lower():
                    raise
                site = validated_data.get("site")
                if isinstance(site, int):
                    from catalogue.models import Site
                    site = Site.objects.filter(pk=site).first()
                validated_data["plate"] = self._gen_plate(site, validated_data.get("model", ""))
        return super().create(validated_data)

    def update(self, instance, validated_data):
        return super().update(instance, self._webp_photo(validated_data))


class MaintenanceSerializer(serializers.ModelSerializer):
    plate = serializers.SerializerMethodField()

    class Meta:
        model = Maintenance
        fields = ["id", "vehicle", "plate", "kind", "date", "cost", "part_name",
                  "part_serial", "oil_liters", "quantity", "notes", "new_status",
                  "created_by"]
        read_only_fields = ["created_by"]

    def get_plate(self, o):
        return o.vehicle.plate if o.vehicle_id else ""

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", ""))
        name = (attrs.get("part_name", getattr(self.instance, "part_name", "")) or "").strip()
        serial = (attrs.get("part_serial",
                            getattr(self.instance, "part_serial", "")) or "").strip()
        if kind == "piece":
            if not name:
                raise serializers.ValidationError({"part_name": "Nommez la pièce remplacée."})
            if not serial:
                raise serializers.ValidationError(
                    {"part_serial": "Numéro de série obligatoire pour un changement de pièce."})
        if serial:
            attrs["part_serial"] = serial
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        part = None
        if validated_data.get("kind") == "piece":
            vehicle = validated_data["vehicle"]
            serial = validated_data.get("part_serial", "").strip()
            part = (SparePart.objects.select_for_update()
                    .select_related("used_in__vehicle")
                    .filter(serial_number__iexact=serial).first())
            if part is None:
                raise serializers.ValidationError({
                    "part_serial": [
                        "Aucune pièce de rechange en stock avec ce numéro de série."]})
            if part.status != SparePart.AVAILABLE:
                used = ""
                if part.used_in_id and part.used_in.vehicle_id:
                    used = f" le {part.used_in.date:%d/%m/%Y} sur l’engin {part.used_in.vehicle.plate}"
                raise serializers.ValidationError({
                    "part_serial": [f"Cette pièce est déjà utilisée{used}."]})
            if part.site_id != vehicle.site_id:
                raise serializers.ValidationError({
                    "part_serial": [
                        f"Cette pièce appartient au site {part.site.name}."]})
            validated_data["part_serial"] = part.serial_number
        entry = super().create(validated_data)
        if part is not None:
            part.status = SparePart.USED
            part.used_at = timezone.now()
            part.used_in = entry
            part.save(update_fields=["status", "used_at", "used_in"])
            from audit.services import log_action

            request = self.context.get("request")
            log_action(
                actor=getattr(request, "user", None), action="spare_part.use",
                entity=f"spare_part:{part.id}",
                before={"status": "available"},
                after={"status": "used", "maintenance": entry.id,
                       "vehicle": entry.vehicle.plate,
                       "serial_number": part.serial_number},
            )
        return entry

    def update(self, instance, validated_data):
        # Une pièce consommée fige l'intervention : correction = nouvelle ligne.
        if instance.part_serial:
            for field in ("kind", "part_serial", "vehicle"):
                if field in validated_data and validated_data[field] != getattr(instance, field):
                    raise serializers.ValidationError({
                        field: "Intervention liée à une pièce : créez une intervention de correction."})
        return super().update(instance, validated_data)


class SparePartSerializer(serializers.ModelSerializer):
    site_name = serializers.SerializerMethodField()
    added_by_name = serializers.SerializerMethodField()
    used_vehicle_plate = serializers.SerializerMethodField()
    used_vehicle_model = serializers.SerializerMethodField()
    used_on = serializers.SerializerMethodField()

    class Meta:
        model = SparePart
        fields = ["id", "site", "site_name", "name", "serial_number", "color",
                  "reason", "bought_on", "added_by", "added_by_name", "status",
                  "used_at", "used_in", "used_vehicle_plate", "used_vehicle_model",
                  "used_on", "created_at"]
        read_only_fields = ["added_by", "status", "used_at", "used_in", "created_at"]

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""

    def get_added_by_name(self, o):
        if not o.added_by_id:
            return ""
        return o.added_by.get_full_name() or o.added_by.username

    def get_used_vehicle_plate(self, o):
        if o.used_in_id and o.used_in.vehicle_id:
            return o.used_in.vehicle.plate
        return ""

    def get_used_vehicle_model(self, o):
        if o.used_in_id and o.used_in.vehicle_id:
            return o.used_in.vehicle.model
        return ""

    def get_used_on(self, o):
        return o.used_in.date.isoformat() if o.used_in_id else None

    def validate_serial_number(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Numéro de série requis.")
        qs = SparePart.objects.filter(serial_number__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ce numéro de série est déjà enregistré.")
        return value


class CashbookEntrySerializer(serializers.ModelSerializer):
    site_name = serializers.SerializerMethodField()

    class Meta:
        model = CashbookEntry
        fields = ["id", "date", "site", "site_name", "category", "label", "voucher",
                  "direction", "amount", "payment", "booking", "receipt", "locked", "created_at"]

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""


class BankTransactionSerializer(serializers.ModelSerializer):
    site_name = serializers.SerializerMethodField()

    class Meta:
        model = BankTransaction
        fields = ["id", "type", "amount", "date", "reason", "site", "site_name",
                  "bank", "counterparty_bank", "receipt_number", "check_number",
                  "person_first_name", "person_last_name", "locked", "created_at"]
        read_only_fields = ["locked", "created_at", "site_name"]

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""


class UserAdminSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    site_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "phone", "role",
                  "site", "site_name", "is_active", "is_superuser", "totp_enabled",
                  "password"]
        read_only_fields = ["is_superuser", "totp_enabled"]

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""

    def validate(self, attrs):
        role = attrs.get("role", getattr(self.instance, "role", ""))
        if role in ("admin", "superadmin", "comptable"):
            attrs["site"] = None
        return attrs

    def validate_phone(self, v):
        qs = User.objects.filter(phone=v)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ce numéro est déjà utilisé.")
        return v

    def create(self, validated):
        pw = validated.pop("password", "")
        if not pw:
            raise serializers.ValidationError({"password": "Mot de passe requis (8 caractères min)."})
        user = User(**validated)
        user.set_password(pw)
        user.save()
        return user

    def update(self, instance, validated):
        pw = validated.pop("password", "")
        for key, value in validated.items():
            setattr(instance, key, value)
        if pw:
            instance.set_password(pw)
        instance.save()
        return instance


class HRUserDirectorySerializer(serializers.ModelSerializer):
    """Annuaire minimal pour relier un dossier salarié à un compte."""

    name = serializers.SerializerMethodField()
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    is_superuser = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "name", "role", "role_label", "is_superuser"]
        read_only_fields = fields

    def get_name(self, o):
        return o.get_full_name() or o.username


class CompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyProfile
        fields = ["id", "name", "phone", "email", "address", "nif", "rccm",
                  "conditions", "thanks", "stamp", "signature", "signature_name"]

    def _webp_files(self, attrs):
        from common.images import to_webp

        for key in ("stamp", "signature"):
            f = attrs.get(key, None)
            if f is not None:
                try:
                    attrs[key] = to_webp(f)
                except Exception:
                    raise serializers.ValidationError({key: "Image invalide."})
        return attrs

    def create(self, validated_data):
        return super().create(self._webp_files(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._webp_files(validated_data))


class NoticeSerializer(serializers.ModelSerializer):
    site_name = serializers.SerializerMethodField()

    class Meta:
        model = Notice
        fields = ["id", "type", "title", "content", "site", "site_name", "status",
                  "published_at", "created_at", "created_by"]
        read_only_fields = ["site_name", "published_at", "created_by"]

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""


class TrackedLineSerializer(serializers.ModelSerializer):
    active = serializers.BooleanField(default=True, required=False)
    site_name = serializers.SerializerMethodField()

    class Meta:
        model = TrackedLine
        fields = ["id", "label", "number", "site", "site_name", "active", "collect_enabled", "last_sync"]

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""

    def validate(self, attrs):
        site = attrs.get("site", getattr(self.instance, "site", None))
        if site is None:
            request = self.context.get("request")
            user = getattr(request, "user", None)
            if getattr(user, "site_id", None):
                attrs["site"] = user.site
            else:
                raise serializers.ValidationError(
                    {"site": "Site requis pour cette ligne d'entreprise."})
        return attrs


class EmployeeSerializer(serializers.ModelSerializer):
    site_name = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    has_account = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = ["id", "name", "role", "site", "site_name", "user", "user_name",
                  "has_account", "active"]

    def get_site_name(self, o):
        return o.site.name if o.site_id else ""

    def get_user_name(self, o):
        if not o.user_id:
            return ""
        return o.user.get_full_name() or o.user.username

    def get_has_account(self, o):
        return bool(o.user_id)

    def validate_user(self, value):
        if value is None:
            return value
        if getattr(value, "role", None) == "client":
            raise serializers.ValidationError(
                "Un compte client ne peut pas signer des documents RH.")
        if getattr(value, "is_superuser", False) or getattr(value, "role", None) == "superadmin":
            raise serializers.ValidationError(
                "Le compte super administrateur gère le système : il ne peut pas "
                "être relié à un dossier salarié.")
        qs = Employee.objects.filter(user=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ce compte est déjà relié à un autre salarié.")
        return value


class _HRDocumentSerializer(serializers.ModelSerializer):
    """Champs communs contrats/courriers : statut, signatures, PDF."""

    status_label = serializers.SerializerMethodField()
    has_pdf = serializers.SerializerMethodField()
    company_signed_at = serializers.SerializerMethodField()
    company_signer_name = serializers.SerializerMethodField()
    employee_signed_at = serializers.SerializerMethodField()
    employee_signer_name = serializers.SerializerMethodField()

    def get_status_label(self, o):
        return o.get_status_display()

    def get_has_pdf(self, o):
        return bool(o.signed_pdf)

    def _signature(self, o, role):
        for signature in o.signatures.all():
            if signature.role == role:
                return signature
        return None

    def get_company_signed_at(self, o):
        signature = self._signature(o, "company")
        return signature.signed_at if signature else None

    def get_company_signer_name(self, o):
        signature = self._signature(o, "company")
        return signature.signer_name if signature else ""

    def get_employee_signed_at(self, o):
        signature = self._signature(o, "employee")
        return signature.signed_at if signature else None

    def get_employee_signer_name(self, o):
        signature = self._signature(o, "employee")
        return signature.signer_name if signature else ""


class ContractSerializer(_HRDocumentSerializer, serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_role = serializers.SerializerMethodField()
    employee_site_name = serializers.SerializerMethodField()
    employee_user = serializers.SerializerMethodField()
    contract_type_label = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Contract
        fields = [
            "id", "employee", "employee_name", "employee_role", "employee_site_name",
            "employee_user", "reference", "contract_type", "contract_type_label",
            "start", "end", "base_salary", "frequency", "job_title", "workplace",
            "weekly_hours", "trial_months", "content", "status", "status_label",
            "created_by", "created_by_name", "sent_at", "signed_at", "signed_hash",
            "has_pdf", "company_signed_at", "company_signer_name",
            "employee_signed_at", "employee_signer_name", "created_at", "updated_at",
        ]
        read_only_fields = [
            "reference", "status", "created_by", "sent_at", "signed_at",
            "signed_hash", "created_at", "updated_at",
        ]

    def get_employee_name(self, o):
        return o.employee.name

    def get_employee_role(self, o):
        return o.employee.role

    def get_employee_site_name(self, o):
        return o.employee.site.name if o.employee.site_id else ""

    def get_employee_user(self, o):
        return o.employee.user_id

    def get_contract_type_label(self, o):
        return o.get_contract_type_display()

    def get_created_by_name(self, o):
        if not o.created_by_id:
            return ""
        return o.created_by.get_full_name() or o.created_by.username

    def validate_content(self, value):
        try:
            return sanitize_content(value)
        except HRContentError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate(self, attrs):
        start = attrs.get("start", getattr(self.instance, "start", None))
        end = attrs.get("end", getattr(self.instance, "end", None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end": "La fin du contrat doit être après le début."})
        hours = attrs.get("weekly_hours",
                          getattr(self.instance, "weekly_hours", 40))
        if hours is not None and not 1 <= int(hours) <= 80:
            raise serializers.ValidationError(
                {"weekly_hours": "Indiquez entre 1 et 80 heures par semaine."})
        months = attrs.get("trial_months",
                           getattr(self.instance, "trial_months", 0))
        if months is not None and int(months) > 24:
            raise serializers.ValidationError(
                {"trial_months": "La période d'essai ne peut pas dépasser 24 mois."})
        return attrs

    def create(self, validated_data):
        from payroll.hr_services import default_contract_content

        request = self.context.get("request")
        instance = Contract(**validated_data)
        if request:
            instance.created_by = request.user
        if not instance.job_title:
            instance.job_title = instance.employee.role or "agent"
        if not instance.workplace:
            instance.workplace = (instance.employee.site.name
                                  if instance.employee.site_id else "Bamako")
        if content_is_empty(instance.content):
            instance.content = default_contract_content(instance)
        instance.save()
        if request:
            from audit.services import log_action
            log_action(actor=request.user, action="hr.contract.create",
                       entity=f"contract:{instance.id}",
                       after={"reference": instance.reference,
                              "employee": instance.employee.name,
                              "base_salary": instance.base_salary})
        return instance

    def update(self, instance, validated_data):
        from payroll.hr_services import default_contract_content

        request = self.context.get("request")
        before = {"status": instance.status, "base_salary": instance.base_salary}
        old_default = default_contract_content(instance)
        instance = super().update(instance, validated_data)
        if "content" not in validated_data and instance.content == old_default:
            instance.content = default_contract_content(instance)
            instance.save(update_fields=["content", "updated_at"])
        elif "content" in validated_data and content_is_empty(instance.content):
            instance.content = default_contract_content(instance)
            instance.save(update_fields=["content", "updated_at"])
        if request:
            from audit.services import log_action
            log_action(actor=request.user, action="hr.contract.update",
                       entity=f"contract:{instance.id}", before=before,
                       after={"status": instance.status,
                              "base_salary": instance.base_salary})
        return instance


class HRLetterSerializer(_HRDocumentSerializer, serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_role = serializers.SerializerMethodField()
    employee_site_name = serializers.SerializerMethodField()
    employee_user = serializers.SerializerMethodField()
    kind_label = serializers.SerializerMethodField()
    contract_reference = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = HRLetter
        fields = [
            "id", "employee", "employee_name", "employee_role", "employee_site_name",
            "employee_user", "contract", "contract_reference", "kind", "kind_label",
            "title", "reference", "date", "content", "amount", "new_salary",
            "new_job_title", "effective_date", "status", "status_label",
            "created_by", "created_by_name", "sent_at", "signed_at", "signed_hash",
            "has_pdf", "company_signed_at", "company_signer_name",
            "employee_signed_at", "employee_signer_name", "created_at", "updated_at",
        ]
        read_only_fields = [
            "reference", "status", "created_by", "sent_at", "signed_at",
            "signed_hash", "created_at", "updated_at",
        ]

    def get_employee_name(self, o):
        return o.employee.name

    def get_employee_role(self, o):
        return o.employee.role

    def get_employee_site_name(self, o):
        return o.employee.site.name if o.employee.site_id else ""

    def get_employee_user(self, o):
        return o.employee.user_id

    def get_kind_label(self, o):
        return o.get_kind_display()

    def get_contract_reference(self, o):
        return o.contract.reference if o.contract_id else ""

    def get_created_by_name(self, o):
        if not o.created_by_id:
            return ""
        return o.created_by.get_full_name() or o.created_by.username

    def validate_content(self, value):
        try:
            return sanitize_content(value)
        except HRContentError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate(self, attrs):
        employee = attrs.get("employee", getattr(self.instance, "employee", None))
        contract = attrs.get("contract", getattr(self.instance, "contract", None))
        if contract and employee and contract.employee_id != employee.id:
            raise serializers.ValidationError(
                {"contract": "Ce contrat n'appartient pas à ce salarié."})
        kind = attrs.get("kind", getattr(self.instance, "kind", "autre"))
        amount = attrs.get("amount", getattr(self.instance, "amount", None))
        salary = attrs.get("new_salary", getattr(self.instance, "new_salary", None))
        if kind == "prime" and amount is not None and amount <= 0:
            raise serializers.ValidationError(
                {"amount": "La prime doit être supérieure à 0 FCFA."})
        if kind == "augmentation" and salary is not None and salary <= 0:
            raise serializers.ValidationError(
                {"new_salary": "Le nouveau salaire doit être supérieur à 0 FCFA."})
        return attrs

    def create(self, validated_data):
        from payroll.hr_services import default_letter_content

        request = self.context.get("request")
        instance = HRLetter(**validated_data)
        if request:
            instance.created_by = request.user
        if not instance.title:
            instance.title = instance.get_kind_display()
        if content_is_empty(instance.content):
            instance.content = default_letter_content(instance)
        instance.save()
        if request:
            from audit.services import log_action
            log_action(actor=request.user, action="hr.letter.create",
                       entity=f"letter:{instance.id}",
                       after={"reference": instance.reference,
                              "employee": instance.employee.name,
                              "kind": instance.kind})
        return instance

    def update(self, instance, validated_data):
        from payroll.hr_services import default_letter_content

        request = self.context.get("request")
        before = {"status": instance.status, "kind": instance.kind}
        old_default = default_letter_content(instance)
        instance = super().update(instance, validated_data)
        if "content" not in validated_data and instance.content == old_default:
            instance.content = default_letter_content(instance)
            instance.save(update_fields=["content", "updated_at"])
        elif "content" in validated_data and content_is_empty(instance.content):
            instance.content = default_letter_content(instance)
            instance.save(update_fields=["content", "updated_at"])
        if request:
            from audit.services import log_action
            log_action(actor=request.user, action="hr.letter.update",
                       entity=f"letter:{instance.id}", before=before,
                       after={"status": instance.status, "kind": instance.kind})
        return instance


class DocumentSignatureSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentSignature
        fields = ["id", "role", "signer_name", "signed_at", "content_hash"]
        read_only_fields = fields


class PayslipLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayslipLine
        fields = ["id", "payslip", "kind", "label", "amount"]


class PayslipPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayslipPayment
        fields = ["id", "payslip", "amount", "entry_ref", "paid_at"]


class PayrollSheetSerializer(serializers.ModelSerializer):
    slips = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()

    class Meta:
        model = PayrollSheet
        fields = ["id", "month", "status", "stamp", "total", "slips"]

    def get_slips(self, o):
        return PayslipSerializer(o.slips.all().order_by("number"), many=True).data

    def get_total(self, o):
        return sum(s.net for s in o.slips.all())


class PayslipSerializer(serializers.ModelSerializer):
    lines = PayslipLineSerializer(many=True, read_only=True)
    payments = PayslipPaymentSerializer(many=True, read_only=True)
    employee_name = serializers.SerializerMethodField()
    paid = serializers.SerializerMethodField()
    month = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    paid_at = serializers.SerializerMethodField()

    class Meta:
        model = Payslip
        fields = ["id", "sheet", "number", "user", "employee", "employee_name", "position",
                  "site_name", "month", "base_amount", "gross", "deductions", "net", "paid",
                  "status", "paid_at", "lines", "payments"]

    def get_employee_name(self, o):
        return o.employee.name if o.employee_id else ""

    def get_month(self, o):
        return o.sheet.month.isoformat() if o.sheet_id else ""

    def get_paid(self, o):
        return sum(p.amount for p in o.payments.all())

    def get_status(self, o):
        paid = sum(p.amount for p in o.payments.all())
        return "paye" if o.net and paid >= o.net else "en_attente"

    def get_paid_at(self, o):
        pays = list(o.payments.all())
        if not pays:
            return None
        return max(p.paid_at for p in pays).isoformat()
