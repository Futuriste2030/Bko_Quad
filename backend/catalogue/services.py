"""Catalogue par défaut : formules standards d'un site encore vierge.

Un site sans aucune formule est inutilisable (aucun créneau ne peut être
publié). Au démarrage, le Hub crée donc un catalogue de départ sur les sites
vides, sans jamais toucher à un catalogue déjà configuré.
"""

from bookings.services import is_koni_site, is_orpheus_site
from catalogue.models import Activity, Site

QUAD_ADULTE = ("Quad 1H", 60, 25000, 0, 10)
QUAD_2H = ("Quad 2H", 120, 40000, 0, 10)
QUAD_ENFANT = ("Quad enfant 15 min", 15, 5000, 0, 6)
VELO_ELECTRIQUE = ("Vélo électrique 1H", 60, 5000, 0, 10)
VELO_MANUEL = ("Vélo manuel 1H", 60, 3000, 0, 10)
CRENEAU_LIBRE = ("Créneau libre", 60, 0, 0, 20)


def standard_formulas(site):
    """Formules autorisées par les règles métier du site.

    - Hôtel Orpheus : quads enfants et vélos uniquement ;
    - Konibabougou : quads adultes uniquement ;
    - autres sites : quads adultes et vélos.
    """
    name = site.name or ""
    if is_orpheus_site(name):
        rows = [QUAD_ENFANT]
    elif is_koni_site(name):
        rows = [QUAD_ADULTE, QUAD_2H]
    else:
        rows = [QUAD_ADULTE]
    if not is_koni_site(name):
        rows += [VELO_ELECTRIQUE, VELO_MANUEL]
    rows.append(CRENEAU_LIBRE)
    return rows


def seed_default_activities(site):
    """Crée les formules manquantes d'un site vide ; renvoie celles créées."""
    if site.activities.exists():
        return []
    created = []
    for name, duration, price, deposit, max_group in standard_formulas(site):
        activity, made = Activity.objects.get_or_create(
            site=site,
            name=name,
            defaults={
                "duration_minutes": duration,
                "base_price": price,
                "deposit": deposit,
                "max_group": max_group,
            },
        )
        if made:
            created.append(activity)
    return created


def seed_empty_sites(queryset=None):
    """Parcourt les sites et garnit uniquement ceux qui n'ont aucune formule."""
    sites = (queryset if queryset is not None else Site.objects.all()).order_by("id")
    report = []
    for site in sites:
        report.append((site, seed_default_activities(site)))
    return report
