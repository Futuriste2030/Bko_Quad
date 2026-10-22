"""Idempotence des écritures hors ligne (décision J).

La PWA met en file les saisies faites sans réseau et les rejoue au retour de la
connectivité. Chaque écriture rejouée porte un en-tête `Idempotency-Key`
(uuid de l'appareil) : le serveur exécute une seule fois et rejoue la réponse
enregistrée si la même clé arrive encore.

- Clé inconnue + requête en cours de traitement -> 425 (réessayer plus tard).
- Clé inconnue + corps différent -> 409 (la clé a servi pour autre chose).
- Clé connue + même corps -> réponse enregistrée, aucun effet de bord.
- Échec métier (4xx) -> la clé est libérée : le terrain corrige et rejoue.
"""

import hashlib
import json

from django.db import IntegrityError, transaction
from django.http import JsonResponse

from sync.models import IdempotencyKey

MUTATING = ("POST", "PUT", "PATCH", "DELETE")


def _hash(method, path, body):
    h = hashlib.sha256()
    h.update(method.encode())
    h.update(b"|")
    h.update(path.encode())
    h.update(b"|")
    h.update(body or b"")
    return h.hexdigest()


class IdempotencyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        key = (request.headers.get("Idempotency-Key") or "").strip()
        if (not key or request.method not in MUTATING
                or not request.path.startswith("/api/")):
            return self.get_response(request)

        body = request.body
        request_hash = _hash(request.method, request.path, body)
        try:
            with transaction.atomic():
                record = IdempotencyKey.objects.create(
                    key=key,
                    method=request.method,
                    path=request.path[:200],
                    request_hash=request_hash,
                    status=0,
                    label=self._label(request),
                    offline_at=self._offline_at(request),
                )
        except IntegrityError:
            return self._replay(key, request_hash)

        try:
            response = self.get_response(request)
        except Exception:
            IdempotencyKey.objects.filter(pk=record.pk).delete()
            raise

        if 200 <= response.status_code < 300:
            payload = self._json(response)
            if payload is not None:
                record.status = response.status_code
                record.status_code = response.status_code
                record.response = payload
                record.actor = getattr(request, "user", None) if getattr(
                    request, "user", None) is not None and request.user.is_authenticated else None
                record.synced_at = timezone_now()
                record.save(update_fields=["status", "status_code", "response", "actor", "synced_at"])
                return response
        # Échec métier : la clé est libérée, le terrain peut corriger et rejouer.
        IdempotencyKey.objects.filter(pk=record.pk).delete()
        return response

    def _replay(self, key, request_hash):
        record = IdempotencyKey.objects.filter(key=key).first()
        if record is None:
            return JsonResponse({"detail": "Clé d'idempotence introuvable."}, status=409)
        if record.request_hash != request_hash:
            return JsonResponse(
                {"detail": "Cette clé d'idempotence a déjà servi pour une autre requête."},
                status=409)
        if record.status == 0:
            return JsonResponse(
                {"detail": "Synchronisation en cours, réessayez dans un instant."},
                status=425)
        response = JsonResponse(record.response, status=record.status_code,
                                json_dumps_params={"ensure_ascii": False})
        response["X-Idempotent-Replay"] = "1"
        return response

    @staticmethod
    def _label(request):
        """Libellé lisible de la saisie (l'appareil l'encode en URL)."""
        from urllib.parse import unquote

        raw = request.headers.get("X-Offline-Label") or ""
        try:
            raw = unquote(raw)
        except (UnicodeDecodeError, ValueError):
            pass
        return raw[:120]

    @staticmethod
    def _json(response):
        ctype = response.get("Content-Type", "")
        if "application/json" not in ctype:
            return None
        try:
            return json.loads(response.content.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    @staticmethod
    def _offline_at(request):
        from django.utils import timezone
        from django.utils.dateparse import parse_datetime

        raw = (request.headers.get("X-Offline-At") or "").strip()
        if not raw:
            return None
        parsed = parse_datetime(raw)
        if parsed is None:
            return None
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed)
        return parsed


def timezone_now():
    from django.utils import timezone

    return timezone.now()
