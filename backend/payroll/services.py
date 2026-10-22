"""Services paie façon Hub Digi adaptée : fiche mensuelle unique, pré-remplissage
équipe depuis contrats, cachet exigé avant clôture, versements décaissés en caisse."""

from datetime import date

from django.db import transaction
from django.db.models import Sum

from finance.services import add_entry
from payroll.models import Contract, Employee, PayrollSheet, Payslip, PayslipLine, PayslipPayment


class PayrollError(ValueError):
    pass


def open_sheet(year, month):
    sheet, created = PayrollSheet.objects.get_or_create(month=date(year, month, 1))
    if not created:
        raise PayrollError("Fiche déjà créée pour ce mois : ouvrez-la.")
    return sheet


def get_sheet(year, month):
    return PayrollSheet.objects.filter(month=date(year, month, 1)).first()


def _advances_due(name):
    from finance.models import CashAdvance

    agg = CashAdvance.objects.filter(employee_name=name).aggregate(
        given=Sum("amount"), back=Sum("repaid"))
    return (agg["given"] or 0) - (agg["back"] or 0)


def _recompute(slip):
    gains = slip.lines.filter(kind="gain").aggregate(s=Sum("amount"))["s"] or 0
    deductions = slip.lines.filter(kind="deduction").aggregate(s=Sum("amount"))["s"] or 0
    slip.gross = slip.base_amount + gains
    slip.deductions = deductions
    slip.net = max(0, slip.gross - slip.deductions)
    slip.save()


def _employee_for_user(user):
    """Reprend le compte : prénom + nom, poste et site du compte."""
    from payroll.models import Employee

    name = f"{user.first_name} {user.last_name}".strip() or user.username
    employee, _ = Employee.objects.get_or_create(
        name=name, defaults={"role": user.role, "site": user.site})
    return employee, name


def generate_payslip(*, sheet_id, user_id=None, employee_id=None, bonuses=None, legal_deductions=None):
    """Ligne employé depuis le COMPTE utilisateur (prénom + nom).

    Base = contrat si présent, sinon 0 (saisie libre ensuite).
    Retenues = légales + avances dues."""
    bonuses = bonuses or []
    legal_deductions = legal_deductions or []
    with transaction.atomic():
        sheet = PayrollSheet.objects.select_for_update().get(pk=sheet_id)
        if sheet.status != "draft":
            raise PayrollError("Fiche clôturée, lecture seule.")
        user = None
        if user_id is not None:
            from accounts.models import User

            try:
                user = User.objects.get(pk=user_id, is_active=True)
            except User.DoesNotExist:
                raise PayrollError("Compte introuvable ou désactivé.")
            if user.role == "client":
                raise PayrollError("Un compte client n'a pas de paie.")
            employee, _ = _employee_for_user(user)
        elif employee_id is not None:
            employee = Employee.objects.get(pk=employee_id)
        else:
            raise PayrollError("Compte ou employé requis.")
        contract = (
            Contract.objects.filter(employee=employee)
            .order_by("-start").first()
        )
        if Payslip.objects.filter(sheet=sheet, employee=employee).exists():
            raise PayrollError("Employé déjà présent dans la fiche.")
        slip = Payslip.objects.create(
            sheet=sheet, user=user, employee=employee,
            position=employee.role, site_name=employee.site.name if employee.site_id else "",
            base_amount=contract.base_salary if contract else 0,
        )
        gross = slip.base_amount
        for label, amount in bonuses:
            PayslipLine.objects.create(payslip=slip, kind="gain", label=label, amount=amount)
            gross += amount
        deductions = 0
        for label, amount in legal_deductions:
            PayslipLine.objects.create(payslip=slip, kind="deduction", label=label, amount=amount)
            deductions += amount
        adv = _advances_due(employee.name)
        if adv > 0:
            PayslipLine.objects.create(payslip=slip, kind="deduction",
                                       label="Avances non restituées", amount=adv)
            deductions += adv
        slip.gross, slip.deductions, slip.net = gross, deductions, max(0, gross - deductions)
        slip.save()
        return slip


