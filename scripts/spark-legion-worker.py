#!/usr/bin/env python3
"""Outbound-only Spark worker for the Spark Lenovo relay protocol v1."""

from __future__ import annotations

import argparse
import base64
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
import re
import signal
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Mapping, Optional


PROTOCOL = "spark-legion-relay-v1"
MODEL = "hf.co/JetBrains/Mellum2.1-12B-A2.5B-Instruct-GGUF:MXFP4_MOE"
OLLAMA_BASE = "http://100.73.84.100:11434"
APP_BASES = (
    "https://agenticcorporation.net",
    "https://vison-claw-agent.replit.app",
)
PREFIX = "/api/v1/spark/legion-relay"
MAX_BYTES = 65_536
OLLAMA_WALL_SECONDS = 120
HTTP_WALL_SECONDS = 20


class WorkerError(Exception):
    """Expected fail-closed worker error."""


class HTTPFailure(WorkerError):
    def __init__(self, status: int, body: bytes = b""):
        self.status = status
        self.body = body
        super().__init__(f"HTTP status {status}")


class WallTimeout(WorkerError):
    pass


class ResponseTooLarge(WorkerError):
    def __init__(self, partial: bytes):
        self.partial = partial
        super().__init__("HTTP response exceeded size limit")


@contextlib.contextmanager
def wall_deadline(seconds: int):
    """A real whole-operation deadline for this synchronous Unix worker."""
    if not hasattr(signal, "setitimer") or not hasattr(signal, "SIGALRM"):
        raise WorkerError("hard wall-clock timeout requires Unix interval timers")
    previous_handler = signal.getsignal(signal.SIGALRM)

    def expired(_signum: int, _frame: Any) -> None:
        raise WallTimeout("HTTP wall-clock deadline exceeded")

    prior_timer = signal.getitimer(signal.ITIMER_REAL)
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, *prior_timer)
        signal.signal(signal.SIGALRM, previous_handler)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str,
                         headers: Any, newurl: str) -> None:
        return None


class NoBypassProxyHandler(urllib.request.ProxyHandler):
    """Force requests through the explicitly configured Ollama proxy."""

    def proxy_open(self, req: Any, proxy: str, proxy_type: str) -> Any:
        original_type = req.type
        resolved_type, user, password, hostport = urllib.request._parse_proxy(proxy)
        if resolved_type is None:
            resolved_type = original_type
        if user and password:
            user_pass = f"{urllib.parse.unquote(user)}:{urllib.parse.unquote(password)}"
            credentials = base64.b64encode(user_pass.encode()).decode("ascii")
            req.add_header("Proxy-authorization", f"Basic {credentials}")
        req.set_proxy(urllib.parse.unquote(hostport), resolved_type)
        if original_type == resolved_type or original_type == "https":
            return None
        return self.parent.open(req, timeout=req.timeout)


class UrllibClient:
    """Small urllib transport; each instance has an independent proxy policy."""

    def __init__(self, proxy_handler: Optional[urllib.request.ProxyHandler] = None):
        handlers = [NoRedirect()]
        if proxy_handler is not None:
            handlers.insert(0, proxy_handler)
        self.opener = urllib.request.build_opener(*handlers)

    def request(self, method: str, url: str, body: Optional[bytes] = None,
                headers: Optional[Mapping[str, str]] = None,
                timeout: int = HTTP_WALL_SECONDS, max_bytes: int = MAX_BYTES) -> tuple[int, bytes]:
        request = urllib.request.Request(url, data=body, headers=dict(headers or {}),
                                         method=method)
        with wall_deadline(timeout):
            try:
                response = self.opener.open(request, timeout=timeout)
            except urllib.error.HTTPError as exc:
                data = exc.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise ResponseTooLarge(data[:max_bytes])
                raise HTTPFailure(exc.code, data) from None
            except urllib.error.URLError as exc:
                raise WorkerError("HTTP transport failed") from exc
            with response:
                data = response.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise ResponseTooLarge(data[:max_bytes])
                return response.status, data


