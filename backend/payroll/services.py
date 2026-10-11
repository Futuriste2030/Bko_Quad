"""Services paie : brut depuis contrat, avances déduites, décaissement en caisse."""

from datetime import date

from django.db import transaction
from django.db.models import Sum

from finance.services import add_entry
from payroll.models import Contract, Employee, PayrollPeriod, Payslip, PayslipLine, PayslipPayment


class PayrollError(ValueError):
    pass


def open_period(year, month):
    period, _ = PayrollPeriod.objects.get_or_create(month=date(year, month, 1))
    return period


def _advances_due(name, month):
    from finance.models import CashAdvance

    agg = CashAdvance.objects.filter(employee_name=name).aggregate(
        given=Sum("amount"), back=Sum("repaid"))
    return (agg["given"] or 0) - (agg["back"] or 0)


def generate_payslip(*, employee_id, year, month, bonuses=None, legal_deductions=None):
    """Brut = base + primes ; retenues = légales (comptable) + avances dues."""
    bonuses = bonuses or []
    legal_deductions = legal_deductions or []
    with transaction.atomic():
        employee = Employee.objects.get(pk=employee_id)
        contract = (
            Contract.objects.filter(employee=employee)
            .order_by("-start").first()
        )
        if contract is None:
            raise PayrollError("Aucun contrat pour cet employé.")
        period = open_period(year, month)
        if period.status != "draft":
            raise PayrollError("Période déjà validée.")
        slip, _ = Payslip.objects.get_or_create(employee=employee, period=period)
        slip.lines.all().delete()
        gross = contract.base_salary
        for label, amount in bonuses:
            PayslipLine.objects.create(payslip=slip, kind="gain", label=label, amount=amount)
            gross += amount
        deductions = 0
        for label, amount in legal_deductions:
            PayslipLine.objects.create(payslip=slip, kind="deduction", label=label, amount=amount)
            deductions += amount
        adv = _advances_due(employee.name, period.month)
        if adv > 0:
            PayslipLine.objects.create(payslip=slip, kind="deduction",
                                       label="Avances non restituées", amount=adv)
            deductions += adv
        slip.gross, slip.deductions, slip.net = gross, deductions, max(0, gross - deductions)
        slip.save()
        return slip


def pay_payslip(*, payslip_id, amount, paid_by=None):
    """Paiements partiels rattachés (acompte, complément) ; décaissement en caisse."""
    with transaction.atomic():
        slip = Payslip.objects.select_for_update().get(pk=payslip_id)
        if not slip.validated:
            raise PayrollError("Fiche non validée.")
        already = slip.payments.aggregate(s=Sum("amount"))["s"] or 0
        if already + amount > slip.net:
            raise PayrollError("Montant supérieur au net restant.")
        entry = add_entry(
            day=date.today(), category="salaire", label=f"Paie {slip.employee} {slip.period.month:%m/%Y}",
            direction="out", amount=amount, created_by=paid_by, employee_name=slip.employee.name,
        )
        pay = PayslipPayment.objects.create(payslip=slip, amount=amount, entry_ref=entry.voucher)
        if already + amount >= slip.net:
            slip.period.status = "paid"
            slip.period.save(update_fields=["status"])
        return pay