def set_base_amount(*, payslip_id, amount):
    """Base saisie librement (brouillon seul) ; brut/net recalculés."""
    amount = int(amount)
    if amount < 0:
        raise PayrollError("Montant invalide.")
    with transaction.atomic():
        slip = Payslip.objects.select_for_update().get(pk=payslip_id)
        if slip.sheet.status != "draft":
            raise PayrollError("Fiche clôturée : base verrouillée.")
        slip.base_amount = amount
        _recompute(slip)
        return slip


def fill_team(*, sheet_id):
    """Pré-remplit la fiche avec tous les comptes actifs du personnel (1 ligne chacun)."""
    from accounts.models import User

    with transaction.atomic():
        sheet = PayrollSheet.objects.select_for_update().get(pk=sheet_id)
        if sheet.status != "draft":
            raise PayrollError("Fiche clôturée, lecture seule.")
        created = 0
        staff = User.objects.filter(is_active=True).exclude(role="client").order_by("username")
        for u in staff:
            employee, _ = _employee_for_user(u)
            if Payslip.objects.filter(sheet=sheet, employee=employee).exists():
                continue
            generate_payslip(sheet_id=sheet.id, user_id=u.id)
            created += 1
        return created


def add_payslip_line(*, payslip_id, kind, label, amount):
    """Ligne saisie (Entrée = enregistré) ; totaux recalculés depuis le contrat + lignes."""
    if kind not in ("gain", "deduction"):
        raise PayrollError("Nature invalide (gain ou retenue).")
    if not str(label).strip():
        raise PayrollError("Libellé requis.")
    if int(amount) <= 0:
        raise PayrollError("Montant invalide.")
    with transaction.atomic():
        slip = Payslip.objects.select_for_update().get(pk=payslip_id)
        if slip.sheet.status != "draft":
            raise PayrollError("Fiche clôturée : lignes verrouillées.")
        line = PayslipLine.objects.create(
            payslip=slip, kind=kind, label=str(label).strip(), amount=int(amount))
        _recompute(slip)
        return line


def pay_payslip(*, payslip_id, amount, paid_by=None):
    """Versements rattachés (acompte, complément) ; décaissement en caisse. Après clôture."""
    with transaction.atomic():
        slip = Payslip.objects.select_for_update().get(pk=payslip_id)
        if slip.sheet.status != "closed":
            raise PayrollError("Fiche non clôturée : clôturez avant de verser.")
        already = slip.payments.aggregate(s=Sum("amount"))["s"] or 0
        if already + amount > slip.net:
            raise PayrollError("Montant supérieur au net restant.")
        entry = add_entry(
            day=date.today(), category="salaire",
            label=f"Paie {slip.employee} {slip.sheet.month:%m/%Y}",
            direction="out", amount=amount, created_by=paid_by, employee_name=slip.employee.name,
        )
        return PayslipPayment.objects.create(payslip=slip, amount=amount, entry_ref=entry.voucher)


def close_sheet(*, sheet_id, actor=None):
    """Clôture la fiche : cachet exigé, lignes verrouillées, versements possibles ensuite."""
    with transaction.atomic():
        sheet = PayrollSheet.objects.select_for_update().get(pk=sheet_id)
        if sheet.status == "closed":
            raise PayrollError("Fiche déjà clôturée.")
        if not sheet.stamp:
            raise PayrollError("Cachet du directeur requis avant clôture.")
        sheet.status = "closed"
        sheet.save(update_fields=["status"])
        if actor is not None:
            from audit.services import log_action

            log_action(actor=actor, action="payroll.close",
                       entity=f"payroll_sheet:{sheet.id}",
                       after={"month": sheet.month.isoformat(), "status": "closed"})
        return sheet


def delete_sheet(*, sheet_id):
    """Suppression du brouillon seul (admin), jamais si un versement existe."""
    with transaction.atomic():
        sheet = PayrollSheet.objects.select_for_update().get(pk=sheet_id)
        if sheet.status != "draft":
            raise PayrollError("Fiche clôturée : suppression impossible (archive).")
        if PayslipPayment.objects.filter(payslip__sheet=sheet).exists():
            raise PayrollError("Fiche avec versements : suppression impossible.")
        sheet.delete()
