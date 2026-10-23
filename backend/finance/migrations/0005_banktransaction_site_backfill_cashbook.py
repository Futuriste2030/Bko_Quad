from django.db import migrations, models


def backfill_cashbook_site(apps, schema_editor):
    """Rattache les recettes automatiques existantes au site de leur réservation."""
    CashbookEntry = apps.get_model("finance", "CashbookEntry")
    rows = (
        CashbookEntry.objects.filter(site__isnull=True, booking__isnull=False)
        .values_list("pk", "booking__slot__activity__site_id")
        .iterator()
    )
    for entry_id, site_id in rows:
        if site_id:
            CashbookEntry.objects.filter(pk=entry_id).update(site_id=site_id)


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0004_alter_cashbookentry_category"),
        ("catalogue", "0005_maintenance_part_serial_sparepart"),
    ]

    operations = [
        migrations.AddField(
            model_name="banktransaction",
            name="site",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name="bank_transactions",
                to="catalogue.site",
            ),
        ),
        migrations.RunPython(backfill_cashbook_site, migrations.RunPython.noop),
    ]
