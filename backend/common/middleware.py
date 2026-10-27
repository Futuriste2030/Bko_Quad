"""Middleware utilitaires pour BKO Quad Hub."""
from urllib.parse import parse_qs


class QueryTokenAuthMiddleware:
    """Permet de passer le JWT via ?token=... pour les téléchargements
    (PDF, exports) dans les WebViews Android où fetch + blob ne fonctionne pas."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if "HTTP_AUTHORIZATION" not in request.META:
            qs = parse_qs(request.META.get("QUERY_STRING", ""))
            toks = qs.get("token")
            if toks:
                request.META["HTTP_AUTHORIZATION"] = "Bearer " + toks[0]
        return self.get_response(request)