"""Vue unique des exports CSV/XLSX, filtrée par droits et par site."""

from datetime import date

from django.http import HttpResponse
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from catalogue.models import Activity, Site
from common.exports import (
    ExportError,
    ExportFilters,
    build_export,
    can_export,
    get_dataset,
)
from common.views import scoped_site


def _parse_date(raw: str, fallback: date, label: str) -> date:
    if not raw:
        return fallback
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ExportError(f"{label} invalide (AAAA-MM-JJ).") from exc


def _parse_int(raw: str | None, label: str) -> int | None:
    if raw in (None, ""):
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ExportError(f"{label} invalide.") from exc
    if value <= 0:
        raise ExportError(f"{label} invalide.")
    return value


class ExportView(APIView):
    """Exporte un jeu de données en CSV ou Excel sur une période."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.localdate()
        file_type = (request.query_params.get("file") or "csv").strip().lower()
        if file_type not in ("csv", "xlsx"):
            return Response({"detail": "Format inconnu (csv ou xlsx)."}, status=400)

        try:
            dataset = get_dataset(request.query_params.get("dataset", ""))
            start = _parse_date(
                request.query_params.get("start", ""),
                today.replace(day=1),
                "Date de début",
            )
            end = _parse_date(
                request.query_params.get("end", ""),
                today,
                "Date de fin",
            )
            if start > end:
                raise ExportError("La date de début doit précéder la date de fin.")
            requested_site = _parse_int(request.query_params.get("site"), "Site")
            activity = _parse_int(request.query_params.get("activity"), "Activité")
            agent = (request.query_params.get("agent") or "").strip()
            if len(agent) > 80:
                raise ExportError("Recherche agent trop longue.")
        except ExportError as exc:
            return Response({"detail": str(exc)}, status=400)

        if not can_export(request.user, dataset):
            return Response({"detail": "Export non autorisé pour votre rôle."}, status=403)

        forced_site = scoped_site(request.user)
        site = None
        if dataset.site_lookup:
            if forced_site is not None:
                if requested_site is not None and requested_site != forced_site:
                    return Response({"detail": "Hors de votre site."}, status=403)
                site = forced_site
            else:
                site = requested_site
        elif requested_site is not None:
            return Response(
                {"detail": "Ce jeu de données n'est pas filtré par site."},
                status=400,
            )

        if site is not None and not Site.objects.filter(pk=site).exists():
            return Response({"detail": "Site introuvable."}, status=400)

        if activity is not None:
            if not dataset.activity_lookup:
                return Response(
                    {"detail": "Ce jeu de données n'est pas filtré par activité."},
                    status=400,
                )
            if not Activity.objects.filter(pk=activity).exists():
                return Response({"detail": "Activité introuvable."}, status=400)
            if site is not None and not Activity.objects.filter(
                    pk=activity, site_id=site).exists():
                return Response(
                    {"detail": "Activité hors du site sélectionné."}, status=400)

        if agent and not dataset.agent_lookups:
            return Response(
                {"detail": "Ce jeu de données n'est pas filtré par agent."},
                status=400,
            )

        try:
            content, content_type = build_export(
                dataset,
                ExportFilters(
                    start=start,
                    end=end,
                    site=site,
                    activity=activity,
                    agent=agent,
                ),
                file_type,
            )
        except ExportError as exc:
            return Response({"detail": str(exc)}, status=400)

        filename = f"bko-{dataset.key}-{start.isoformat()}_{end.isoformat()}.{file_type}"
        response = HttpResponse(content, content_type=content_type)
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["X-Content-Type-Options"] = "nosniff"
        return response
