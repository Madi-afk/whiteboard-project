import os
import time
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel


SECRET_KEY = os.getenv(
    "JWT_SECRET_KEY",
    "change-this-secret-key-in-production",
)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

AUTH_DB_PATH = os.getenv("AUTH_DB_PATH", "users.db")

KEYCLOAK_PUBLIC_URL = os.getenv("KEYCLOAK_PUBLIC_URL", "").strip().rstrip("/")
KEYCLOAK_INTERNAL_URL = os.getenv(
    "KEYCLOAK_INTERNAL_URL",
    KEYCLOAK_PUBLIC_URL,
).strip().rstrip("/")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "").strip()
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "").strip()
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET", "").strip()
KEYCLOAK_GOOGLE_ENABLED = (
    os.getenv("KEYCLOAK_GOOGLE_ENABLED", "false").strip().lower() == "true"
)
KEYCLOAK_GITHUB_ENABLED = (
    os.getenv("KEYCLOAK_GITHUB_ENABLED", "false").strip().lower() == "true"
)
KEYCLOAK_JWKS_CACHE_SECONDS = 300

keycloak_jwks_cache: dict = {
    "expires_at": 0,
    "keys": [],
}

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


class RegisterRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    provider: str = "local"
    id_token: Optional[str] = None


class UserResponse(BaseModel):
    username: str
    provider: str = "local"


class KeycloakExchangeRequest(BaseModel):
    code: str
    code_verifier: str
    redirect_uri: str


def get_connection():
    return sqlite3.connect(AUTH_DB_PATH)


def init_auth_db():
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.commit()


def normalize_username(username: str) -> str:
    return username.strip().lower()


def is_keycloak_enabled() -> bool:
    return bool(KEYCLOAK_PUBLIC_URL and KEYCLOAK_REALM and KEYCLOAK_CLIENT_ID)


def get_keycloak_public_config() -> dict:
    return {
        "enabled": is_keycloak_enabled(),
        "url": KEYCLOAK_PUBLIC_URL,
        "realm": KEYCLOAK_REALM,
        "clientId": KEYCLOAK_CLIENT_ID,
        "identityProviders": {
            "google": KEYCLOAK_GOOGLE_ENABLED,
            "github": KEYCLOAK_GITHUB_ENABLED,
        },
    }


def get_keycloak_url(base_url: str, path: str) -> str:
    return f"{base_url}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/{path}"


def get_keycloak_issuer() -> str:
    return f"{KEYCLOAK_PUBLIC_URL}/realms/{KEYCLOAK_REALM}"


def is_valid_keycloak_issuer(issuer: str | None) -> bool:
    if not issuer:
        return False

    parsed_issuer = urllib.parse.urlparse(issuer)
    return parsed_issuer.path.rstrip("/") == f"/realms/{KEYCLOAK_REALM}"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def get_user_by_username(username: str) -> Optional[dict]:
    username = normalize_username(username)

    with get_connection() as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

    if not row:
        return None

    return dict(row)


def create_access_token(username: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": username,
        "exp": expires_at,
    }

    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")

        if not username:
            return None

        return username

    except JWTError:
        return None


def fetch_json(url: str, data: dict | None = None) -> dict:
    body = None
    headers = {
        "Accept": "application/json",
    }

    if data is not None:
        body = urllib.parse.urlencode(data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    request = urllib.request.Request(
        url,
        data=body,
        headers=headers,
        method="POST" if data is not None else "GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return json_loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="ignore")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail or "Keycloak request failed",
        ) from error
    except urllib.error.URLError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Keycloak is not reachable: {error.reason}",
        ) from error


def json_loads(value: str) -> dict:
    import json

    return json.loads(value)


def get_keycloak_jwks() -> list[dict]:
    now = time.time()

    if keycloak_jwks_cache["expires_at"] > now:
        return keycloak_jwks_cache["keys"]

    jwks = fetch_json(get_keycloak_url(KEYCLOAK_INTERNAL_URL, "certs"))
    keys = jwks.get("keys", [])

    keycloak_jwks_cache["keys"] = keys
    keycloak_jwks_cache["expires_at"] = now + KEYCLOAK_JWKS_CACHE_SECONDS

    return keys


