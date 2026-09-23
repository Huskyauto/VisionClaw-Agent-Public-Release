"""Bounded Scrapling fetchers with an SSRF-denying browser route."""
from __future__ import annotations

import html
import http.client
import logging
import multiprocessing
import re
import socket
import ssl
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlparse

from security import UnsafeUrl, validate_url, validate_url_and_resolve

logger = logging.getLogger(__name__)


@dataclass
class FetchResult:
    source_url: str
    final_url: str
    status: int
    title: str | None
    text: str
    elapsed_ms: int


class FetchFailure(Exception):
    def __init__(self, message: str, status: int | None = None, retry_after: str | None = None):
        super().__init__(message)
        self.status, self.retry_after = status, retry_after


def _guard_browser_page(page: Any) -> None:
    """Abort every browser request whose target fails the same URL policy."""
    def handle(route: Any) -> None:
        try:
            validate_url(route.request.url)
            route.continue_()
        except UnsafeUrl:
            route.abort()
    page.route("**/*", handle)


def _extract(page: Any, max_body: int, max_text: int) -> tuple[str | None, str]:
    body = bytes(page.body)
    if len(body) > max_body:
        raise FetchFailure("response body exceeds limit", 413)
    title_node = page.css_first("title")
    title = str(title_node.text).strip()[:500] if title_node is not None else None
    text = re.sub(r"\s+", " ", page.get_all_text(ignore_tags=("script", "style", "noscript", "template"))).strip()
    return title, html.unescape(text)[:max_text]


class _StaticPage:
    def __init__(self, url: str, status: int, headers: Any, body: bytes):
        self.url, self.status, self.headers, self.body = url, status, headers, body
        # Keep Scrapling as the extraction engine while the worker owns the
        # security-sensitive network transport.
        from scrapling import Selector
        self._selector = Selector(content=body, url=url, huge_tree=False, adaptive=False)

    def css_first(self, selector: str) -> Any:
        return self._selector.css(selector).first

    def get_all_text(self, **_kwargs: Any) -> str:
        return str(self._selector.get_all_text(**_kwargs))


def _pinned_get(url: str, deadline: float, max_body: int, addresses: list[Any] | None = None) -> _StaticPage:
    """GET over a socket connected to the already-validated DNS address."""
    parsed = urlparse(url)
    addresses = addresses or validate_url_and_resolve(url)[1]
    port = parsed.port or 443
    last_error: Exception | None = None
    for address in addresses:
        sock: socket.socket | None = None
        try:
            remaining = max(0.001, deadline - time.monotonic())
            sock = socket.create_connection((str(address), port), timeout=remaining)
            sock.settimeout(max(0.001, deadline - time.monotonic()))
            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=parsed.hostname)
            target = parsed.path or "/"
            if parsed.query:
                target += "?" + parsed.query
            host_header = parsed.hostname if port == 443 else f"{parsed.hostname}:{port}"
            sock.sendall(
                f"GET {target} HTTP/1.1\r\nHost: {host_header}\r\n"
                "Accept-Encoding: identity\r\nConnection: close\r\n\r\n".encode()
            )
            response = http.client.HTTPResponse(sock, method="GET")
            response.begin()
            chunks: list[bytes] = []
            total = 0
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("upstream request timed out")
                sock.settimeout(remaining)
                chunk = response.read(min(64 * 1024, max_body + 1 - total))
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if total > max_body:
                    raise FetchFailure("response body exceeds limit", 413)
            return _StaticPage(url, int(response.status), response.headers, b"".join(chunks))
        except (socket.timeout, TimeoutError) as exc:
            raise FetchFailure("upstream request timed out", 504) from exc
        except (OSError, ssl.SSLError) as exc:
            last_error = exc
        finally:
            if sock is not None:
                sock.close()
    raise FetchFailure("upstream connection failed", 502) from last_error


