"""PDF des documents RH : contrat, promotion, augmentation, prime, attestation.

Le PDF final reprend le texte figé, les signatures de l'entreprise et du
salarié, et l'empreinte du contenu. Un aperçu porte la mention BROUILLON.
"""

from xml.sax.saxutils import escape

from common.pdf_docs import (
    _header_flowables, _media_image, _render, _styles, bamako_date, fcfa,
)
from payroll.hr_content import looks_like_html, reportlab_paragraphs
from payroll.hr_services import (
    contract_type_label, content_hash, letter_kind_label, signature_for,
)
from payroll.models import Contract, DocumentSignature


def _body_paragraphs(content, style):
    from reportlab.platypus import Paragraph

    if looks_like_html(content):
        for markup in reportlab_paragraphs(content):
            yield Paragraph(markup, style)
        return
    for block in (content or "").split("\n\n"):
        block = block.strip()
        if block:
            yield Paragraph(escape(block).replace("\n", "<br/>"), style)


def _signature_table(document, company, styles, final):
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

    company_sig = signature_for(document, "company")
    employee_sig = signature_for(document, "employee")
    company_img = (_media_image(company_sig.signature_image.name, 58)
                   if company_sig else None)
    employee_img = (_media_image(employee_sig.signature_image.name, 58)
                    if employee_sig else None)
    company_name = (company_sig.signer_name if company_sig
                    else (company.signature_name or company.name or "La Direction"))
    company_when = bamako_date(company_sig.signed_at) if company_sig else "—"
    employee_when = bamako_date(employee_sig.signed_at) if employee_sig else "—"
    employee_name = (employee_sig.signer_name if employee_sig
                     else document.employee.name)
    data = [
        [Paragraph("<b>Pour l'entreprise</b>", styles["small"]),
         Paragraph("<b>Le salarié</b>", styles["small"])],
        [company_img or Paragraph("Signature de l'entreprise", styles["small"]),
         employee_img or Paragraph("Signature du salarié", styles["small"])],
        [Paragraph(f"{escape(company_name)}<br/>{company_when}", styles["small"]),
         Paragraph(f"{escape(employee_name)}<br/>{employee_when}", styles["small"])],
    ]
    table = Table(data, colWidths=[260, 260], rowHeights=[18, 66, 30])
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#1a1a1a")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#999999")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f1ec")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def build_hr_pdf(document, final=False):
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import Paragraph, Spacer

    from common.models import CompanyProfile

    company = CompanyProfile.objects.filter(pk=1).first() or CompanyProfile()
    styles = _styles()
    if isinstance(document, Contract):
        title = f"Contrat de travail — {contract_type_label(document)}"
        meta = (f"Référence : {document.reference} · Salarié : {document.employee.name} · "
                f"Date d'établissement : {bamako_date(document.created_at)}")
        facts = (f"Poste : {document.job_title or document.employee.role} · "
                 f"Entrée : {bamako_date(document.start)} · "
                 f"Salaire de base : {fcfa(document.base_salary)}/mois")
    else:
        title = document.title or letter_kind_label(document)
        meta = (f"Référence : {document.reference} · Salarié : {document.employee.name} · "
                f"Date : {bamako_date(document.date)}")
        facts = ""
        if document.kind == "prime" and document.amount:
            facts = f"Prime spéciale : {fcfa(document.amount)}"
        elif document.kind == "augmentation" and document.new_salary:
            facts = f"Nouveau salaire de base : {fcfa(document.new_salary)}/mois"
        elif document.kind == "promotion" and document.new_job_title:
            facts = f"Nouveau poste : {document.new_job_title}"

    flowables = _header_flowables(company, title, meta)
    if not final:
        flowables.append(Paragraph(
            "<b>BROUILLON — NON SIGNÉ</b>",
            styles["small"].clone("draft", textColor=HexColor("#E8590C"))))
        flowables.append(Spacer(1, 6))
    for paragraph in _body_paragraphs(document.content, styles["base"]):
        flowables.append(paragraph)
        flowables.append(Spacer(1, 5))
    if facts:
        flowables.append(Spacer(1, 4))
        flowables.append(Paragraph(escape(facts), styles["small"]))
    flowables.append(Spacer(1, 18))
    flowables.append(_signature_table(document, company, styles, final))
    flowables.append(Spacer(1, 8))
    if final:
        flowables.append(Paragraph(
            f"Document signé électroniquement. Empreinte du contenu (SHA-256) : "
            f"{content_hash(document)}", styles["small"]))
    else:
        flowables.append(Paragraph(
            "Aperçu sans valeur contractuelle. La version signée est générée après "
            "signature du salarié.", styles["small"]))
    return _render(f"{document.reference}.pdf", flowables)
