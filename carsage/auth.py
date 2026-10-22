"""Firebase ID-token verification for protected endpoints. Credentials stay on the server (env / file path), never in the repo.

The verified token is the only source of identity: UID and email are never taken from request bodies or headers.
"""
import json
import logging
import os
import threading
from pathlib import Path

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from carsage.schemas import UserOut

log = logging.getLogger("carsage.auth")
_bearer = HTTPBearer(auto_error=False)
_app = None
_lock = threading.Lock()


class FirebaseNotConfigured(RuntimeError):
    pass


def _firebase_app():
    """Initialise the Admin SDK exactly once. Requires an explicit FIREBASE_PROJECT_ID that matches the service account's project."""
    global _app
    with _lock:
        if _app is None:
            import firebase_admin
            from firebase_admin import credentials
            project = os.environ.get("FIREBASE_PROJECT_ID")
            path = os.environ.get("FIREBASE_CREDENTIALS_FILE") or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
            if not project:
                raise FirebaseNotConfigured("FIREBASE_PROJECT_ID is not set")
            if not path or not Path(path).is_file():
                raise FirebaseNotConfigured("FIREBASE_CREDENTIALS_FILE is not set to an existing service-account file")
            try:
                file_project = json.loads(Path(path).read_text()).get("project_id")
            except (OSError, ValueError):
                raise FirebaseNotConfigured("FIREBASE_CREDENTIALS_FILE is not a valid service-account JSON file")
            if file_project != project:     # stops an unrelated project's key from being used by mistake
                raise FirebaseNotConfigured("the service account belongs to a different Firebase project than FIREBASE_PROJECT_ID")
            _app = firebase_admin.initialize_app(credentials.Certificate(path), {"projectId": project})
        return _app


def verify_token(token: str) -> dict:
    """Return verified Firebase claims (signature, expiry, issuer and audience = our project). Tests replace this function."""
    from firebase_admin import auth
    return auth.verify_id_token(token, app=_firebase_app())


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> UserOut:
    if creds is None:
        raise HTTPException(401, "Missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = verify_token(creds.credentials)
    except FirebaseNotConfigured as e:
        log.error("Firebase is not configured on the server: %s", e)
        raise HTTPException(503, "Authentication is not configured on this server")
    except Exception as e:  # noqa: BLE001 - any verification failure is a 401; the token and details are never logged or returned
        log.info("token rejected: %s", type(e).__name__)
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    uid = claims.get("uid") or claims.get("sub")
    if not uid:
        raise HTTPException(403, "Token has no user identity")
    return UserOut(uid=uid, email=claims.get("email"))
