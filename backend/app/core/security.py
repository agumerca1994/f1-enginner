"""Opaque tokens and pairing codes.

Tokens are shown once and stored only as a sha256 hash, the same scheme as the
registrapp personal access tokens: a leaked database does not leak credentials.
"""

import hashlib
import secrets

DEVICE_TOKEN_PREFIX = "rbd_"  # race-engineer bridge device
DEVICE_CODE_PREFIX = "rbp_"  # pairing request, held by the bridge while it polls

# No 0/O, 1/I/L or U: the code is read off a terminal and typed on a phone.
_USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"


def new_token(prefix: str) -> str:
    return prefix + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_user_code() -> str:
    """Eight characters, shown as XXXX-XXXX."""
    return "".join(secrets.choice(_USER_CODE_ALPHABET) for _ in range(8))


def normalize_user_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def format_user_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"