def _fetch_impl(url: str, mode: str, timeout: float, max_body: int, max_text: int, max_redirects: int) -> FetchResult:
    source, source_addresses = validate_url_and_resolve(url)
    started = time.monotonic()
    deadline = started + timeout
    try:
        if mode == "static":
            current = source
            page = None
            for redirect_count in range(max_redirects + 1):
                page = _pinned_get(current, deadline, max_body, source_addresses)
                status = int(page.status)
                if status not in (301, 302, 303, 307, 308):
                    break
                if redirect_count >= max_redirects:
                    raise FetchFailure("too many redirects", 508)
                location = page.headers.get("location") if page.headers else None
                if not location:
                    raise FetchFailure("redirect response missing Location", 502)
                # This validation occurs before Scrapling is allowed to connect
                # to the redirect target.
                target = urljoin(current, location)
                current_parts, target_parts = urlparse(current), urlparse(target)
                if (
                    (current_parts.hostname or "").rstrip(".").lower()
                    != (target_parts.hostname or "").rstrip(".").lower()
                    or (current_parts.port or 443) != (target_parts.port or 443)
                ):
                    raise FetchFailure("cross-host redirects are not allowed", 421)
                current, source_addresses = validate_url_and_resolve(target)
            if page is None:
                raise FetchFailure("upstream extraction failed", 502)
        else:
            raise FetchFailure("unknown mode", 400)
        final_url = validate_url(str(page.url))
        status = int(page.status)
        if status == 429:
            retry = page.headers.get("retry-after") if page.headers else None
            raise FetchFailure("upstream rate limit", 429, retry)
        if status >= 400:
            raise FetchFailure(f"upstream HTTP {status}", status)
        title, text = _extract(page, max_body, max_text)
        return FetchResult(source, final_url, status, title, text, int((time.monotonic() - started) * 1000))
    except FetchFailure:
        raise
    except UnsafeUrl:
        raise
    except TimeoutError as exc:
        raise FetchFailure("upstream request timed out", 504) from exc
    except Exception as exc:
        message = str(exc)
        if "timed out" in message.lower() or "timeout" in message.lower():
            raise FetchFailure("upstream request timed out", 504) from exc
        raise FetchFailure("upstream extraction failed", 502) from exc


def _fetch_process_entry(result_pipe: Any, args: tuple[Any, ...]) -> None:
    try:
        result = _fetch_impl(*args)
        result_pipe.send(("ok", result.__dict__))
    except UnsafeUrl as exc:
        result_pipe.send(("unsafe", str(exc)))
    except FetchFailure as exc:
        cause = exc.__cause__
        while cause is not None and cause.__cause__ is not None:
            cause = cause.__cause__
        logger.error(
            "Scrapling child fetch failed: status=%s cause=%s",
            exc.status,
            type(cause).__name__ if cause is not None else type(exc).__name__,
        )
        result_pipe.send(("failure", str(exc), exc.status, exc.retry_after))
    except Exception as exc:
        logger.error(
            "Unexpected Scrapling child failure: cause=%s",
            type(exc).__name__,
        )
        result_pipe.send(("failure", "upstream extraction failed", 502, None))
    finally:
        result_pipe.close()


def _stop_process(process: Any) -> None:
    if not process.is_alive():
        process.join(0)
        return
    process.terminate()
    process.join(0.05)
    if process.is_alive():
        process.kill()
        process.join(0.05)


def _run_fetch_isolated(
    args: tuple[Any, ...],
    timeout: float,
    *,
    context_name: str = "spawn",
    entry: Any = _fetch_process_entry,
) -> FetchResult:
    deadline = time.monotonic() + timeout
    ctx = multiprocessing.get_context(context_name)
    parent_pipe, child_pipe = ctx.Pipe(duplex=False)
    process = ctx.Process(target=entry, args=(child_pipe, args), daemon=True)
    try:
        process.start()
        child_pipe.close()
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not parent_pipe.poll(remaining):
            _stop_process(process)
            raise FetchFailure("upstream request timed out", 504)
        try:
            payload = parent_pipe.recv()
        except EOFError as exc:
            raise FetchFailure("upstream extraction failed", 502) from exc
        remaining = max(0.0, deadline - time.monotonic())
        process.join(remaining)
        if process.is_alive():
            _stop_process(process)
        if payload[0] == "ok":
            return FetchResult(**payload[1])
        if payload[0] == "unsafe":
            raise UnsafeUrl(payload[1])
        raise FetchFailure(payload[1], payload[2], payload[3])
    finally:
        parent_pipe.close()
        child_pipe.close()
        if process.pid is not None and process.is_alive():
            _stop_process(process)


def fetch(url: str, mode: str, timeout: float, max_body: int, max_text: int, max_redirects: int) -> FetchResult:
    """Run one scrape behind a parent-enforced hard wall-clock deadline."""
    args = (url, mode, timeout, max_body, max_text, max_redirects)
    return _run_fetch_isolated(args, timeout)
