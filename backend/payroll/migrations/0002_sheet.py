# Fiche mensuelle unique (façon Hub Digi) : PayrollPeriod -> PayrollSheet,
# Payslip = ligne (sheet FK, numéro auto, poste/site figés).

import django.db.models.deletion
from django.db import migrations, models


def periods_vers_fiches(apps, schema_editor):
    PayrollPeriod = apps.get_model("payroll", "PayrollPeriod")
    PayrollSheet = apps.get_model("payroll", "PayrollSheet")
    Payslip = apps.get_model("payroll", "Payslip")
    for period in PayrollPeriod.objects.all().order_by("month"):
        sheet = PayrollSheet.objects.create(
            month=period.month,
            status="closed" if period.status in ("validated", "paid") else "draft",
        )
        n = 0
        for slip in Payslip.objects.filter(period=period).order_by("id"):
            n += 1
            slip.sheet = sheet
            slip.number = f"PAIE-{sheet.month.year}-{sheet.month.month:02d}-{n:03d}"
            emp = slip.employee
            slip.position = emp.role
            slip.site_name = emp.site.name if emp.site_id else ""
            slip.save(update_fields=["sheet", "number", "position", "site_name"])


class Migration(migrations.Migration):

    dependencies = [
        ('payroll', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='PayrollSheet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('month', models.DateField(help_text='Premier jour du mois', unique=True)),
                ('status', models.CharField(choices=[('draft', 'Brouillon'), ('closed', 'Clôturée')], default='draft', max_length=10)),
                ('stamp', models.ImageField(blank=True, help_text='Cachet du directeur, exigé avant clôture', null=True, upload_to='paie/')),
            ],
        ),
        migrations.AddField(
            model_name='payslip',
            name='number',
            field=models.CharField(blank=True, help_text='PAIE-AAAA-MM-NNN auto', max_length=30),
        ),
        migrations.AddField(
            model_name='payslip',
            name='position',
            field=models.CharField(blank=True, default='', help_text='Poste figé à la génération', max_length=60),
        ),
        migrations.AddField(
            model_name='payslip',
            name='site_name',
            field=models.CharField(blank=True, default='', help_text='Site figé à la génération', max_length=120),
        ),
        migrations.AddField(
            model_name='payslip',
            name='sheet',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='slips', to='payroll.payrollsheet'),
        ),
        migrations.RunPython(periods_vers_fiches, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name='payslip',
            name='uniq_payslip_per_period',
        ),
        migrations.RemoveField(
            model_name='payslip',
            name='period',
        ),
        migrations.RemoveField(
            model_name='payslip',
            name='validated',
        ),
        migrations.AlterField(
            model_name='payslip',
            name='sheet',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='slips', to='payroll.payrollsheet'),
        ),
        migrations.AddConstraint(
            model_name='payslip',
            constraint=models.UniqueConstraint(fields=('employee', 'sheet'), name='uniq_payslip_per_period'),
        ),
        migrations.DeleteModel(
            name='PayrollPeriod',
        ),
    ]
