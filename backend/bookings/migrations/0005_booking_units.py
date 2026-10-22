"""Unité de facturation multipliée : durée du créneau / formule (H)."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bookings", "0004_bookingline_discount_alter_bookingline_line_total"),
    ]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="units",
            field=models.PositiveIntegerField(
                default=1,
                help_text="Unités de formule facturées (durée du créneau / durée de la formule, arrondi au dessus)"),
        ),
    ]
