"""Ressources humaines : modèles de contrats/courriers, signatures, PDF.

Règles :
- un document n'est modifiable qu'en brouillon ;
- l'entreprise signe au moment de l'envoi (signature des Paramètres) ;
- le salarié signe depuis son propre compte, avec nom saisi + tracé ;
- le PDF signé et son empreinte SHA-256 sont figés, la signature est
  append-only et toutes les étapes sont auditées.
"""

import base64
import binascii
import hashlib
import io
import re

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from audit.services import log_action
from common.pdf_docs import bamako_date, fcfa
from payroll.hr_content import content_is_empty
from payroll.models import (
    CANCELLED, DRAFT, PENDING_SIGNATURE, SIGNED, Contract, DocumentSignature,
    Employee, HRLetter,
)

COMPANY_ROLE = "company"
EMPLOYEE_ROLE = "employee"


class HRWorkflowError(ValueError):
    pass


class HRPermissionError(PermissionError):
    pass


def company_profile():
    from common.models import CompanyProfile
    return CompanyProfile.objects.filter(pk=1).first()


def contract_type_label(contract):
    return dict(Contract.TYPE_CHOICES).get(contract.contract_type, contract.contract_type)


def letter_kind_label(letter):
    return dict(HRLetter.KIND_CHOICES).get(letter.kind, letter.kind)


def default_contract_content(contract):
    company = company_profile()
    employee = contract.employee
    employer = company.name if company else "BKO Quad"
    address = (company.address if company else "") or "Bamako, Mali"
    ids = []
    if company and company.nif:
        ids.append(f"NIF : {company.nif}")
    if company and company.rccm:
        ids.append(f"RCCM : {company.rccm}")
    ident = f" ({' · '.join(ids)})" if ids else ""
    job = contract.job_title or employee.role or "agent"
    workplace = contract.workplace or (employee.site.name if employee.site_id else "Bamako")
    end_text = (f"Le contrat est conclu pour une durée déterminée jusqu'au "
                f"{bamako_date(contract.end)}." if contract.end
                else "Le contrat est conclu pour une durée indéterminée.")
    trial = (f"Une période d'essai de {contract.trial_months} mois est prévue."
             if contract.trial_months else "Aucune période d'essai n'est prévue.")
    return f"""CONTRAT DE TRAVAIL — {contract_type_label(contract).upper()}

Entre les soussignés :
{employer}, dont le siège est situé à {address}{ident},
ci-après « l'Employeur »,
et {employee.name}, ci-après « le Salarié ».

Il a été convenu ce qui suit :

Article 1 — Engagement
L'Employeur engage le Salarié en qualité de {job} à compter du {bamako_date(contract.start)}.
{end_text}

Article 2 — Période d'essai
{trial}

Article 3 — Rémunération
Le salaire de base mensuel est fixé à {fcfa(contract.base_salary)}, payable selon les
modalités en vigueur dans l'entreprise.

Article 4 — Durée du travail
La durée hebdomadaire de travail est fixée à {contract.weekly_hours} heures, selon
l'organisation des plannings de l'entreprise.

Article 5 — Lieu de travail
Le Salarié exerce ses fonctions à {workplace}.

Article 6 — Obligations
Le Salarié s'engage à accomplir ses fonctions avec diligence, à respecter les
consignes de sécurité, le règlement intérieur et les règles d'utilisation des
équipements de l'entreprise.

Article 7 — Confidentialité
Le Salarié s'engage à ne pas divulguer les informations confidentielles de
l'entreprise, pendant et après l'exécution du contrat.

Article 8 — Résiliation
Le contrat peut être résilié dans les conditions prévues par la législation du
travail et, le cas échéant, par la période d'essai.

Fait à Bamako, le {bamako_date(timezone.localdate())}."""


def default_letter_content(letter):
    employee = letter.employee
    date = bamako_date(letter.date)
    effective = bamako_date(letter.effective_date) if letter.effective_date else "la date de signature"
    title = letter.title or letter_kind_label(letter)
    if letter.kind == "promotion":
        body = (f"Nous avons le plaisir de vous informer de votre promotion au poste de "
                f"{letter.new_job_title or 'vos nouvelles fonctions'}, à compter du {effective}.\n\n"
                f"Cette promotion reconnaît la qualité de votre travail et votre engagement "
                f"au sein de notre équipe. Les autres conditions de votre contrat restent "
                f"inchangées.")
    elif letter.kind == "augmentation":
        salary = fcfa(letter.new_salary or 0)
        body = (f"Nous avons le plaisir de vous informer que votre salaire de base mensuel "
                f"est porté à {salary}, à compter du {effective}.\n\n"
                f"Cette revalorisation tient compte de votre implication et de la qualité "
                f"de votre travail. Les autres conditions de votre contrat restent inchangées.")
    elif letter.kind == "prime":
        amount = fcfa(letter.amount or 0)
        body = (f"Nous avons le plaisir de vous informer de l'attribution d'une prime "
                f"spéciale de {amount}, versée avec votre rémunération.\n\n"
                f"Cette prime récompense votre engagement et votre contribution à la "
                f"réussite de l'entreprise.")
    elif letter.kind == "attestation":
        body = (f"Nous attestons que {employee.name} fait partie de notre personnel "
                f"en qualité de {employee.role or 'agent'}.\n\n"
                f"Cette attestation est délivrée à la demande de l'intéressé pour servir "
                f"et faire valoir ce que de droit.")
    else:
        body = letter.content or "Objet : …\n\nMadame, Monsieur,\n\n…\n\nCordialement."
    header = f"{title}\n\n{employee.name}\n\nBamako, le {date}\n\n"
    return (header + body + "\n\nLa Direction.").strip()


