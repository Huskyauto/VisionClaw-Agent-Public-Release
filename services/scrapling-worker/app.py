from __future__ import annotations

import os
import time
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from fetcher import FetchFailure, fetch
from security import UnsafeUrl, validate_url

app = FastAPI(title="Scrapling governed HTTP worker", version="1.0")
STARTED = time.monotonic()
MAX_TIMEOUT = 30.0
MAX_BODY = 5 * 1024 * 1024
MAX_TEXT = 100_000
MAX_REDIRECTS = 5


class ScrapeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: HttpUrl
    mode: Literal["static"] = "static"
    timeout_seconds: float = Field(default=15, gt=0, le=MAX_TIMEOUT)


def auth(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("SCRAPLING_ACCESS_KEY")
    if not expected or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="authentication required", headers={"WWW-Authenticate": "Bearer"})


@app.get("/healthz", dependencies=[Depends(auth)])
def healthz():
    return {"ok": True, "service": "scrapling-worker", "uptimeSec": int(time.monotonic() - STARTED)}


@app.get("/livez")
def livez():
    return {"ok": True}


@app.post("/v1/scrape", dependencies=[Depends(auth)])
def scrape(payload: ScrapeRequest, request: Request):
    try:
        url = validate_url(str(payload.url))
        result = fetch(url, payload.mode, payload.timeout_seconds, MAX_BODY, MAX_TEXT, MAX_REDIRECTS)
    except UnsafeUrl as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FetchFailure as exc:
        headers = {}
        if exc.retry_after:
            headers["Retry-After"] = exc.retry_after
        raise HTTPException(
            status_code=exc.status or 502,
            detail={
                "error": str(exc),
                "rateLimit": {"limited": exc.status == 429, "retryAfter": exc.retry_after},
            },
            headers=headers,
        ) from exc
    return {
        "sourceUrl": result.source_url,
        "finalUrl": result.final_url,
        "status": result.status,
        "mode": payload.mode,
        "title": result.title,
        "text": result.text,
        "timingMs": result.elapsed_ms,
        "rateLimit": {"limited": False, "retryAfter": None},
        "requestId": request.headers.get("X-Request-Id"),
    }


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail}, headers=exc.headers or {})
