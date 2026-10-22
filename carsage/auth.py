"""Firebase ID-token verification for protected endpoints. Credentials stay on the server (env / file path), never in the repo."""
import logging
import os
from pathlib import Path

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from carsage.schemas import UserOut

log = logging.getLogger("carsage.auth")
_bearer = HTTPBearer(auto_error=False)
_app = None


class FirebaseNotConfigured(RuntimeError):
    pass


def _firebase_app():
    global _app
    if _app is None:
        import firebase_admin
        from firebase_admin import credentials
        path = os.environ.get("FIREBASE_CREDENTIALS_FILE") or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not path or not Path(path).is_file():
            raise FirebaseNotConfigured("FIREBASE_CREDENTIALS_FILE is not set to an existing service-account file")
        project = os.environ.get("FIREBASE_PROJECT_ID")
        _app = firebase_admin.initialize_app(credentials.Certificate(path), {"projectId": project} if project else None)
    return _app


def verify_token(token: str) -> dict:
    """Return verified Firebase claims. Tests replace this function; production calls the Admin SDK."""
    from firebase_admin import auth
    return auth.verify_id_token(token, app=_firebase_app())


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> UserOut:
    if creds is None:
        raise HTTPException(401, "Missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = verify_token(creds.credentials)
    except FirebaseNotConfigured:
        log.error("Firebase is not configured on the server")
        raise HTTPException(503, "Authentication is not configured on this server")
    except Exception:  # noqa: BLE001 - any verification failure is a 401; details are not leaked
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    uid = claims.get("uid") or claims.get("sub")
    if not uid:
        raise HTTPException(403, "Token has no user identity")
    return UserOut(uid=uid, email=claims.get("email"))