def get_keycloak_username(payload: dict) -> str:
    return (
        payload.get("preferred_username")
        or payload.get("email")
        or payload.get("name")
        or payload.get("sub")
        or "keycloak-user"
    )


def is_keycloak_email_verified(payload: dict) -> bool:
    return payload.get("email_verified") is True


def decode_keycloak_token(token: str) -> Optional[dict]:
    if not is_keycloak_enabled():
        return None

    try:
        header = jwt.get_unverified_header(token)
        key_id = header.get("kid")
        algorithm = header.get("alg", "RS256")
        key = next(
            (item for item in get_keycloak_jwks() if item.get("kid") == key_id),
            None,
        )

        if not key:
            keycloak_jwks_cache["expires_at"] = 0
            key = next(
                (item for item in get_keycloak_jwks() if item.get("kid") == key_id),
                None,
            )

        if not key:
            return None

        payload = jwt.decode(
            token,
            key,
            algorithms=[algorithm],
            options={"verify_aud": False, "verify_iss": False},
        )

        if not is_valid_keycloak_issuer(payload.get("iss")):
            return None

        if not is_keycloak_email_verified(payload):
            return None

        audiences = payload.get("aud") or []
        if isinstance(audiences, str):
            audiences = [audiences]

        authorized_party = payload.get("azp")
        if KEYCLOAK_CLIENT_ID not in audiences and authorized_party != KEYCLOAK_CLIENT_ID:
            return None

        return {
            "id": payload.get("sub"),
            "username": get_keycloak_username(payload),
            "provider": "keycloak",
        }
    except (JWTError, HTTPException):
        return None


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    username = decode_token(token)

    if not username:
        keycloak_user = decode_keycloak_token(token)

        if keycloak_user:
            return keycloak_user

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )

    user = get_user_by_username(username)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


def get_user_from_token(token: str | None) -> Optional[dict]:
    if not token:
        return None

    username = decode_token(token)

    if not username:
        return decode_keycloak_token(token)

    return get_user_by_username(username)


@router.post("/keycloak/exchange", response_model=TokenResponse)
async def exchange_keycloak_code(data: KeycloakExchangeRequest):
    if not is_keycloak_enabled():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Keycloak is not configured",
        )

    token_request = {
        "grant_type": "authorization_code",
        "client_id": KEYCLOAK_CLIENT_ID,
        "code": data.code,
        "code_verifier": data.code_verifier,
        "redirect_uri": data.redirect_uri,
    }

    if KEYCLOAK_CLIENT_SECRET:
        token_request["client_secret"] = KEYCLOAK_CLIENT_SECRET

    token_data = fetch_json(
        get_keycloak_url(KEYCLOAK_INTERNAL_URL, "token"),
        token_request,
    )
    access_token = token_data.get("access_token")
    id_token = token_data.get("id_token")
    keycloak_user = decode_keycloak_token(access_token or "")

    if not access_token or not keycloak_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Keycloak token",
        )

    return TokenResponse(
        access_token=access_token,
        id_token=id_token,
        username=keycloak_user["username"],
        provider="keycloak",
    )


@router.post("/register", response_model=TokenResponse)
async def register(data: RegisterRequest):
    username = normalize_username(data.username)

    if len(username) < 3:
        raise HTTPException(
            status_code=400,
            detail="Username must be at least 3 characters",
        )

    if len(data.password) < 6:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 6 characters",
        )

    existing_user = get_user_by_username(username)

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    password_hash = hash_password(data.password)

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO users (username, password_hash, created_at)
            VALUES (?, ?, ?)
            """,
            (
                username,
                password_hash,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        connection.commit()

    token = create_access_token(username)

    return TokenResponse(
        access_token=token,
        username=username,
    )


@router.post("/login", response_model=TokenResponse)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    username = normalize_username(form_data.username)
    user = get_user_by_username(username)

    if not user or not verify_password(form_data.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token = create_access_token(username)

    return TokenResponse(
        access_token=token,
        username=username,
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        username=current_user["username"],
        provider=current_user.get("provider", "local"),
    )