def ensure_default_content(document):
    """Remplit le texte et les champs d'affichage avant envoi."""
    if isinstance(document, Contract):
        if not document.job_title:
            document.job_title = document.employee.role or "agent"
        if not document.workplace:
            document.workplace = (document.employee.site.name
                                  if document.employee.site_id else "Bamako")
        if content_is_empty(document.content):
            document.content = default_contract_content(document)
    else:
        if not document.title:
            document.title = letter_kind_label(document)
        if content_is_empty(document.content):
            document.content = default_letter_content(document)
    return document


def canonical_content(document):
    if isinstance(document, Contract):
        parts = [
            "contract", document.reference, str(document.employee_id),
            document.employee.name, document.contract_type,
            document.start.isoformat() if document.start else "",
            document.end.isoformat() if document.end else "",
            str(document.base_salary), document.frequency, document.job_title,
            document.workplace, str(document.weekly_hours),
            str(document.trial_months), document.content,
        ]
    else:
        parts = [
            "letter", document.reference, str(document.employee_id),
            document.employee.name, document.kind, document.title,
            document.date.isoformat() if document.date else "",
            document.content, str(document.amount or ""),
            str(document.new_salary or ""), document.new_job_title,
            document.effective_date.isoformat() if document.effective_date else "",
            document.contract.reference if document.contract_id else "",
        ]
    return "\n".join(parts)


def content_hash(document):
    return hashlib.sha256(canonical_content(document).encode("utf-8")).hexdigest()


def signature_for(document, role):
    field = "contract" if isinstance(document, Contract) else "letter"
    return DocumentSignature.objects.filter(**{field: document, "role": role}).first()


def _normalise_signature_bytes(data):
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:
        raise HRWorkflowError("Signature illisible : envoyez une image PNG ou JPG.") from exc
    img = img.convert("RGBA")
    img.thumbnail((900, 900))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return ContentFile(buf.getvalue(), name="signature.png")


def signature_from_data_url(value):
    if not isinstance(value, str) or not value.strip():
        raise HRWorkflowError("Dessinez votre signature avant de valider.")
    match = re.match(r"^data:image/(png|jpe?g);base64,(.+)$", value.strip(), re.I)
    if not match:
        raise HRWorkflowError("Format de signature invalide.")
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HRWorkflowError("Signature illisible.") from exc
    if len(raw) > 2 * 1024 * 1024:
        raise HRWorkflowError("Signature trop lourde (2 Mo maximum).")
    return _normalise_signature_bytes(raw)


def _company_signature_file(company):
    if not company or not company.signature:
        raise HRWorkflowError(
            "Signature de l'entreprise manquante : importez-la dans Paramètres avant l'envoi.")
    company.signature.open("rb")
    try:
        data = company.signature.read()
    finally:
        company.signature.close()
    return _normalise_signature_bytes(data)


def _client_ip(request):
    if request is None:
        return ""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (forwarded.split(",")[0].strip() if forwarded
            else request.META.get("REMOTE_ADDR", ""))[:45]


def _user_agent(request):
    if request is None:
        return ""
    return request.META.get("HTTP_USER_AGENT", "")[:300]


def create_signature(document, role, signer, signer_name, image, request=None):
    if signature_for(document, role):
        raise HRWorkflowError("Cette signature existe déjà.")
    field = {"contract": document} if isinstance(document, Contract) else {"letter": document}
    signature = DocumentSignature(
        role=role, signer=signer, signer_name=signer_name,
        ip=_client_ip(request), user_agent=_user_agent(request),
        content_hash=content_hash(document), **field)
    signature.signature_image.save(
        f"{document.reference}-{role}.png", image, save=False)
    signature.save()
    return signature


def _audit(actor, action, document, before=None, after=None):
    kind = "contract" if isinstance(document, Contract) else "letter"
    log_action(actor=actor, action=action, entity=f"{kind}:{document.id}",
               before=before, after=after or {})


