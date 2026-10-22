"""TOTP RFC 6238 sans dépendance (SHA-1, 30 s, 6 chiffres)."""

import base64
import hashlib
import hmac
import secrets
import struct
import time


def random_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode()


def otpauth_url(secret: str, account: str, issuer: str = "BKO Quad Hub") -> str:
    return f"otpauth://totp/{issuer}:{account}?secret={secret}&issuer={issuer}&digits=6&period=30"


def _code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    num = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{num % 1_000_000:06d}"


def verify(secret: str, code: str, window: int = 1) -> bool:
    code = (code or "").strip()
    if len(code) != 6 or not code.isdigit():
        return False
    now = int(time.time() // 30)
    for delta in range(-window, window + 1):
        if hmac.compare_digest(_code(secret, now + delta), code):
            return True
    return False