def derive_ollama_proxy(https_proxy: Optional[str]) -> Optional[str]:
    if not https_proxy:
        return None
    parts = urllib.parse.urlsplit(https_proxy)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise WorkerError("HTTPS_PROXY is not a valid HTTP(S) proxy URL")
    try:
        hostname = parts.hostname
        if ":" in hostname and not hostname.startswith("["):
            hostname = f"[{hostname}]"
        auth = ""
        if parts.username is not None:
            auth = urllib.parse.quote(urllib.parse.unquote(parts.username), safe="")
            if parts.password is not None:
                auth += ":" + urllib.parse.quote(urllib.parse.unquote(parts.password), safe="")
            auth += "@"
        return urllib.parse.urlunsplit((parts.scheme, f"{auth}{hostname}:3130",
                                        parts.path, parts.query, parts.fragment))
    except ValueError as exc:
        raise WorkerError("HTTPS_PROXY is not a valid HTTP(S) proxy URL") from exc


def canonical_app_base(value: str, fixture_clients: bool = False) -> str:
    if value in APP_BASES:
        return value
    # Local HTTP fixture origins are permitted only when a test injects both transports.
    if fixture_clients:
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost") and parsed.port:
            return value.rstrip("/")
    raise WorkerError("application base is not on the approved allowlist")


def _json_load(data: bytes, description: str) -> Any:
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkerError(f"invalid {description} JSON") from exc