def send_document(document, actor, request=None):
    if document.status != DRAFT:
        raise HRWorkflowError("Seul un brouillon peut être envoyé en signature.")
    if not document.employee.user_id:
        raise HRWorkflowError(
            "Liez d'abord un compte de connexion à ce salarié pour la signature.")
    company = company_profile()
    if not company or not company.signature:
        raise HRWorkflowError(
            "Signature de l'entreprise manquante : importez-la dans Paramètres.")
    ensure_default_content(document)
    before = {"status": document.status}
    with transaction.atomic():
        document.save()
        signer_name = (company.signature_name or company.name or "La Direction").strip()
        create_signature(document, COMPANY_ROLE, actor, signer_name,
                         _company_signature_file(company), request)
        document.status = PENDING_SIGNATURE
        document.sent_at = timezone.now()
        fields = ["status", "sent_at", "content", "updated_at"]
        if isinstance(document, Contract):
            fields += ["job_title", "workplace"]
        else:
            fields += ["title"]
        document.save(update_fields=fields)
        _audit(actor, "hr.document.send", document, before=before,
               after={"status": document.status, "reference": document.reference,
                      "signer": signer_name})
    return document


def _apply_letter_effects(letter, actor):
    if not letter.contract_id:
        return
    contract = letter.contract
    changes = {}
    if letter.kind == "augmentation" and letter.new_salary:
        changes["base_salary"] = letter.new_salary
    if letter.kind == "promotion" and letter.new_job_title:
        changes["job_title"] = letter.new_job_title
    if not changes:
        return
    before = {field: getattr(contract, field) for field in changes}
    for field, value in changes.items():
        setattr(contract, field, value)
    contract.save(update_fields=list(changes) + ["updated_at"])
    if letter.kind == "promotion" and letter.new_job_title:
        letter.employee.role = letter.new_job_title
        letter.employee.save(update_fields=["role"])
    _audit(actor, "hr.contract.apply_letter", contract,
           before=before, after={**changes, "letter": letter.reference})


def sign_document(document, actor, full_name, signature_data, consent,
                  request=None):
    from payroll.pdf_hr import build_hr_pdf

    if document.status != PENDING_SIGNATURE:
        raise HRWorkflowError("Ce document n'est pas en attente de signature.")
    if document.employee.user_id != actor.id:
        raise HRPermissionError("Seul le salarié concerné peut signer ce document.")
    if not consent:
        raise HRWorkflowError("Confirmez avoir lu et accepté le document.")
    typed = (full_name or "").strip()
    if not typed:
        raise HRWorkflowError("Écrivez votre nom complet.")
    normalise = lambda value: re.sub(r"\s+", " ", value).strip().lower()
    if normalise(typed) != normalise(document.employee.name):
        raise HRWorkflowError("Le nom saisi ne correspond pas au nom du salarié.")
    if signature_for(document, EMPLOYEE_ROLE):
        raise HRWorkflowError("Ce document est déjà signé.")
    company_sig = signature_for(document, COMPANY_ROLE)
    if not company_sig:
        raise HRWorkflowError("Signature de l'entreprise absente : renvoyez le document.")
    if company_sig.content_hash != content_hash(document):
        raise HRWorkflowError(
            "Le document a changé depuis l'envoi. Demandez un nouvel envoi.")
    image = signature_from_data_url(signature_data)

    with transaction.atomic():
        create_signature(document, EMPLOYEE_ROLE, actor, typed, image, request)
        if isinstance(document, HRLetter):
            _apply_letter_effects(document, actor)
        pdf = build_hr_pdf(document, final=True)
        document.signed_pdf.save(f"{document.reference}.pdf",
                                 ContentFile(pdf), save=False)
        document.signed_hash = hashlib.sha256(pdf).hexdigest()
        document.status = SIGNED
        document.signed_at = timezone.now()
        document.save(update_fields=["signed_pdf", "signed_hash", "status",
                                     "signed_at", "updated_at"])
        _audit(actor, "hr.document.sign", document,
               before={"status": PENDING_SIGNATURE},
               after={"status": SIGNED, "signer": typed,
                      "signed_at": document.signed_at.isoformat(),
                      "hash": document.signed_hash})
    return document


def preview_pdf(document):
    from payroll.pdf_hr import build_hr_pdf
    return build_hr_pdf(document, final=False)


def signed_pdf_bytes(document):
    if not document.signed_pdf:
        raise HRWorkflowError("Aucun PDF signé pour ce document.")
    document.signed_pdf.open("rb")
    try:
        return document.signed_pdf.read()
    finally:
        document.signed_pdf.close()


def employee_for_user(user):
    return Employee.objects.filter(user=user).first()
