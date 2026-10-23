from catalogue.models import Vehicle


def add_fleet(site, quads=20, velos=20):
    for index in range(quads):
        Vehicle.objects.get_or_create(
            plate=f"Q-{site.id}-{index:03d}",
            defaults={"site": site, "type": "quad", "model": "Quad test"},
        )
    for index in range(velos):
        Vehicle.objects.get_or_create(
            plate=f"V-{site.id}-{index:03d}",
            defaults={"site": site, "type": "velo", "model": "Vélo test"},
        )
