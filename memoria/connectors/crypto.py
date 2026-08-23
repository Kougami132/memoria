import base64
import hashlib
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken

_SECRET_SALT = b"memoria_secret_salt_2026"

def _derive_fernet_key(secret_str: str) -> bytes:
    key_bytes = hashlib.pbkdf2_hmac(
        "sha256",
        secret_str.encode("utf-8"),
        _SECRET_SALT,
        iterations=100_000,
        dklen=32,
    )
    return base64.urlsafe_b64encode(key_bytes)

def get_cipher(secret_key: str = "default_memoria_encryption_key_change_in_production") -> Fernet:
    key = _derive_fernet_key(secret_key)
    return Fernet(key)

def encrypt_secret(plaintext: Optional[str], secret_key: str = "default_memoria_encryption_key_change_in_production") -> Optional[str]:
    if not plaintext:
        return plaintext
    cipher = get_cipher(secret_key)
    return cipher.encrypt(plaintext.encode("utf-8")).decode("utf-8")

def decrypt_secret(ciphertext: Optional[str], secret_key: str = "default_memoria_encryption_key_change_in_production") -> Optional[str]:
    if not ciphertext:
        return ciphertext
    cipher = get_cipher(secret_key)
    try:
        return cipher.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except (InvalidToken, Exception):
        # Fallback if text was not encrypted or key changed
        return ciphertext
