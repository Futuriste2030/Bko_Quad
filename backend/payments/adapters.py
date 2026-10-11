"""Adaptateur paiement (H) : interface commune + stub. Intégration réelle après doc agrégateur."""

import secrets
from dataclasses import dataclass


@dataclass
class LinkResult:
    reference: str
    pay_url: str


class PaymentAdapter:
    name = "base"

    def create_link(self, *, booking_code, amount, expires_at) -> LinkResult:
        raise NotImplementedError

    def verify_signature(self, *, raw_body: bytes, signature: str) -> bool:
        raise NotImplementedError


class StubAdapter(PaymentAdapter):
    """Bouchon local : génère une référence, signature toujours valide en dev."""

    name = "stub"

    def create_link(self, *, booking_code, amount, expires_at) -> LinkResult:
        ref = f"STUB-{booking_code}-{secrets.token_hex(4).upper()}"
        return LinkResult(reference=ref, pay_url=f"pay://stub/{ref}")

    def verify_signature(self, *, raw_body: bytes, signature: str) -> bool:
        return True


ADAPTERS = {"stub": StubAdapter()}


def get_adapter(name="stub"):
    try:
        return ADAPTERS[name]
    except KeyError:
        raise ValueError(f"Agrégateur inconnu : {name} (doc en attente, voir H).")