def _compact(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def job_path_id(value: Any, *, allow_checkpoint_string: bool = False) -> str:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return str(value)
    if (allow_checkpoint_string and isinstance(value, str)
            and re.fullmatch(r"[1-9][0-9]*", value)):
        return value
    raise WorkerError("jobId must be a positive JSON integer")


def valid_deadline(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None
    except ValueError:
        return False


def _check_worker_id(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{8,64}", value) is not None


def schema_limits(schema: Mapping[str, Any]) -> dict[str, int]:
    expected = {
        "maxRequestBytes": 65_536,
        "maxResponseBytes": 65_536,
        "maxTokens": 2_048,
        "deadlineMs": 210_000,
    }
    limits = schema.get("limits")
    if not isinstance(limits, dict) or set(limits) != set(expected) or any(
        not isinstance(limits.get(key), int) or isinstance(limits.get(key), bool)
        or limits.get(key) != value
        for key, value in expected.items()
    ):
        raise WorkerError("server schema limits do not match relay v1")
    return expected


def validate_schema(schema: Mapping[str, Any]) -> dict[str, int]:
    if (set(schema) != {"protocol", "model", "guardrail", "limits"}
            or schema.get("protocol") != PROTOCOL
            or schema.get("model") != MODEL
            or not isinstance(schema.get("guardrail"), str)
            or not schema["guardrail"]):
        raise WorkerError("server schema does not match protocol, model, and mandatory guardrail")
    return schema_limits(schema)


def validate_native_request(request_json: str, digest: str,
                            schema: Mapping[str, Any]) -> dict[str, Any]:
    encoded = request_json.encode("utf-8")
    limits = validate_schema(schema)
    if len(encoded) > limits["maxRequestBytes"]:
        raise WorkerError("request exceeds schema byte limit")
    if not re.fullmatch(r"[a-f0-9]{64}", digest or ""):
        raise WorkerError("invalid request digest")
    if hashlib.sha256(encoded).hexdigest() != digest:
        raise WorkerError("request digest mismatch")
    guardrail = schema.get("guardrail")
    request = _json_load(encoded, "worker request")
    if not isinstance(request, dict) or set(request) - {"model", "stream", "think", "messages", "options", "format"}:
        raise WorkerError("native request has unsupported fields")
    if (request.get("model") != MODEL or request.get("stream") is not False
            or request.get("think") is not False):
        raise WorkerError("native request model/stream/think mismatch")
    messages = request.get("messages")
    if not isinstance(messages, list) or not 2 <= len(messages) <= 6:
        raise WorkerError("native request must contain 2..6 messages")
    for message in messages:
        if (not isinstance(message, dict) or set(message) != {"role", "content"}
                or message.get("role") not in ("system", "user")
                or not isinstance(message.get("content"), str)):
            raise WorkerError("native request contains unsupported message data")
    if messages[0]["role"] != "system" or messages[0]["content"] != guardrail:
        raise WorkerError("mandatory guardrail must be the exact first system message")
    if (not any(m["role"] == "user" for m in messages)
            or sum(len(m["content"]) for m in messages) > 16_384):
        raise WorkerError("native request requires user text and at most 16384 message characters")
    options = request.get("options")
    if (not isinstance(options, dict) or set(options) != {"temperature", "num_predict"}
            or isinstance(options.get("temperature"), bool)
            or options.get("temperature") != 0
            or isinstance(options.get("num_predict"), bool)
            or not isinstance(options.get("num_predict"), int)
            or not 1 <= options["num_predict"] <= limits["maxTokens"]):
        raise WorkerError("native request generation options violate limits")
    if "format" in request:
        fmt = request["format"]
        if not (fmt == "json" or isinstance(fmt, dict)):
            raise WorkerError("native request format must be 'json' or a schema object")
    return request


def validate_native_response(raw: bytes, max_bytes: int = MAX_BYTES) -> bool:
    if len(raw) > max_bytes:
        return False
    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    if not isinstance(result, dict):
        return False
    message = result.get("message")
    return bool(
        result.get("model") == MODEL
        and result.get("done") is True
        and result.get("done_reason") == "stop"
        and isinstance(message, dict)
        and message.get("role") == "assistant"
        and isinstance(message.get("content"), str)
        and isinstance(result.get("prompt_eval_count"), int)
        and not isinstance(result.get("prompt_eval_count"), bool)
        and result["prompt_eval_count"] >= 0
        and isinstance(result.get("eval_count"), int)
        and not isinstance(result.get("eval_count"), bool)
        and result["eval_count"] >= 0
        and "tool_calls" not in message
        and "tool_calls" not in result
    )


class Checkpoint:
    def __init__(self, home: Path):
        self.directory = home
        self.path = home / "checkpoint.json"
        self.lock_path = home / "worker.lock"
        home.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(home, 0o700)

    def read(self) -> Optional[dict[str, Any]]:
        if not self.path.exists():
            return None
        data = self.path.read_bytes()
        value = _json_load(data, "checkpoint")
        if not isinstance(value, dict):
            raise WorkerError("checkpoint is malformed")
        return value

    def write(self, value: Mapping[str, Any]) -> None:
        payload = _compact(dict(value))
        fd, temporary = tempfile.mkstemp(prefix=".checkpoint-", dir=str(self.directory))
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            os.chmod(self.path, 0o600)
            directory_fd = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            return
        directory_fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    @contextlib.contextmanager
    def exclusive(self):
        fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        os.fchmod(fd, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            raise WorkerError("another worker invocation holds the checkpoint lock")
        try:
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)


class RelayWorker:
    def __init__(self, *, app_base: str = APP_BASES[0], api_key: Optional[str] = None,
                 home: Optional[Path] = None, app_client: Any = None,
                 ollama_client: Any = None, environ: Optional[Mapping[str, str]] = None):
        env = dict(environ) if environ is not None else os.environ
        fixture_clients = app_client is not None and ollama_client is not None
        self.app_base = canonical_app_base(app_base, fixture_clients)
        self.api_key = api_key if api_key is not None else env.get("VC_API_KEY")
        # The secure runtime may resolve an opaque surrogate in flight. Only
        # the application can authenticate it; require a safe bounded header.
        if (not isinstance(self.api_key, str)
                or re.fullmatch(r"[\x21-\x7e]{1,8192}", self.api_key) is None):
            raise WorkerError("VC_API_KEY owner credential is unavailable")
        self.checkpoint = Checkpoint(home or Path.home() / ".spark-legion-relay")
        self.app_client = app_client or UrllibClient()
        ollama_proxy = derive_ollama_proxy(env.get("HTTPS_PROXY"))
        if ollama_client is None and ollama_proxy is None:
            raise WorkerError("HTTPS_PROXY is required to derive the Ollama port-3130 proxy")
        self.ollama_client = ollama_client or UrllibClient(
            NoBypassProxyHandler({"http": ollama_proxy} if ollama_proxy else {})
        )
        self.worker_id = self._worker_id()
        self.last_error: Optional[str] = None

    def _worker_id(self) -> str:
        path = self.checkpoint.directory / "worker-id"
        try:
            value = path.read_text(encoding="ascii").strip()
            if _check_worker_id(value):
                return value
        except FileNotFoundError:
            pass
        value = uuid.uuid4().hex
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            existing = path.read_text(encoding="ascii").strip()
            if _check_worker_id(existing):
                return existing
            raise WorkerError("persistent worker ID is malformed")
        try:
            os.write(fd, value.encode("ascii"))
            os.fsync(fd)
        finally:
            os.close(fd)
        return value

    def _app(self, method: str, suffix: str, value: Any = None) -> Any:
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        body = None
        if value is not None:
            headers["Content-Type"] = "application/json"
            body = _compact(value)
            if len(body) > MAX_BYTES:
                raise WorkerError("application request exceeds 65536 bytes")
        status, data = self.app_client.request(method, self.app_base + PREFIX + suffix,
                                               body, headers, HTTP_WALL_SECONDS, MAX_BYTES)
        if not 200 <= status < 300:
            raise HTTPFailure(status, data)
        return _json_load(data, "application")

    def _ollama(self, method: str, suffix: str, value: Any = None,
                timeout: int = HTTP_WALL_SECONDS,
                max_bytes: int = MAX_BYTES) -> tuple[int, bytes]:
        body = (value if isinstance(value, bytes) else _compact(value)) if value is not None else None
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        return self.ollama_client.request(method, OLLAMA_BASE + suffix, body,
                                          headers, timeout, max_bytes)

    def _binding(self, job: Mapping[str, Any]) -> dict[str, Any]:
        return {key: job[key] for key in ("protocol", "workerId", "requestId", "digest", "claimToken")}

    def _job_path(self, job: Mapping[str, Any]) -> str:
        return urllib.parse.quote(job_path_id(job.get("jobId"), allow_checkpoint_string=True), safe="")

    def _metadata(self, job: Mapping[str, Any]) -> dict[str, Any]:
        metadata = self._app("GET", f"/{self._job_path(job)}")
        if not isinstance(metadata, dict):
            raise WorkerError("invalid job metadata")
        try:
            metadata_id = job_path_id(metadata.get("jobId"))
        except WorkerError:
            raise WorkerError("job metadata identity mismatch") from None
        if (metadata_id != self._job_path(job)
                or metadata.get("requestId") != job.get("requestId")
                or metadata.get("digest") != job.get("digest")
                or metadata.get("model") != MODEL
                or not isinstance(metadata.get("released"), bool)
                or metadata.get("status") not in {
                    "queued", "claimed", "running", "complete", "failed_before_send",
                    "uncertain", "cancelled", "released",
                }
                or not valid_deadline(metadata.get("deadlineAt"))):
            raise WorkerError("job metadata binding mismatch")
        return metadata

    def _resolve_result_conflict(self, saved: Mapping[str, Any]) -> bool:
        try:
            metadata = self._metadata(saved)
        except WorkerError as exc:
            self.last_error = str(exc)
            return False
        status = metadata["status"]
        no_generation = metadata.get("possiblyRunning") is not True
        if ((status in ("cancelled", "failed_before_send", "released")
             or metadata["released"]) and no_generation):
            resolved = dict(saved, state="delivered", resolvedStatus=status)
            self.checkpoint.write(resolved)
            return True
        if status == "complete":
            local_hash = (
                hashlib.sha256(saved["responseJson"].encode("utf-8")).hexdigest()
                if saved.get("outcome") == "complete" and isinstance(saved.get("responseJson"), str)
                else None
            )
            server_hash = metadata.get("responseHash")
            if local_hash is not None and server_hash == local_hash:
                self.checkpoint.write(dict(saved, state="delivered"))
                return True
            # Keep the local completion bytes as evidence but do not retry/replace them.
            uncertain = dict(saved)
            uncertain["priorOutcome"] = saved.get("outcome")
            uncertain["state"] = "uncertain"
            uncertain["outcome"] = "uncertain"
            if isinstance(server_hash, str):
                uncertain["serverResponseHash"] = server_hash
            self.checkpoint.write(uncertain)
            self.last_error = "server completion hash conflicts with saved result; checkpoint halted uncertain"
            return False
        self.last_error = "result conflict remains unresolved in server metadata"
        return False

    def _save_outcome(self, job: Mapping[str, Any], outcome: str,
                      response_json: Optional[str] = None) -> dict[str, Any]:
        saved = dict(job)
        saved.update(state="result_saved", outcome=outcome)
        if response_json is not None:
            saved["responseJson"] = response_json
        self.checkpoint.write(saved)
        return saved

    def _deliver(self, saved: Mapping[str, Any]) -> bool:
        body = self._binding(saved)
        body["outcome"] = saved["outcome"]
        if saved["outcome"] == "complete":
            body["responseJson"] = saved["responseJson"]
        try:
            response = self._app("POST", f"/{self._job_path(saved)}/result", body)
        except HTTPFailure as exc:
            if exc.status == 409:
                return self._resolve_result_conflict(saved)
            self.last_error = str(exc)
            return False
        except WorkerError as exc:
            self.last_error = str(exc)
            return False
        if (not isinstance(response, dict) or response.get("accepted") is not True
                or not isinstance(response.get("duplicate"), bool)):
            self.last_error = "result response lacks accepted:true and boolean duplicate"
            return False
        saved_delivered = dict(saved)
        saved_delivered["state"] = (
            "uncertain" if saved.get("outcome") == "uncertain" else "delivered"
        )
        self.checkpoint.write(saved_delivered)
        return True

    def _recover(self, checkpoint: dict[str, Any]) -> bool:
        state = checkpoint.get("state")
        if state == "delivered":
            self.checkpoint.clear()
            return False
        if state == "result_saved":
            self._deliver(checkpoint)
            return True
        if state == "starting":
            uncertain = self._save_outcome(checkpoint, "uncertain")
            self._deliver(uncertain)
            return True
        if state == "uncertain":
            try:
                metadata = self._metadata(checkpoint)
            except WorkerError as exc:
                self.last_error = str(exc)
                return True
            if (metadata.get("released") is True
                    and metadata.get("possiblyRunning") is not True):
                self.checkpoint.clear()
                return False
            return True
        if state == "claimed":
            # Recovery handled this invocation even if result delivery failed.
            # Never overwrite saved completion bytes by polling another job.
            self._execute_claimed(checkpoint, schema=None)
            return True
        raise WorkerError("unrecognized checkpoint state; refusing new work")

    def _execute_claimed(self, job: dict[str, Any], schema: Optional[Mapping[str, Any]]) -> bool:
        try:
            if schema is None:
                schema = self._app("GET", "/schema")
            limits = schema_limits(schema)
            validate_native_request(job["requestJson"], job["digest"], schema)
        except WorkerError as exc:
            self.last_error = str(exc)
            # No start call was made; report only a definite pre-send failure.
            saved = self._save_outcome(job, "failed_before_send")
            return self._deliver(saved)
        starting = dict(job, state="starting")
        self.checkpoint.write(starting)
        try:
            started = self._app("POST", f"/{self._job_path(job)}/start",
                                self._binding(job))
        except WorkerError as exc:
            self.last_error = str(exc)
            uncertain = self._save_outcome(starting, "uncertain")
            self._deliver(uncertain)
            return False
        if not isinstance(started, dict) or started.get("started") is not True:
            possibly_started = not (isinstance(started, dict) and
                                    started.get("possiblyStarted") is False)
            outcome = "uncertain" if possibly_started else "failed_before_send"
            self.last_error = "start response did not authorize inference"
            saved = self._save_outcome(starting, outcome)
            delivered = self._deliver(saved)
            return delivered and outcome != "uncertain"
        try:
            status, raw = self._ollama("POST", "/api/chat",
                                       job["requestJson"].encode("utf-8"),
                                       OLLAMA_WALL_SECONDS, limits["maxResponseBytes"])
            if status < 200 or status >= 300:
                raise WorkerError("Ollama generation returned non-success")
        except ResponseTooLarge as exc:
            self.last_error = "Ollama response exceeded schema byte limit"
            uncertain = self._save_outcome(starting, "uncertain")
            uncertain["invalidResponseBase64"] = base64.b64encode(exc.partial).decode("ascii")
            self.checkpoint.write(uncertain)
            self._deliver(uncertain)
            return False
        except WorkerError as exc:
            self.last_error = str(exc)
            self._deliver(self._save_outcome(starting, "uncertain"))
            return False
        if not validate_native_response(raw, limits["maxResponseBytes"]):
            self.last_error = "Ollama response failed native schema validation"
            bad_response = raw.decode("utf-8", errors="replace")
            uncertain = self._save_outcome(starting, "uncertain", bad_response)
            uncertain["invalidResponseBase64"] = base64.b64encode(raw).decode("ascii")
            self.checkpoint.write(uncertain)
            self._deliver(uncertain)
            return False
        response_json = raw.decode("utf-8")
        complete_body = self._binding(starting)
        complete_body.update(outcome="complete", responseJson=response_json)
        if len(_compact(complete_body)) > MAX_BYTES:
            self.last_error = "complete result exceeds 65536-byte delivery limit"
            uncertain = self._save_outcome(starting, "uncertain", response_json)
            self._deliver(uncertain)
            return False
        saved = self._save_outcome(starting, "complete", response_json)
        return self._deliver(saved)

    def run_once(self) -> str:
        with self.checkpoint.exclusive():
            self.last_error = None
            existing = self.checkpoint.read()
            if existing is not None and self._recover(existing):
                return "pending"
            try:
                schema = self._app("GET", "/schema")
                if not isinstance(schema, dict):
                    raise WorkerError("invalid schema response")
                validate_schema(schema)
                health_error = None
                health_failed = False
                try:
                    status, tags_raw = self._ollama("GET", "/api/tags")
                    if not 200 <= status < 300:
                        raise WorkerError(f"Ollama tags returned HTTP {status}")
                    tags = _json_load(tags_raw, "Ollama tags")
                    models = tags.get("models") if isinstance(tags, dict) else None
                    ready = (isinstance(models, list)
                             and any(isinstance(item, dict) and item.get("name") == MODEL for item in models))
                    if not ready:
                        health_error = "exact approved Ollama model is not ready"
                except WorkerError as exc:
                    ready = False
                    health_error = str(exc)
                    health_failed = True
                poll = self._app("POST", "/poll", {
                    "protocol": PROTOCOL, "workerId": self.worker_id, "model": MODEL, "ready": ready,
                })
                if not isinstance(poll, dict) or poll.get("protocol") != PROTOCOL:
                    raise WorkerError("invalid poll response")
                job = poll.get("job")
                if not ready:
                    self.last_error = health_error
                    if job is not None:
                        raise WorkerError("server returned work while worker readiness is false")
                    return "error" if health_failed else "not-ready"
                if job is None:
                    return "idle"
                if not isinstance(job, dict):
                    raise WorkerError("invalid job response")
                try:
                    job_path_id(job.get("jobId"))
                    if not valid_deadline(job.get("deadlineAt")):
                        raise ValueError
                except (WorkerError, ValueError):
                    raise WorkerError("invalid job ID or deadline")
                required = ("requestId", "digest", "requestJson", "claimToken")
                if (any(not isinstance(job.get(k), str) or not job[k] for k in required)
                        or len(job["requestJson"].encode("utf-8")) > schema_limits(schema)["maxRequestBytes"]):
                    raise WorkerError("invalid worker job fields")
                claimed = dict(job, protocol=PROTOCOL, workerId=self.worker_id, state="claimed")
                self.checkpoint.write(claimed)
                return "complete" if self._execute_claimed(claimed, schema) else "pending"
            except WorkerError as exc:
                self.last_error = str(exc)
                return "error"


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="perform one bounded recovery/poll cycle")
    parser.add_argument("--app-base", choices=APP_BASES, default=APP_BASES[0],
                        help="approved production application origin")
    args = parser.parse_args(argv)
    if not args.once:
        parser.error("only --once is supported; schedule it once per minute")
    try:
        worker = RelayWorker(app_base=args.app_base)
        outcome = worker.run_once()
        print(outcome)
        if worker.last_error:
            print(f"spark-legion-worker: {worker.last_error}", file=sys.stderr)
        return 0 if outcome in ("complete", "idle", "not-ready") else 1
    except WorkerError as exc:
        print(f"spark-legion-worker: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
