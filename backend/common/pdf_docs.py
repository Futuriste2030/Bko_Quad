"""PDF serveur (reportlab) : reçus, factures, rapprochement bancaire.

Même contenu que l'écran, en vrai PDF à envoyer au client.
Habillage institutionnel : papier blanc, encre noire, filets nets,
en-tête entreprise avec logo, totaux soulignés, pied de page paginé.
"""

import io
import unicodedata
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings

BAMAKO = ZoneInfo("Africa/Bamako")

# Charte BKO : encre noire + 1 accent orange, sans fioritures.
ACCENT = "#E8590C"
DARK = "#1a1a1a"
ZEBRA = "#f4f1ec"
MUTED = "#5c5c5c"
LIGHT = "#faf8f2"


def fcfa(n):
    return f"{int(round(n or 0)):,} FCFA".replace(",", " ")


def fmt_duree(minutes):
    """Unité de facturation : minutes, heures ou jours (ex. 15 min, 1H, 2 jours)."""
    m = int(minutes or 0)
    if m < 60:
        return f"{m} min"
    if m < 1440:
        h, r = divmod(m, 60)
        return f"{h}H" if not r else f"{h}H{r:02d}"
    d, rem = divmod(m, 1440)
    base = f"{d} jour" + ("s" if d > 1 else "")
    if not rem:
        return base
    h, r = divmod(rem, 60)
    return base + (f" {h}H" if not r else f" {h}H{r:02d}")


def duree_libelle(minutes):
    """Durée en clair pour le client : « 1 heure », « 2 heures », « 1 jour », « 2 jours 3H »."""
    m = int(minutes or 0)
    if m >= 1440:
        d, rem = divmod(m, 1440)
        libelle = f"{d} jour" + ("s" if d > 1 else "")
        h, _ = divmod(rem, 60)
        if h:
            libelle += f" {h}H"
        return libelle
    if m < 60:
        return f"{m} min"
    h, r = divmod(m, 60)
    if r == 0:
        return f"{h} heure" + ("s" if h > 1 else "")
    return fmt_duree(m)


def bamako_date(value):
    if value is None:
        return "—"
    if isinstance(value, datetime):
        value = value.astimezone(BAMAKO)
    return value.strftime("%d/%m/%Y")


def code_part(value, length):
    ascii_only = unicodedata.normalize("NFKD", str(value or "")).encode(
        "ascii", "ignore").decode().upper()
    ascii_only = "".join(c for c in ascii_only if c.isalnum())
    return (ascii_only or "X")[:length]


def facture_number(seq, site, client, at=None):
    at = at or datetime.now(BAMAKO)
    if isinstance(at, datetime):
        at = at.astimezone(BAMAKO)
    d = at.strftime("%d%m%Y")
    return f"BKO-{code_part(site, 12)}-{code_part(client, 8)}-{d}-{int(seq):04d}"


