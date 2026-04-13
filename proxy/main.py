"""
proxy/main.py — FastAPI LLM proxy sidecar.

Security features
─────────────────
1. Proxy token validation (PROXY_TOKEN_SECRET)
   The client SPA receives a short-lived HMAC-signed token in window.__CONFIG__
   from server.js at page-serve time.  Every LLM request includes it as the
   X-Proxy-Token header.  The proxy verifies the HMAC signature and expiry,
   rejecting requests that are missing, tampered, or expired.

   Token format:  "<expiry_unix>|<nonce>.<hmac_sha256_hex>"

   Set PROXY_TOKEN_SECRET to the same value as the client container.
   Leave empty to DISABLE token checking (dev / local use only).

2. Per-IP rate limiting (slowapi)
   MAX RATE_LIMIT_PER_MINUTE requests per IP per minute.
   Controlled by RATE_LIMIT_PER_MINUTE env var (default 20).

3. Request body size limit
   Bodies larger than MAX_BODY_BYTES (default 512 KB) are rejected with 413.

4. Sanitised error responses
   Internal exceptions are logged server-side; only a generic message is
   returned to the caller.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import litellm
import os
import hmac
import hashlib
import time
import logging

logger = logging.getLogger("uvicorn.error")

# ── Config ────────────────────────────────────────────────────────────────────

LLM_MODEL = os.environ["LLM_MODEL"]
LLM_API_KEY = os.environ.get("LLM_API_KEY")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL")

PROXY_TOKEN_SECRET = os.environ.get("PROXY_TOKEN_SECRET", "")
PROXY_TOKEN_TTL_SECONDS = int(os.environ.get("PROXY_TOKEN_TTL_SECONDS", "3600"))
TOKEN_ENABLED = bool(PROXY_TOKEN_SECRET)

RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "20"))

MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(512 * 1024)))  # 512 KB

# L4: fail-closed — require CORS_ORIGINS to be explicitly set in production.
_cors_env = os.environ.get("CORS_ORIGINS", "")
if not _cors_env:
    raise RuntimeError(
        "CORS_ORIGINS must be set (e.g. 'http://localhost:3000'). "
        "Refusing to start with wildcard CORS."
    )
CORS_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]

if not TOKEN_ENABLED:
    logger.warning(
        "PROXY_TOKEN_SECRET is not set — proxy token protection is DISABLED. "
        "Set this in production to prevent unauthorised LLM requests."
    )

# ── Token validation ──────────────────────────────────────────────────────────


def _verify_proxy_token(token: str) -> bool:
    """
    Returns True if the token is well-formed, HMAC-valid, and not expired.
    Expected format: "<expiry_unix>|<nonce>.<hmac_sha256_hex>"
    """
    try:
        payload_part, sig = token.rsplit(".", 1)
    except ValueError:
        return False

    # Constant-time HMAC comparison to prevent timing attacks
    expected_sig = hmac.new(  # type: ignore[attr-defined]
        PROXY_TOKEN_SECRET.encode(),
        payload_part.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_sig, sig):
        return False

    # Check expiry
    try:
        expiry_str, _ = payload_part.split("|", 1)
        expiry = int(expiry_str)
    except (ValueError, IndexError):
        return False

    return time.time() <= expiry


def _token_response(detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"error": {"message": detail, "type": "authentication_error"}},
    )


# ── Rate limiter ──────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI()

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


# ── Security headers middleware (M1) ──────────────────────────────────────────

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# ── Routes ────────────────────────────────────────────────────────────────────


@app.post("/llm/chat/completions")
@limiter.limit(f"{RATE_LIMIT_PER_MINUTE}/minute")
async def proxy_llm(request: Request):
    # 1. Proxy token check
    if TOKEN_ENABLED:
        token = request.headers.get("X-Proxy-Token", "")
        if not token:
            return _token_response("Missing X-Proxy-Token header")
        if not _verify_proxy_token(token):
            return _token_response(
                "Invalid or expired proxy token — please reload the page"
            )

    # 2. Body size guard
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BODY_BYTES:
        return JSONResponse(
            status_code=413,
            content={
                "error": {
                    "message": "Request body too large",
                    "type": "bad_request_error",
                }
            },
        )

    body_bytes = await request.body()
    if len(body_bytes) > MAX_BODY_BYTES:
        return JSONResponse(
            status_code=413,
            content={
                "error": {
                    "message": "Request body too large",
                    "type": "bad_request_error",
                }
            },
        )

    import json as _json

    try:
        body = _json.loads(body_bytes)
    except _json.JSONDecodeError:
        return JSONResponse(
            status_code=400,
            content={
                "error": {"message": "Invalid JSON body", "type": "bad_request_error"}
            },
        )

    # 3. LLM call
    try:
        response = await litellm.acompletion(
            model=LLM_MODEL,
            messages=body["messages"],
            tools=body.get("tools"),
            tool_choice="auto" if body.get("tools") else None,
            api_key=LLM_API_KEY,
            api_base=LLM_BASE_URL,
        )
        return JSONResponse(content=response.model_dump())
    except litellm.AuthenticationError:
        logger.exception("LLM authentication error")
        return JSONResponse(
            status_code=401,
            content={
                "error": {
                    "message": "LLM authentication failed",
                    "type": "authentication_error",
                }
            },
        )
    except litellm.RateLimitError:
        logger.exception("LLM rate limit error")
        return JSONResponse(
            status_code=429,
            content={
                "error": {
                    "message": "LLM rate limit reached — try again shortly",
                    "type": "rate_limit_error",
                }
            },
        )
    except litellm.BadRequestError:
        logger.exception("LLM bad request error")
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "message": "Bad request to LLM provider",
                    "type": "bad_request_error",
                }
            },
        )
    except Exception:
        logger.exception("Unexpected proxy error")
        return JSONResponse(
            status_code=500,
            content={
                "error": {"message": "Internal server error", "type": "provider_error"}
            },
        )


@app.get("/health")
async def health():
    return {"ok": True}
