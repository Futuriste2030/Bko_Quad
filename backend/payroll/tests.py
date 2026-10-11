"""Tests paie : brut/net, avance déduite, partiels rattachés, décaissement caisse."""

from datetime import date

from django.test import TestCase

from accounts.models import User
from finance.models import CashAdvance, CashbookEntry
from finance.services import add_entry
from payroll.models import Contract, Employee
from payroll.services import PayrollError, generate_payslip, pay_payslip


class PayslipTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin1", password="x", phone="+22370000001", role="admin")
        add_entry(day=date(2026, 10, 1), category="recette_reservation",
                  label="Fonds", direction="in", amount=500000, created_by=self.admin)
        self.emp = Employee.objects.create(name="A. Diallo", role="guide")
        Contract.objects.create(employee=self.emp, start=date(2026, 1, 1), base_salary=150000)

    def test_brut_net(self):
        slip = generate_payslip(employee_id=self.emp.id, year=2026, month=10,
                                bonuses=[("Prime sortie", 20000)],
                                legal_deductions=[("ITS", 10000)])
        self.assertEqual(slip.gross, 170000)
        self.assertEqual(slip.net, 160000)

    def test_avance_deduite(self):
        CashAdvance.objects.create(employee_name="A. Diallo", date=date(2026, 10, 3),
                                  voucher="202610-001", reason="Urgence", amount=30000)
        slip = generate_payslip(employee_id=self.emp.id, year=2026, month=10)
        self.assertEqual(slip.net, 120000)

    def test_partiels_et_caisse(self):
        slip = generate_payslip(employee_id=self.emp.id, year=2026, month=10)
        slip.validated = True
        slip.save()
        pay_payslip(payslip_id=slip.id, amount=50000, paid_by=self.admin)
        pay_payslip(payslip_id=slip.id, amount=100000, paid_by=self.admin)
        self.assertEqual(slip.payments.count(), 2)
        self.assertEqual(CashbookEntry.objects.filter(category="salaire").count(), 2)
        with self.assertRaises(PayrollError):
            pay_payslip(payslip_id=slip.id, amount=1000, paid_by=self.admin)
