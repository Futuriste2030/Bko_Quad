"""Paie façon Hub Digi adaptée : UNE fiche mensuelle d'équipe (mois unique),
lignes = employés (numéro auto, poste/site figés, statut En attente/Payé),
cachet directeur exigé avant clôture. Brut depuis contrat + avances déduites,
versements décaissés en caisse. Montants entiers FCFA."""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

DRAFT = "draft"
PENDING_SIGNATURE = "pending_signature"
SIGNED = "signed"
CANCELLED = "cancelled"
DOCUMENT_STATUS_CHOICES = [
    (DRAFT, "Brouillon"),
    (PENDING_SIGNATURE, "En attente de signature"),
    (SIGNED, "Signé"),
    (CANCELLED, "Annulé"),
]


def _reference(prefix):
    return f"{prefix}-{timezone.localdate():%Y}-{uuid.uuid4().hex[:6].upper()}"


def contract_reference():
    return _reference("CTR")


def letter_reference():
    return _reference("LET")


class Employee(models.Model):
    name = models.CharField(max_length=120)
    role = models.CharField(max_length=60, default="agent")
    site = models.ForeignKey("catalogue.Site", null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="employees")
    user = models.OneToOneField(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="employee_profile",
        help_text="Compte de connexion utilisé pour signer les documents RH")
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Contract(models.Model):
    """Contrat de travail : données RH + document signable.

    Le texte est libre (modèle pré-rempli à la création), figé dès l'envoi
    en signature. Le PDF signé et son empreinte sont conservés.
    """

    TYPE_CHOICES = [
        ("cdi", "CDI — durée indéterminée"),
        ("cdd", "CDD — durée déterminée"),
        ("stage", "Stage"),
        ("apprentissage", "Apprentissage"),
        ("autre", "Autre"),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="contracts")
    reference = models.CharField(max_length=30, unique=True, default=contract_reference,
                                 editable=False)
    contract_type = models.CharField(max_length=15, choices=TYPE_CHOICES, default="cdi")
    start = models.DateField()
    end = models.DateField(null=True, blank=True)
    base_salary = models.PositiveIntegerField(help_text="FCFA, entier")
    frequency = models.CharField(max_length=10, default="monthly")
    job_title = models.CharField(max_length=120, blank=True, default="",
                                 help_text="Poste occupé")
    workplace = models.CharField(max_length=120, blank=True, default="",
                                 help_text="Lieu de travail")
    weekly_hours = models.PositiveSmallIntegerField(default=40,
                                                    help_text="Heures par semaine")
    trial_months = models.PositiveSmallIntegerField(default=0,
                                                    help_text="Période d'essai, en mois")
    content = models.TextField(blank=True, default="", help_text="Texte du contrat")
    status = models.CharField(max_length=20, choices=DOCUMENT_STATUS_CHOICES, default=DRAFT)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="hr_contracts_created")
    sent_at = models.DateTimeField(null=True, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    signed_pdf = models.FileField(upload_to="rh/contracts/", blank=True, null=True)
    signed_hash = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start", "-id"]

    def __str__(self):
        return f"{self.reference} — {self.employee}"


class HRLetter(models.Model):
    """Courrier RH : promotion, augmentation, prime, attestation…"""

    KIND_CHOICES = [
        ("promotion", "Lettre de promotion"),
        ("augmentation", "Lettre d'augmentation de salaire"),
        ("prime", "Lettre de prime spéciale"),
        ("attestation", "Attestation de travail"),
        ("autre", "Autre courrier"),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="hr_letters")
    contract = models.ForeignKey(Contract, null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="letters")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="autre")
    title = models.CharField(max_length=160, blank=True, default="")
    reference = models.CharField(max_length=30, unique=True, default=letter_reference,
                                 editable=False)
    date = models.DateField(default=timezone.localdate)
    content = models.TextField(blank=True, default="")
    amount = models.PositiveIntegerField(null=True, blank=True,
                                         help_text="Prime spéciale, FCFA entier")
    new_salary = models.PositiveIntegerField(null=True, blank=True,
                                             help_text="Nouveau salaire de base, FCFA entier")
    new_job_title = models.CharField(max_length=120, blank=True, default="")
    effective_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=DOCUMENT_STATUS_CHOICES, default=DRAFT)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="hr_letters_created")
    sent_at = models.DateTimeField(null=True, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    signed_pdf = models.FileField(upload_to="rh/letters/", blank=True, null=True)
    signed_hash = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.reference} — {self.employee}"