def _draw_page_footer(canvas, doc):
    """Pied de page institutionnel : référence, date d'édition, pagination."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.colors import HexColor

    width, height = A4
    canvas.saveState()
    canvas.setStrokeColor(HexColor("#b5b0a6"))
    canvas.setLineWidth(0.5)
    canvas.line(40, 40, width - 40, 40)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(HexColor(MUTED))
    canvas.drawString(40, 26, "BKO Quad Hub — document généré le "
                     + datetime.now(BAMAKO).strftime("%d/%m/%Y à %H:%M"))
    canvas.drawRightString(width - 40, 26, f"Page {doc.page}")
    canvas.restoreState()


def _styles():
    from reportlab.lib.colors import HexColor
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

    base = ParagraphStyle("base", fontName="Helvetica", fontSize=10, leading=13,
                          textColor=HexColor(DARK), spaceAfter=4)
    return {
        "base": base,
        "title": ParagraphStyle("title", parent=base, fontName="Helvetica-Bold",
                                fontSize=19, leading=22, spaceAfter=2,
                                textColor=HexColor(DARK)),
        "subtitle": ParagraphStyle("subtitle", parent=base, fontName="Helvetica",
                                    fontSize=9.5, leading=12, spaceAfter=8,
                                    textColor=HexColor(MUTED)),
        "h1": ParagraphStyle("h1", parent=base, fontName="Helvetica-Bold",
                             fontSize=13, leading=16, spaceAfter=2,
                             textColor=HexColor(DARK)),
        "small": ParagraphStyle("small", parent=base, fontSize=9, leading=11,
                                textColor=HexColor(MUTED)),
        "thanks": ParagraphStyle("thanks", parent=base, fontName="Helvetica-Oblique",
                                  fontSize=10, leading=13, alignment=TA_CENTER,
                                  textColor=HexColor(MUTED)),
        "right": ParagraphStyle("right", parent=base, alignment=TA_RIGHT),
        "left": ParagraphStyle("left", parent=base, alignment=TA_LEFT),
        "center": ParagraphStyle("center", parent=base, alignment=TA_CENTER),
        "total": ParagraphStyle("total", parent=base, fontName="Helvetica-Bold",
                                fontSize=11, leading=14, textColor=HexColor(DARK)),
        "label": ParagraphStyle("label", parent=base, fontName="Helvetica-Bold",
                                fontSize=9, leading=11, textColor=HexColor(MUTED)),
    }


def _logo_image(height, max_side=200):
    """Logo complet de l'entreprise (BKO Quad) pour l'en-tête papier.

    Le JPEG source contient une marge blanche importante : on recadre sur la
    boîte englobante du logo avant mise à l'échelle, pour qu'il soit bien
    visible sur le PDF.
    """
    from PIL import Image as PILImage
    from reportlab.platypus import Image as RLImage

    # Cherche d'abord dans backend/ (prod : copié avec COPY backend/),
    # puis à la racine du dépôt (dev local).
    for candidate in (Path(settings.BASE_DIR) / "logo_bko_quad.jpeg",
                      Path(settings.BASE_DIR).parent / "logo_bko_quad.jpeg"):
        if candidate.exists():
            src = candidate
            break
    else:
        src = None
    if src is not None and src.exists():
        try:
            rgb = PILImage.open(src).convert("RGB")
            grey = rgb.convert("L")
            bbox = grey.point(lambda x: 0 if x > 200 else 255).getbbox()
            if bbox:
                im = rgb.crop(bbox)
            else:
                im = rgb
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            buf.seek(0)
            out = RLImage(buf, height=height)
            out.drawWidth = out.imageWidth * (height / out.imageHeight)
            out.drawHeight = height
            if out.drawWidth > max_side:
                scale = max_side / out.drawWidth
                out.drawWidth = max_side
                out.drawHeight = height * scale
            return out
        except Exception:
            pass
    fallback = Path(settings.BASE_DIR).parent / "frontend" / "public" / "android-chrome-512x512.png"
    if fallback.exists():
        return _thumb_image(fallback, height, max_side=max_side)
    return None


def _thumb_image(source, height, max_side=400):
    """Image réduite (mémoire) : PDF légers, envoyables sur WhatsApp."""
    from PIL import Image as PILImage
    from reportlab.platypus import Image as RLImage

    try:
        img = PILImage.open(source)
        img.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        out = RLImage(buf, height=height)
        out.drawWidth = out.imageWidth * (height / out.imageHeight)
        out.drawHeight = height
        return out
    except Exception:
        return None


def _qr_image(value, size=110):
    import qrcode
    from reportlab.platypus import Image as RLImage

    img = qrcode.make(value)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return RLImage(buf, width=size, height=size)


def _media_image(path, height):
    if not path:
        return None
    full = Path(settings.MEDIA_ROOT) / str(path)
    if not full.exists():
        return None
    return _thumb_image(full, height, max_side=200)


def _header_flowables(company, title, meta):
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import HRFlowable, Paragraph, Spacer, Table, TableStyle

    st = _styles()
    out = []
    # Bandeau d'accent en tête de page.
    out.append(HRFlowable(width="100%", thickness=3, color=HexColor(ACCENT),
                          spaceAfter=10, spaceBefore=0))
    logo = _logo_image(60)
    info = [Paragraph(company.name or "BKO Quad", st["h1"])]
    contact = " · ".join(x for x in [company.address, company.phone, company.email] if x)
    if contact:
        info.append(Paragraph(contact, st["small"]))
    if company.nif or company.rccm:
        info.append(Paragraph(
            f"NIF : {company.nif or '—'} · RCCM : {company.rccm or '—'}",
            st["small"]))
    if logo is not None:
        head = Table([[logo, info]], colWidths=[105, 425])
    else:
        head = Table([[info]], colWidths=[530])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    out.append(head)
    out.append(HRFlowable(width="100%", thickness=1.2, color=HexColor(DARK),
                          spaceAfter=12, spaceBefore=2))
    # Titre du document + méta.
    out.append(Paragraph(title, st["title"]))
    out.append(Paragraph(meta, st["subtitle"]))
    out.append(HRFlowable(width="100%", thickness=0.6, color=HexColor("#b5b0a6"),
                          spaceAfter=12, spaceBefore=2, dash=(4, 3)))
    return out


def _section_table(st, title, rows, total_last=False):
    """Tableau encadré pro : bandeau titre + grille + zébrures."""
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors
    from reportlab.lib.colors import HexColor

    data = [[title, ""]] + [[r[0], r[1]] for r in rows]
    t = Table(data, colWidths=[360, 170])
    style = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(DARK)),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("LEFTPADDING", (0, 0), (-1, 0), 8),
        ("RIGHTPADDING", (0, 0), (-1, 0), 8),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("GRID", (0, 1), (-1, -1), 0.4, HexColor("#b5b0a6")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, HexColor(LIGHT)]),
        ("ALIGN", (1, 1), (1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ("LEFTPADDING", (0, 1), (-1, -1), 8),
        ("RIGHTPADDING", (0, 1), (-1, -1), 8),
    ]
    if total_last:
        style += [("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                  ("LINEABOVE", (0, -1), (-1, -1), 1.5, HexColor(ACCENT)),
                  ("LINEBELOW", (0, -1), (-1, -1), 1.5, HexColor(ACCENT)),
                  ("BACKGROUND", (0, -1), (-1, -1), HexColor(ZEBRA))]
    t.setStyle(TableStyle(style))
    return t


def _kv_table(st, rows, total_last=False):
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors
    from reportlab.lib.colors import HexColor

    data = [[r[0], r[1]] for r in rows]
    t = Table(data, colWidths=[360, 170])
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, HexColor("#b5b0a6")),
        ("ROWBACKGROUNDS", (0, 0), (-1, -2),
         [colors.white, HexColor(LIGHT)]),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]
    if total_last:
        style += [("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                  ("LINEABOVE", (0, -1), (-1, -1), 1.5, HexColor(ACCENT)),
                  ("LINEBELOW", (0, -1), (-1, -1), 1.5, HexColor(ACCENT)),
                  ("BACKGROUND", (0, -1), (-1, -1), HexColor(ZEBRA))]
    t.setStyle(TableStyle(style))
    return t


def _footer_flowables(company, booking):
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

    st = _styles()
    left = [_qr_image(f"BKO:{booking.code}:{booking.qr_token}", size=90),
            Paragraph(booking.code, st["center"])]
    thanks = company.thanks or "Merci de votre confiance."
    suffix = f" — {company.signature_name}" if company.signature_name else ""
    right = [Paragraph(f"{thanks}{suffix}", st["thanks"])]
    box = Table([[left, right]], colWidths=[150, 380])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor(LIGHT)),
        ("BOX", (0, 0), (-1, -1), 1.5, HexColor(DARK)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    out = [Spacer(1, 12), box]

    # Bloc cachet + signature de l'entreprise, bien positionnés.
    stamp = _media_image(company.stamp, 55)
    sign = _media_image(company.signature, 45)
    if stamp or sign:
        from reportlab.platypus import KeepTogether
        block = []
        block.append(Spacer(1, 8))
        block.append(Paragraph("Cachet et signature de l'entreprise",
                             st["label"]))
        block.append(Spacer(1, 3))
        sig_table = Table(
            [[stamp or Paragraph("Cachet", st["small"]),
              sign or Paragraph("Signature", st["small"])]],
            colWidths=[265, 265])
        sig_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("BOX", (0, 0), (0, 0), 1, HexColor("#b5b0a6")),
            ("BOX", (1, 0), (1, 0), 1, HexColor("#b5b0a6")),
        ]))
        block.append(sig_table)
        name_line = company.signature_name or company.name or "BKO Quad"
        block.append(Spacer(1, 3))
        block.append(Paragraph(
            f"{name_line} · {bamako_date(datetime.now(BAMAKO))}",
            st["small"]))
        out.append(KeepTogether(block))
    return out


def _render(filename_title, flowables):
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Spacer

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=40, rightMargin=40,
                            topMargin=40, bottomMargin=50, title=filename_title)
    doc.build(flowables + [Spacer(1, 12)],
             onFirstPage=_draw_page_footer, onLaterPages=_draw_page_footer)
    buf.seek(0)
    return buf.read()


def _split_name(full):
    parts = str(full or "").strip().split()
    if not parts:
        return "—", "—"
    if len(parts) == 1:
        return parts[0], "—"
    return parts[0], " ".join(parts[1:])


def _booking_context(booking_id):
    from bookings.models import Booking
    from catalogue.models import Activity
    from common.models import CompanyProfile
    from payments.models import Invoice, Payment

    booking = Booking.objects.select_related(
        "customer", "slot__activity__site").prefetch_related(
        "lines", "payments", "invoices", "vehicles").get(pk=booking_id)
    company, _ = CompanyProfile.objects.get_or_create(pk=1)
    activity = booking.slot.activity
    site = activity.site
    pays = [p for p in booking.payments.all() if p.status == "paid"]
    invoices = list(booking.invoices.all())
    # Immatriculations : engins affectés à la réservation, sinon ceux du créneau.
    plates = [v.plate for v in booking.vehicles.all().order_by("plate")]
    if not plates:
        try:
            from catalogue.models import Vehicle
            plates = [v.plate for v in Vehicle.objects.filter(
                pk__in=booking.slot.vehicles.values_list("id", flat=True))]
        except Exception:
            plates = []
    return {
        "booking": booking, "company": company, "activity": activity,
        "site": site, "pays": pays, "plates": plates,
        "paid": sum(p.amount for p in pays),
        "invoice": invoices[0] if invoices else None,
    }


def _order_rows(ctx):
    """Détail commande : lignes serveur, sinon découpage solo/duo, sinon enfant.

    Chaque ligne porte l'unité de facturation (durée du créneau : 1H, 2 jours…)
    et sa remise manuelle. Retourne aussi le sous-total brut et la remise totale.
    """
    from reportlab.platypus import Paragraph

    booking = ctx["booking"]
    activity = ctx["activity"]
    st = _styles()
    rows = []
    plates = ctx.get("plates") or []
    booked = int((booking.slot.end - booking.slot.start).total_seconds() // 60)
    units = max(1, int(getattr(booking, "units", 1) or 1))
    unit_m = int(getattr(activity, "duration_minutes", 60) or 60)
    duree = duree_libelle(booked)
    unit_label = duree_libelle(unit_m)
    # Unité de facturation en tête (H) : 25 000 FCFA pour 1 heure (formule Quad 1H),
    # ou 2 heures = 2 unités ; basculement sur des jours si le créneau déborde.
    rows.append(("Formule", f"{activity.name} — unité : {unit_label}"))
    if units > 1:
        rows.append(("Durée réservée", f"{duree} = {units} × {unit_label}"))
    lines = list(booking.lines.all())
    suffix = f"· {duree}" if units == 1 else f"· {units} × {unit_label}"
    velo = getattr(booking, "resource_type", "quad") == "velo"
    engin = "vélo" if velo else "quad"
    if lines:
        for line in lines:
            engins_pl = "s" if line.quads > 1 else ""
            rows.append((f"Ligne {line.rank} — {line.persons} pers., "
                         f"{line.quads} {engin}{engins_pl} {suffix}",
                         fcfa(line.line_total)))
            if line.discount:
                rows.append((f"Remise ligne {line.rank} (manuelle)",
                             f"− {fcfa(line.discount)}"))
    else:
        name = (activity.name or "").lower()
        kids = "kid" in name or "enfant" in name
        if kids:
            rows.append((f"Commande — {booking.quads} quad enfant, "
                         f"{booking.persons} personne(s) {suffix}",
                         f"{booking.persons} × {fcfa(booking.unit_price)}"
                         + (f" × {units}" if units > 1 else "")))
        elif velo:
            rows.append((f"Commande — {booking.quads} vélo(s), "
                         f"{booking.persons} personne(s) {suffix}",
                         f"{booking.persons} × {fcfa(booking.unit_price)}"
                         + (f" × {units}" if units > 1 else "")))
        else:
            solo = 2 * booking.quads - booking.persons
            duo = booking.persons - booking.quads
            if solo > 0:
                rows.append((f"Quads solo (1 pers.) {suffix} — "
                             f"{solo} × {fcfa(25000)}", fcfa(solo * 25000)))
            if duo > 0:
                rows.append((f"Quads duo (2 pers.) {suffix} — "
                             f"{duo} × {fcfa(30000)}", fcfa(duo * 30000)))
            rows.append((f"Commande — {booking.persons} personne(s), "
                         f"{booking.quads} quad(s) {suffix}", fcfa(booking.total)))
    if plates:
        rows.append(("N° des engins", ", ".join(plates)))
    brut = sum(l.line_total for l in lines)
    remise = sum(l.discount for l in lines)
    return rows, st, brut, remise


def pdf_recu(booking_id):
    from reportlab.platypus import Paragraph, Spacer

    ctx = _booking_context(booking_id)
    booking, company = ctx["booking"], ctx["company"]
    st = _styles()
    first, last = _split_name(ctx["booking"].customer.name)
    flow = _header_flowables(
        company, f"REÇU DE PAIEMENT {booking.code}",
        f"Émis le {bamako_date(datetime.now(BAMAKO))} · Réservation {booking.code} · "
        f"Statut : {booking.get_status_display()}")
    # Bloc client.
    flow.append(_section_table(st, "CLIENT", [
        ("Prénom", first), ("Nom", last),
        ("Téléphone", ctx["booking"].customer.phone or "—"),
        ("Créneau", f"{ctx['activity'].name} {bamako_date(ctx['booking'].slot.start)}"),
        ("Site", ctx["site"].name),
        ("Statut", booking.get_status_display()),
    ]))
    flow.append(Spacer(1, 8))
    rows, _, brut, remise = _order_rows(ctx)
    if remise:
        rows += [("Sous-total", fcfa(brut)),
                 ("Remise manuelle", f"− {fcfa(remise)}")]
    rows += [("Total net à payer", fcfa(booking.total)),
             ("Payé (comptant, sur place)", fcfa(ctx["paid"])),
             ("Reste dû", fcfa(max(0, booking.total - ctx["paid"])))]
    flow.append(_section_table(st, "DÉTAIL DE LA COMMANDE", rows, total_last=True))
    if ctx["pays"]:
        flow.append(Paragraph(f"Règlement : {ctx['pays'][0].reference}", st["small"]))
    else:
        flow.append(Paragraph("Aucun encaissement enregistré.", st["small"]))
    flow += _footer_flowables(company, booking)
    return f"recu-{booking.code}.pdf", _render(f"Reçu {booking.code}", flow)


def pdf_facture(booking_id):
    from reportlab.platypus import Paragraph, Spacer

    ctx = _booking_context(booking_id)
    booking, company = ctx["booking"], ctx["company"]
    if not ctx["invoice"]:
        raise ValueError("Émettez la facture d'abord.")
    fnum = facture_number(ctx["invoice"].number, ctx["site"].name,
                          booking.customer.name, ctx["invoice"].issued_at)
    st = _styles()
    first, last = _split_name(booking.customer.name)
    flow = _header_flowables(
        company, f"FACTURE {fnum}",
        f"Émise le {bamako_date(ctx['invoice'].issued_at)} · Réservation {booking.code} · "
        f"Statut : {booking.get_status_display()}")
    flow.append(_section_table(st, "CLIENT", [
        ("Prénom", first), ("Nom", last),
        ("Téléphone", booking.customer.phone or "—"),
        ("Créneau", f"{ctx['activity'].name} {bamako_date(booking.slot.start)}"),
        ("Site", ctx["site"].name),
        ("Statut", booking.get_status_display()),
    ]))
    flow.append(Spacer(1, 8))
    rows, _, brut, remise = _order_rows(ctx)
    if remise:
        rows += [("Sous-total", fcfa(brut)),
                 ("Remise manuelle", f"− {fcfa(remise)}")]
    rows.append(("Total net facturé", fcfa(booking.total)))
    flow.append(_section_table(st, "DÉTAIL DE LA COMMANDE", rows, total_last=True))
    flow += _footer_flowables(company, booking)
    return f"facture-{fnum}.pdf", _render(f"Facture {fnum}", flow)


def pdf_bank_report(*, year, month, bank=None, site_name=None, rows, balance,
                    deposits, withdrawals, fees=0, statement=None):
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors
    from reportlab.lib.colors import HexColor

    from common.models import CompanyProfile

    company, _ = CompanyProfile.objects.get_or_create(pk=1)
    st = _styles()
    label = f"{month:02d}/{year}"
    scope = " · ".join(x for x in (site_name, bank) if x)
    title = "RAPPROCHEMENT BANCAIRE" + (f" — {scope}" if scope else "")
    flow = _header_flowables(
        company, title,
        f"Période : {label} · Édité le {bamako_date(datetime.now(BAMAKO))}"
        + (f" · {scope}" if scope else " · Toutes banques"))
    data = [["Date", "Type", "Motif", "Réf", "Nom", "Débit", "Crédit", "Solde"]]
    for r in rows:
        tx = r["tx"]
        tlabel = {"deposit": "Versement", "withdrawal": "Retrait",
                  "transfer": "Virement"}.get(tx.type, tx.type)
        ref = tx.receipt_number or tx.check_number or tx.counterparty_bank or tx.bank or "—"
        data.append([
            bamako_date(tx.date), tlabel, tx.reason, ref,
            f"{tx.person_first_name} {tx.person_last_name}".strip(),
            fcfa(r["debit"]) if r["debit"] else "—",
            fcfa(r["credit"]) if r["credit"] else "—",
            fcfa(r["running"]),
        ])
    t = Table(data, repeatRows=1,
              colWidths=[55, 60, 110, 60, 80, 55, 55, 60])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(DARK)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, HexColor(LIGHT)]),
        ("LINEBELOW", (0, 0), (-1, 0), 1.5, HexColor(ACCENT)),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, HexColor("#b5b0a6")),
        ("ALIGN", (5, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("BOX", (0, 0), (-1, -1), 1.2, HexColor(DARK)),
    ]))
    flow.append(t)
    flow.append(Spacer(1, 8))
    flow.append(_section_table(st, "TOTAUX", [
        ("Solde théorique du logiciel", fcfa(balance)),
        ("Versements", fcfa(deposits)),
        ("Retraits", fcfa(withdrawals)),
        ("Net du mois", fcfa(deposits - withdrawals)),
    ] + ([("Frais et agios", fcfa(fees))] if fees else [])
      + ([("Solde du relevé bancaire", fcfa(statement))] if statement else [])
      + ([("Écart à justifier", fcfa(statement - (balance - (fees or 0))))]
         if statement else []), total_last=bool(statement)))
    return f"rapprochement-banque-{year}-{month:02d}" + \
        (f"-{code_part(site_name, 12)}" if site_name else "") + \
        (f"-{code_part(bank, 12)}" if bank else "") + ".pdf", \
        _render(title, flow)