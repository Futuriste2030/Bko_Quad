"""URLs du Hub BKO Quad : API v1, admin, documentation OpenAPI et PWA.

En production, Nginx proxifie tout vers Gunicorn. WhiteNoise sert /static/ et
le build Vite (frontend_dist) à la racine ; Django sert /media/ (volume Docker)
et renvoie index.html pour les routes SPA React.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.db import connection
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve as media_serve
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("common.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]


def _healthz(request):
    """Sonde Docker/Nginx : process vivant + base de données joignable."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        response = JsonResponse({"status": "error"}, status=503)
    else:
        response = JsonResponse({"status": "ok", "version": settings.BKO_VERSION})
    response["Cache-Control"] = "no-store"
    return response


urlpatterns += [path("healthz", _healthz), path("healthz/", _healthz)]

if settings.DEBUG:
    # Fichiers téléversés (cachet, signature) servis en développement ;
    # en production, la route ci-dessous sert le volume Docker.
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    urlpatterns += [
        re_path(r"^media/(?P<path>.*)$", media_serve, {"document_root": settings.MEDIA_ROOT}),
    ]


def _spa_index(request, chemin=""):
    """Fallback SPA : routes React inconnues -> index.html du build Vite.

    Un asset manquant (ancien hash en cache après redéploiement) renvoie un
    vrai 404, jamais index.html : sinon le navigateur reçoit du HTML pour du
    JS/CSS et bloque l'application (MIME strict).
    """
    dernier = chemin.rsplit("/", 1)[-1]
    if (
        chemin.startswith(("assets/", "fonts/"))
        or dernier in {"sw.js", "registerSW.js", "manifest.webmanifest", "site.webmanifest"}
        or "." in dernier
    ):
        raise Http404("Asset frontend inconnu (rechargez la page après déploiement).")
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        raise Http404("Build frontend absent (frontend_dist/index.html).")
    response = FileResponse(open(index, "rb"), content_type="text/html")
    response["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response


if not settings.DEBUG:
    # Ne capte ni /api/, ni /admin/, ni /static/, ni /media/, ni /healthz.
    urlpatterns += [
        re_path(
            r"^(?!api/|admin/|static/|media/|healthz/?$)(?P<chemin>.*)$",
            _spa_index,
        ),
    ]
