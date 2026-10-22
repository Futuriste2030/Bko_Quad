# Base saisie libre + ligne liée au compte utilisateur (prénom + nom).

import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Sum


def remplir_base_et_comptes(apps, schema_editor):
    Payslip = apps.get_model("payroll", "Payslip")
    PayslipLine = apps.get_model("payroll", "PayslipLine")
    User = apps.get_model("accounts", "User")
    for slip in Payslip.objects.all():
        gains = PayslipLine.objects.filter(payslip=slip, kind="gain").aggregate(
            s=Sum("amount"))["s"] or 0
        slip.base_amount = max(0, slip.gross - gains)
        emp_name = (slip.employee.name or "").strip()
        user = None
        for u in User.objects.filter(is_active=True):
            label = f"{u.first_name} {u.last_name}".strip()
            if (label and label == emp_name) or u.username == emp_name:
                user = u
                break
        slip.user = user
        slip.save(update_fields=["base_amount", "user"])


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0002_user_site'),
        ('payroll', '0002_sheet'),
    ]

    operations = [
        migrations.AddField(
            model_name='payslip',
            name='base_amount',
            field=models.PositiveIntegerField(default=0, help_text='Base saisie, FCFA entier'),
        ),
        migrations.AddField(
            model_name='payslip',
            name='user',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='accounts.user'),
        ),
        migrations.RunPython(remplir_base_et_comptes, migrations.RunPython.noop),
    ]