class DocumentSignature(models.Model):
    """Signature électronique simple, append-only.

    Une ligne par partie (entreprise, salarié). L'image, l'horodatage,
    l'adresse IP et l'empreinte du contenu sont figés.
    """

    ROLE_CHOICES = [("company", "Entreprise"), ("employee", "Salarié")]

    contract = models.ForeignKey(Contract, null=True, blank=True,
                                 on_delete=models.PROTECT, related_name="signatures")
    letter = models.ForeignKey(HRLetter, null=True, blank=True,
                               on_delete=models.PROTECT, related_name="signatures")
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    signer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                               on_delete=models.SET_NULL, related_name="hr_signatures")
    signer_name = models.CharField(max_length=120)
    signature_image = models.ImageField(upload_to="rh/signatures/")
    signed_at = models.DateTimeField(default=timezone.now)
    ip = models.CharField(max_length=45, blank=True, default="")
    user_agent = models.CharField(max_length=300, blank=True, default="")
    content_hash = models.CharField(max_length=64)

    class Meta:
        ordering = ["signed_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["contract", "role"],
                                    condition=models.Q(contract__isnull=False),
                                    name="uniq_contract_signature_role"),
            models.UniqueConstraint(fields=["letter", "role"],
                                    condition=models.Q(letter__isnull=False),
                                    name="uniq_letter_signature_role"),
            models.CheckConstraint(
                condition=(models.Q(contract__isnull=False, letter__isnull=True)
                           | models.Q(contract__isnull=True, letter__isnull=False)),
                name="signature_one_document"),
        ]

    def __str__(self):
        return f"{self.get_role_display()} — {self.signer_name}"

    def save(self, *args, **kwargs):
        if self.pk and DocumentSignature.objects.filter(pk=self.pk).exists():
            raise RuntimeError("Signature append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Signature append-only.")


class PayrollSheet(models.Model):
    """Fiche mensuelle unique de l'équipe (Hub Digi : FichePaie)."""
    STATUS_CHOICES = [("draft", "Brouillon"), ("closed", "Clôturée")]
    month = models.DateField(unique=True, help_text="Premier jour du mois")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="draft")
    stamp = models.ImageField(upload_to="paie/", blank=True, null=True,
                              help_text="Cachet du directeur, exigé avant clôture")

    def __str__(self):
        return f"Paie {self.month:%m/%Y} ({self.status})"


class Payslip(models.Model):
    """Ligne de la fiche mensuelle = 1 employé (Hub Digi : LignePaie).

    N°, statut et date : automatiques. Tout le reste (base, primes,
    retenues) : saisie libre. L'employé reprend le compte utilisateur
    (prénom + nom), contrat optionnel (base 0 si aucun)."""
    LINE_PENDING = "en_attente"
    LINE_PAID = "paye"
    sheet = models.ForeignKey(PayrollSheet, on_delete=models.CASCADE, related_name="slips")
    user = models.ForeignKey("accounts.User", null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="+")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="payslips")
    number = models.CharField(max_length=30, blank=True, help_text="PAIE-AAAA-MM-NNN auto")
    position = models.CharField(max_length=60, blank=True, default="",
                                help_text="Poste figé à la génération")
    site_name = models.CharField(max_length=120, blank=True, default="",
                                 help_text="Site figé à la génération")
    base_amount = models.PositiveIntegerField(default=0, help_text="Base saisie, FCFA entier")
    gross = models.PositiveIntegerField(default=0)
    deductions = models.PositiveIntegerField(default=0)
    net = models.PositiveIntegerField(default=0)
    pdf_file = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["employee", "sheet"], name="uniq_payslip_per_period"),
        ]

    def __str__(self):
        return f"{self.number or self.employee} net {self.net}"

    def save(self, *args, **kwargs):
        if not self.number and self.sheet_id:
            mm = f"{self.sheet.month.month:02d}"
            n = Payslip.objects.filter(sheet_id=self.sheet_id).count() + 1
            self.number = f"PAIE-{self.sheet.month.year}-{mm}-{n:03d}"
        super().save(*args, **kwargs)


class PayslipLine(models.Model):
    KIND_CHOICES = [("gain", "Gain"), ("deduction", "Retenue")]
    payslip = models.ForeignKey(Payslip, on_delete=models.PROTECT, related_name="lines")
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    label = models.CharField(max_length=120)
    amount = models.PositiveIntegerField(help_text="FCFA, entier")


class PayslipPayment(models.Model):
    payslip = models.ForeignKey(Payslip, on_delete=models.PROTECT, related_name="payments")
    amount = models.PositiveIntegerField(help_text="FCFA, entier")
    entry_ref = models.CharField(max_length=20, blank=True, default="", help_text="Bordereau caisse")
    paid_at = models.DateTimeField(auto_now_add=True)
