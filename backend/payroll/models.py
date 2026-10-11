"""Paie : fiches depuis contrat + avances + primes, paiements partiels rattachés."""

from django.db import models


class Employee(models.Model):
    name = models.CharField(max_length=120)
    role = models.CharField(max_length=60, default="agent")
    site = models.ForeignKey("catalogue.Site", null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="employees")
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Contract(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="contracts")
    start = models.DateField()
    end = models.DateField(null=True, blank=True)
    base_salary = models.PositiveIntegerField(help_text="FCFA, entier")
    frequency = models.CharField(max_length=10, default="monthly")

    def __str__(self):
        return f"{self.employee} {self.base_salary} FCFA"


class PayrollPeriod(models.Model):
    STATUS_CHOICES = [("draft", "Brouillon"), ("validated", "Validée"), ("paid", "Payée")]
    month = models.DateField(unique=True, help_text="Premier jour du mois")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="draft")

    def __str__(self):
        return f"Paie {self.month:%m/%Y} ({self.status})"


class Payslip(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="payslips")
    period = models.ForeignKey(PayrollPeriod, on_delete=models.PROTECT, related_name="payslips")
    gross = models.PositiveIntegerField(default=0)
    deductions = models.PositiveIntegerField(default=0)
    net = models.PositiveIntegerField(default=0)
    pdf_file = models.CharField(max_length=200, blank=True, default="")
    validated = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["employee", "period"], name="uniq_payslip_per_period"),
        ]

    def __str__(self):
        return f"{self.employee} {self.period.month:%m/%Y} net {self.net}"


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
