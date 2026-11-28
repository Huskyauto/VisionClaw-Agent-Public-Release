import hashlib
import importlib.util
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "spark-legion-worker.py"
SPEC = importlib.util.spec_from_file_location("spark_legion_worker", SCRIPT)
worker_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker_module)


class FakeClient:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    def request(self, method, url, body=None, headers=None, timeout=20, max_bytes=65536):
        self.calls.append((method, url, body, dict(headers or {}), timeout, max_bytes))
        return self.responder(method, url, body, headers or {})


def native_request(guard="approved guard", model=None):
    request = {
        "model": model or worker_module.MODEL,
        "stream": False,
        "think": False,
        "messages": [
            {"role": "system", "content": guard},
            {"role": "user", "content": "compile this screened runbook"},
        ],
        "options": {"temperature": 0, "num_predict": 32},
    }
    exact = json.dumps(request, ensure_ascii=False, separators=(",", ":"))
    return exact, hashlib.sha256(exact.encode()).hexdigest()


def schema(guard="approved guard"):
    return {
        "protocol": worker_module.PROTOCOL,
        "model": worker_module.MODEL,
        "guardrail": guard,
        "limits": {
            "maxRequestBytes": 65536, "maxResponseBytes": 65536,
            "maxTokens": 2048, "deadlineMs": 210000,
        },
    }


def native_result(model=None):
    return json.dumps({
        "model": model or worker_module.MODEL,
        "created_at": "fixture",
        "message": {"role": "assistant", "content": "safe result"},
        "done": True,
        "done_reason": "stop",
        "prompt_eval_count": 11,
        "eval_count": 7,
    }, separators=(",", ":")).encode()


class Fixture:
    def __init__(self, *, start_result=None, result_reply=None, request_override=None):
        self.request_json, self.digest = native_request()
        self.start_result = start_result if start_result is not None else {"started": True}
        self.result_reply = result_reply if result_reply is not None else {
            "accepted": True, "duplicate": False
        }
        self.request_override = request_override
        self.polls = 0
        self.poll_job_id = 1
        self.no_job = False
        self.poll_readiness = []
        self.tags = [{"name": worker_module.MODEL}]
        self.starts = 0
        self.results = []
        self.metadata = {
            "jobId": 1, "status": "uncertain", "requestId": "request-1",
            "digest": self.digest, "released": False, "model": worker_module.MODEL,
            "deadlineAt": "2030-01-01T00:00:00Z",
        }
        self.app = FakeClient(self.app_reply)
        self.ollama = FakeClient(self.ollama_reply)

    def app_reply(self, method, url, body, headers):
        suffix = url.split(worker_module.PREFIX, 1)[1]
        if method == "GET" and suffix == "/schema":
            return 200, json.dumps(schema()).encode()
        if method == "POST" and suffix == "/poll":
            self.polls += 1
            ready = json.loads(body)["ready"]
            self.poll_readiness.append(ready)
            if not ready:
                return 200, json.dumps({"protocol": worker_module.PROTOCOL, "job": None}).encode()
            if self.no_job:
                return 200, json.dumps({"protocol": worker_module.PROTOCOL, "job": None}).encode()
            request_json = self.request_override or self.request_json
            digest = self.digest if self.request_override is None else hashlib.sha256(request_json.encode()).hexdigest()
            job = {
                "jobId": self.poll_job_id, "requestId": "request-1", "digest": digest,
                "requestJson": request_json, "claimToken": "claim-1",
                "deadlineAt": "2030-01-01T00:00:00Z",
            }
            return 200, json.dumps({"protocol": worker_module.PROTOCOL, "job": job}).encode()
        if method == "POST" and suffix == "/1/start":
            self.starts += 1
            return 200, json.dumps(self.start_result).encode()
        if method == "POST" and suffix == "/1/result":
            self.results.append(json.loads(body))
            if isinstance(self.result_reply, Exception):
                raise self.result_reply
            if self.result_reply == "409":
                raise worker_module.HTTPFailure(409, b"")
            return 200, json.dumps(self.result_reply).encode()
        if method == "GET" and suffix == "/1":
            return 200, json.dumps(self.metadata).encode()
        raise AssertionError(f"unexpected app request {method} {suffix}")

    def ollama_reply(self, method, url, body, headers):
        if method == "GET" and url.endswith("/api/tags"):
            return 200, json.dumps({"models": self.tags}).encode()
        if method == "POST" and url.endswith("/api/chat"):
            return 200, native_result()
        raise AssertionError(f"unexpected Ollama request {method} {url}")

    def make_worker(self, home):
        return worker_module.RelayWorker(
            app_base="http://127.0.0.1:12345", api_key="vc_test_secret",
            home=home, app_client=self.app, ollama_client=self.ollama,
            environ={},
        )


class SparkLegionWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name) / "private"

    def tearDown(self):
        self.temp.cleanup()

    def test_opaque_injected_credential_is_preserved_only_for_approved_app(self):
        credential = "hsurr:synthetic-fixture-only"
        fixture = Fixture()
        worker = worker_module.RelayWorker(
            home=self.home, app_client=fixture.app, ollama_client=fixture.ollama,
            environ={"VC_API_KEY": credential},
        )
        self.assertEqual(worker.run_once(), "complete")
        self.assertTrue(fixture.app.calls)
        for call in fixture.app.calls:
            self.assertTrue(call[1].startswith(worker_module.APP_BASES[0] + worker_module.PREFIX))
            self.assertEqual(call[3]["Authorization"], "Bearer " + credential)
        self.assertNotIn(credential, repr(fixture.ollama.calls))
        self.assertTrue(all("Authorization" not in call[3] for call in fixture.ollama.calls))
        for path in self.home.iterdir():
            if path.is_file():
                self.assertNotIn(credential.encode(), path.read_bytes())

    def test_unsafe_credentials_fail_before_network_or_checkpoint_creation(self):
        for credential in (None, "", 7, False, [], " ", " hsurr:fixture", "hsurr:fixture ",
                           "hsurr:fixture\r\nX-Injected: value", "vc_bad\n", "hsurr:\tfixture",
                           "hsurr:\x00fixture", "hsurr:\x1ffixture", "hsurr:\x7ffixture",
                           "hsurr:\u00e9", "x" * 8193):
            with self.subTest(credential_type=type(credential).__name__):
                fixture = Fixture()
                with self.assertRaisesRegex(worker_module.WorkerError, "^VC_API_KEY owner credential is unavailable$"):
                    worker_module.RelayWorker(
                        api_key=credential, home=self.home,
                        app_client=fixture.app, ollama_client=fixture.ollama, environ={},
                    )
                self.assertEqual(fixture.app.calls, [])
                self.assertEqual(fixture.ollama.calls, [])
                self.assertFalse(self.home.exists())

    def test_opaque_credentials_do_not_allow_unapproved_application_destinations(self):
        for origin in ("https://evil.example", "http://agenticcorporation.net",
                       "https://agenticcorporation.net.evil.example",
                       "https://agenticcorporation.net@evil.example.test",
                       "https://agenticcorporation.net/redirect"):
            with self.subTest(origin=origin):
                fixture = Fixture()
                with self.assertRaises(worker_module.WorkerError):
                    worker_module.RelayWorker(
                        app_base=origin, api_key="hsurr:synthetic-fixture-only", home=self.home,
                        app_client=fixture.app, ollama_client=fixture.ollama, environ={},
                    )
                self.assertEqual(fixture.app.calls, [])
                self.assertEqual(fixture.ollama.calls, [])
                self.assertFalse(self.home.exists())

    def test_schema_auth_rejection_stops_before_poll_or_ollama_without_disclosing_body(self):
        for status in (401, 403):
            with self.subTest(status=status):
                credential = "hsurr:synthetic-fixture-only"
                fixture = Fixture()
                app = FakeClient(lambda *_: (status, credential.encode()))
                worker = worker_module.RelayWorker(
                    home=self.home, app_client=app, ollama_client=fixture.ollama,
                    environ={"VC_API_KEY": credential},
                )
                self.assertEqual(worker.run_once(), "error")
                self.assertEqual(worker.last_error, "HTTP status " + str(status))
                self.assertEqual(len(app.calls), 1)
                self.assertTrue(app.calls[0][1].endswith("/schema"))
                self.assertEqual(fixture.ollama.calls, [])

    def test_html_schema_response_is_not_readiness_and_does_not_poll(self):
        fixture = Fixture()
        app = FakeClient(lambda *_: (200, b"<!doctype html><html>application shell</html>"))
        worker = worker_module.RelayWorker(
            home=self.home, app_client=app, ollama_client=fixture.ollama,
            environ={"VC_API_KEY": "hsurr:synthetic-fixture-only"},
        )
        self.assertEqual(worker.run_once(), "error")
        self.assertEqual(worker.last_error, "invalid application JSON")
        self.assertEqual(len(app.calls), 1)
        self.assertEqual(fixture.ollama.calls, [])

    def test_opaque_credential_survives_real_http_header_serialization(self):
        authorization_headers = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                authorization_headers.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(schema()).encode())

            def do_POST(self):
                authorization_headers.append(self.headers.get("Authorization"))
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"protocol": worker_module.PROTOCOL, "job": None}).encode())

            def log_message(self, *_args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            fixture = Fixture()
            worker = worker_module.RelayWorker(
                app_base=f"http://127.0.0.1:{server.server_port}", home=self.home,
                app_client=worker_module.UrllibClient(worker_module.urllib.request.ProxyHandler({})),
                ollama_client=fixture.ollama,
                environ={"VC_API_KEY": "hsurr:synthetic-fixture-only"},
            )
            self.assertEqual(worker.run_once(), "idle")
            self.assertEqual(authorization_headers, ["Bearer hsurr:synthetic-fixture-only"] * 2)
            self.assertTrue(all("Authorization" not in call[3] for call in fixture.ollama.calls))
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_success_duplicate_result_and_no_secret_forwarding(self):
        fixture = Fixture(result_reply={"accepted": True, "duplicate": True})
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "complete")
        self.assertEqual(fixture.starts, 1)
        self.assertEqual(len(fixture.results), 1)
        self.assertTrue(fixture.results[0]["responseJson"].startswith('{"model":'))
        self.assertEqual(fixture.results[0]["outcome"], "complete")
        self.assertTrue(all("Authorization" not in call[3] for call in fixture.ollama.calls))
        self.assertTrue(all("vc_test_secret" not in repr(call) for call in fixture.ollama.calls))
        chat_call = next(call for call in fixture.ollama.calls
                         if call[0] == "POST" and call[1].endswith("/api/chat"))
        self.assertEqual(chat_call[2], fixture.request_json.encode("utf-8"))
        self.assertEqual((self.home.stat().st_mode & 0o777), 0o700)
        self.assertEqual((self.home / "checkpoint.json").stat().st_mode & 0o777, 0o600)

    def test_invalid_guardrail_is_failed_before_send_without_generation(self):
        bad, digest = native_request(guard="wrong guard")
        fixture = Fixture(request_override=bad)
        fixture.digest = digest
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "complete")
        self.assertEqual(fixture.starts, 0)
        self.assertEqual(fixture.results[0]["outcome"], "failed_before_send")
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/api/chat")
                             for call in fixture.ollama.calls))

    def test_wrong_model_is_failed_before_send(self):
        wrong, digest = native_request(model="some-other-model")
        fixture = Fixture(request_override=wrong)
        fixture.digest = digest
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "complete")
        self.assertEqual(fixture.starts, 0)
        self.assertEqual(fixture.results[0]["outcome"], "failed_before_send")

    def test_started_false_only_fails_before_send_when_server_says_not_started(self):
        fixture = Fixture(start_result={"started": False, "possiblyStarted": False})
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "complete")
        self.assertEqual(fixture.results[0]["outcome"], "failed_before_send")
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/api/chat")
                             for call in fixture.ollama.calls))

    def test_ambiguous_start_is_uncertain_and_blocks_future_poll(self):
        fixture = Fixture()
        fixture.start_result = RuntimeError("unknown start result")
        original = fixture.app_reply

        def lost_start(method, url, body, headers):
            if method == "POST" and url.endswith("/1/start"):
                fixture.starts += 1
                raise worker_module.WorkerError("connection lost")
            return original(method, url, body, headers)

        fixture.app = FakeClient(lost_start)
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(fixture.results[0]["outcome"], "uncertain")
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/api/chat")
                             for call in fixture.ollama.calls))
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(fixture.polls, 1)
        self.assertTrue(any(call[0] == "GET" and call[1].endswith("/1")
                            for call in fixture.app.calls))
        fixture.metadata["released"] = True
        fixture.no_job = True
        self.assertEqual(worker.run_once(), "idle")
        self.assertEqual(fixture.polls, 2)

    def test_restart_from_starting_reports_uncertain_without_generation(self):
        fixture = Fixture()
        checkpoint = worker_module.Checkpoint(self.home)
        checkpoint.write({
            "state": "starting", "protocol": worker_module.PROTOCOL,
            "workerId": "worker_123", "jobId": 1, "requestId": "request-1",
            "digest": fixture.digest, "requestJson": fixture.request_json,
            "claimToken": "claim-1",
        })
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(fixture.results[0]["outcome"], "uncertain")
        self.assertEqual(fixture.polls, 0)
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/api/chat")
                             for call in fixture.ollama.calls))

    def test_restart_from_saved_result_only_redelivers(self):
        fixture = Fixture()
        raw = native_result().decode()
        checkpoint = worker_module.Checkpoint(self.home)
        checkpoint.write({
            "state": "result_saved", "outcome": "complete", "responseJson": raw,
            "protocol": worker_module.PROTOCOL, "workerId": "worker_123",
            "jobId": 1, "requestId": "request-1", "digest": fixture.digest,
            "requestJson": fixture.request_json, "claimToken": "claim-1",
        })
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(fixture.polls, 0)
        self.assertEqual(fixture.starts, 0)

        self.assertEqual(len(fixture.results), 1)
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/api/chat")
                             for call in fixture.ollama.calls))

    def test_recovered_claim_keeps_result_after_accounting_503_without_polling(self):
        fixture = Fixture(result_reply=worker_module.HTTPFailure(503, b"accounting pending"))
        fixture.poll_job_id = 2  # Server could now offer another queued job.
        checkpoint = worker_module.Checkpoint(self.home)
        checkpoint.write({
            "state": "claimed", "protocol": worker_module.PROTOCOL,
            "workerId": "worker_123", "jobId": 1, "requestId": "request-1",
            "digest": fixture.digest, "requestJson": fixture.request_json,
            "claimToken": "claim-1",
        })
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "pending")
        saved = worker.checkpoint.read()
        self.assertEqual(saved["state"], "result_saved")
        original = saved["responseJson"]
        self.assertEqual(original, fixture.results[0]["responseJson"])
        self.assertEqual(fixture.polls, 0)
        self.assertEqual(fixture.starts, 1)
        self.assertEqual(sum(c[1].endswith("/api/chat") for c in fixture.ollama.calls), 1)
        fixture.result_reply = {"accepted": True, "duplicate": True}
        restarted = fixture.make_worker(self.home)
        self.assertEqual(restarted.run_once(), "pending")
        self.assertEqual(fixture.results[-1]["responseJson"], original)
        self.assertEqual(fixture.polls, 0)
        self.assertEqual(fixture.starts, 1)
        self.assertEqual(sum(c[1].endswith("/api/chat") for c in fixture.ollama.calls), 1)

    def test_409_result_does_not_regenerate_and_saved_bytes_remain(self):
        fixture = Fixture(result_reply="409")
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(fixture.starts, 1)
        saved = worker.checkpoint.read()
        self.assertEqual(saved["state"], "result_saved")
        self.assertEqual(saved["responseJson"], fixture.results[0]["responseJson"])
        count = sum(call[0] == "POST" and call[1].endswith("/api/chat")
                    for call in fixture.ollama.calls)
        self.assertEqual(count, 1)
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(sum(call[0] == "POST" and call[1].endswith("/api/chat")
                             for call in fixture.ollama.calls), 1)

    def test_response_wrong_model_becomes_uncertain(self):
        fixture = Fixture()
        fixture.ollama = FakeClient(lambda method, url, body, headers:
            (200, json.dumps({"model": "wrong", "done": True, "done_reason": "stop",
                              "message": {"role": "assistant", "content": "x"},
                              "prompt_eval_count": 1, "eval_count": 1}).encode())
            if method == "POST" else fixture.ollama_reply(method, url, body, headers))
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(fixture.results[0]["outcome"], "uncertain")
        self.assertEqual(worker.checkpoint.read()["state"], "uncertain")
        self.assertIn("native schema validation", worker.last_error)

    def test_ollama_http_error_is_reported_and_never_retried(self):
        fixture = Fixture()
        fixture.ollama = FakeClient(lambda method, url, body, headers:
            (200, json.dumps({"models": [{"name": worker_module.MODEL}]}).encode())
            if method == "GET" else (_ for _ in ()).throw(
                worker_module.HTTPFailure(404, b'{"error":"model not found"}')))
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(fixture.results[0]["outcome"], "uncertain")
        self.assertEqual(worker.last_error, "HTTP status 404")
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(sum(call[0] == "POST" and call[1].endswith("/api/chat")
                             for call in fixture.ollama.calls), 1)

    def test_app_redirect_is_not_followed(self):
        class Handler(BaseHTTPRequestHandler):
            calls = 0

            def do_GET(self):
                Handler.calls += 1
                self.send_response(302)
                self.send_header("Location", "/other")
                self.end_headers()

            def log_message(self, *_args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = worker_module.UrllibClient()
            with self.assertRaises(worker_module.HTTPFailure) as caught:
                client.request("GET", f"http://127.0.0.1:{server.server_port}/", timeout=2)
            self.assertEqual(caught.exception.status, 302)
            self.assertEqual(Handler.calls, 1)
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_proxy_port_derived_and_hosts_allowlisted(self):
        self.assertEqual(worker_module.derive_ollama_proxy("http://user:pw@proxy.example.test:8080"),
                         "http://user:pw@proxy.example.test:3130")
        with self.assertRaises(worker_module.WorkerError):
            worker_module.canonical_app_base("https://evil.example")
        proxy_handler = worker_module.NoBypassProxyHandler(
            {"http": "http://proxy.example:3130"}
        )
        request = worker_module.urllib.request.Request(
            "http://100.73.84.100:11434/api/tags"
        )
        with patch.object(worker_module.urllib.request, "proxy_bypass",
                          side_effect=AssertionError("must not bypass configured Ollama proxy")):
            proxy_handler.proxy_open(request, "http://proxy.example:3130", "http")
        self.assertEqual(request.host, "proxy.example:3130")

    def test_system_correction_may_end_message_sequence_and_format_is_strict(self):
        request = {
            "model": worker_module.MODEL, "stream": False, "think": False,
            "messages": [
                {"role": "system", "content": "approved guard"},
                {"role": "user", "content": "initial output"},
                {"role": "system", "content": "correct the validation issue"},
            ],
            "options": {"temperature": 0, "num_predict": 8},
            "format": {"type": "object", "properties": {"ok": {"type": "boolean"}}},
        }
        exact = json.dumps(request, separators=(",", ":"))
        digest = hashlib.sha256(exact.encode()).hexdigest()
        self.assertEqual(worker_module.validate_native_request(exact, digest, schema()), request)
        request["format"] = ["json"]
        exact = json.dumps(request, separators=(",", ":"))
        with self.assertRaises(worker_module.WorkerError):
            worker_module.validate_native_request(exact, hashlib.sha256(exact.encode()).hexdigest(), schema())

    def test_schema_limits_digest_and_native_count_types_are_strict(self):
        exact, digest = native_request()
        with self.assertRaises(worker_module.WorkerError):
            worker_module.validate_native_request(exact, "0" * 64, schema())
        invalid_schema = schema()
        invalid_schema["limits"]["maxTokens"] = True
        with self.assertRaises(worker_module.WorkerError):
            worker_module.validate_native_request(exact, digest, invalid_schema)

        for field_value in (True, 1.5, -1):
            result = json.loads(native_result())
            result["eval_count"] = field_value
            self.assertFalse(worker_module.validate_native_response(json.dumps(result).encode()))
        result = json.loads(native_result())
        result["done"] = 1
        self.assertFalse(worker_module.validate_native_response(json.dumps(result).encode()))

    def test_health_failure_posts_ready_false_for_freshness(self):
        fixture = Fixture()
        fixture.ollama = FakeClient(lambda method, url, body, headers:
            (200, json.dumps({"models": [{"name": "unknown-model"}]}).encode())
            if method == "GET" else fixture.ollama_reply(method, url, body, headers))
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "not-ready")
        self.assertEqual(fixture.poll_readiness, [False])
        self.assertEqual(fixture.starts, 0)

    def test_result_409_uses_metadata_to_resolve_identical_complete(self):
        fixture = Fixture(result_reply="409")
        response_json = native_result().decode()
        fixture.metadata.update(
            status="complete",
            responseHash=hashlib.sha256(response_json.encode()).hexdigest(),
        )
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "complete")
        self.assertTrue(any(call[0] == "GET" and call[1].endswith("/1")
                            for call in fixture.app.calls))
        self.assertEqual(worker.checkpoint.read()["state"], "delivered")

    def test_conflicting_complete_hash_becomes_retained_uncertain(self):
        fixture = Fixture(result_reply="409")
        fixture.metadata.update(status="complete", responseHash="0" * 64)
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "pending")
        checkpoint = worker.checkpoint.read()
        self.assertEqual(checkpoint["state"], "uncertain")
        self.assertEqual(checkpoint["priorOutcome"], "complete")
        self.assertTrue(checkpoint["responseJson"].startswith('{"model":'))
        self.assertEqual(worker.run_once(), "pending")
        self.assertEqual(fixture.polls, 1)

    def test_cancelled_metadata_resolves_result_409_without_inference_retry(self):
        fixture = Fixture(result_reply="409")
        fixture.metadata.update(status="cancelled")
        worker = fixture.make_worker(self.home)
        self.assertEqual(worker.run_once(), "complete")
        self.assertEqual(fixture.starts, 1)
        self.assertEqual(sum(call[0] == "POST" and call[1].endswith("/api/chat")
                             for call in fixture.ollama.calls), 1)

    def test_full_two_server_http_fixture_poll_start_chat_result(self):
        request_json, digest = native_request()
        provider_bytes = native_result()
        observations = {"app": [], "ollama": [], "result": None, "workerId": None}
        job = {
            "jobId": 23, "requestId": "request-http", "digest": digest,
            "requestJson": request_json, "claimToken": "claim-http",
            "deadlineAt": "2030-01-01T00:00:00Z",
        }

        def send_json(handler, status, value):
            payload = json.dumps(value, separators=(",", ":")).encode()
            handler.send_response(status)
            handler.send_header("Content-Type", "application/json")
            handler.send_header("Content-Length", str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)

        class AppHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                observations["app"].append((self.command, self.path, self.headers.get("Authorization")))
                if self.headers.get("Authorization") != "Bearer vc_http_fixture":
                    return self.send_error(401)
                if self.path.endswith("/schema"):
                    return send_json(self, 200, schema())
                self.send_error(404)

            def do_POST(self):
                size = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(size)
                observations["app"].append((self.command, self.path, self.headers.get("Authorization")))
                if not self.assert_owner():
                    return
                if self.headers.get("Content-Type") != "application/json":
                    return self.send_error(400)
                if self.path.endswith("/poll"):
                    poll = json.loads(raw)
                    if poll != {
                        "protocol": worker_module.PROTOCOL,
                        "workerId": poll["workerId"], "model": worker_module.MODEL, "ready": True,
                    } or not worker_module._check_worker_id(poll["workerId"]):
                        return self.send_error(400)
                    observations["workerId"] = poll["workerId"]
                    return send_json(self, 200, {"protocol": worker_module.PROTOCOL, "job": job})
                if self.path.endswith("/23/start"):
                    binding = json.loads(raw)
                    if binding != {
                        "protocol": worker_module.PROTOCOL, "workerId": observations["workerId"],
                        "requestId": "request-http", "digest": digest, "claimToken": "claim-http",
                    }:
                        return self.send_error(400)
                    return send_json(self, 200, {"started": True})
                if self.path.endswith("/23/result"):
                    result = json.loads(raw)
                    expected = {
                        "protocol": worker_module.PROTOCOL, "workerId": observations["workerId"],
                        "requestId": "request-http", "digest": digest, "claimToken": "claim-http",
                        "outcome": "complete", "responseJson": provider_bytes.decode(),
                    }
                    if result != expected:
                        return self.send_error(400)
                    observations["result"] = result
                    return send_json(self, 200, {"accepted": True, "duplicate": False})
                self.send_error(404)

            def assert_owner(self):
                if self.headers.get("Authorization") != "Bearer vc_http_fixture":
                    self.send_error(401)
                    return False
                return True

            def log_message(self, *_args):
                pass

        class OllamaHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                observations["ollama"].append((self.command, self.path, self.headers.get("Authorization")))
                if self.headers.get("Accept") != "application/json":
                    return self.send_error(400)
                if self.path == "/api/tags":
                    return send_json(self, 200, {"models": [{"name": worker_module.MODEL}]})
                self.send_error(404)

            def do_POST(self):
                size = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(size)
                observations["ollama"].append((self.command, self.path, self.headers.get("Authorization")))
                if (self.path != "/api/chat" or raw != request_json.encode("utf-8")
                        or self.headers.get("Accept") != "application/json"
                        or self.headers.get("Content-Type") != "application/json"):
                    return self.send_error(400)
                return send_json(self, 200, json.loads(provider_bytes))

            def log_message(self, *_args):
                pass

        app_server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
        ollama_server = ThreadingHTTPServer(("127.0.0.1", 0), OllamaHandler)
        app_thread = threading.Thread(target=app_server.serve_forever, daemon=True)
        ollama_thread = threading.Thread(target=ollama_server.serve_forever, daemon=True)
        app_thread.start()
        ollama_thread.start()

        class LocalOllamaClient:
            def __init__(self):
                self.client = worker_module.UrllibClient()
                self.origin = f"http://127.0.0.1:{ollama_server.server_port}"

            def request(self, method, url, body=None, headers=None, timeout=20, max_bytes=65536):
                mapped = url.replace(worker_module.OLLAMA_BASE, self.origin, 1)
                return self.client.request(method, mapped, body, headers, timeout, max_bytes)

        try:
            worker = worker_module.RelayWorker(
                app_base=f"http://127.0.0.1:{app_server.server_port}",
                api_key="vc_http_fixture", home=self.home,
                app_client=worker_module.UrllibClient(),
                ollama_client=LocalOllamaClient(), environ={},
            )
            self.assertEqual(worker.run_once(), "complete")
            self.assertEqual(observations["result"]["responseJson"], provider_bytes.decode())
            self.assertTrue(all(item[2] == "Bearer vc_http_fixture" for item in observations["app"]))
            self.assertTrue(all(item[2] is None for item in observations["ollama"]))
            self.assertEqual([item[1].rsplit("/", 1)[-1] for item in observations["app"]
                              if item[0] == "POST"], ["poll", "start", "result"])
        finally:
            app_server.shutdown()
            ollama_server.shutdown()
            app_thread.join(timeout=2)
            ollama_thread.join(timeout=2)
            app_server.server_close()
            ollama_server.server_close()


if __name__ == "__main__":
    unittest.main()
