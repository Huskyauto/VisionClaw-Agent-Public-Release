import sys
import ipaddress
import socket
import time
import types
import unittest
from pathlib import Path
from unittest.mock import ANY, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fetcher import FetchFailure, _fetch_impl, _fetch_process_entry, _pinned_get, _run_fetch_isolated, fetch


class _Node:
    text = "Example"


class _Page:
    url = "https://example.com/"
    status = 200
    headers = {}
    body = b"<title>Example</title><p>Hello</p>"

    def css_first(self, _selector):
        return _Node()

    def get_all_text(self, **_kwargs):
        return "Hello"


class _Socket:
    def settimeout(self, _timeout):
        pass

    def sendall(self, _payload):
        pass

    def close(self):
        pass


class _Context:
    def wrap_socket(self, sock, server_hostname=None):
        return sock


class _Selector:
    def __init__(self, **_kwargs):
        pass

    def css(self, _selector):
        return types.SimpleNamespace(first=None)

    def get_all_text(self, **_kwargs):
        return ""


class _HttpResponse:
    status = 200
    headers = {}

    def __init__(self, _sock, method=None, chunks=None):
        self.chunks = list(chunks or [b""])

    def begin(self):
        pass

    def read(self, _size):
        return self.chunks.pop(0) if self.chunks else b""


def _large_result_entry(pipe, _args):
    pipe.send(("ok", {
        "source_url": "https://example.com/",
        "final_url": "https://example.com/",
        "status": 200,
        "title": "Large",
        "text": "x" * 100_000,
        "elapsed_ms": 1,
    }))
    pipe.close()


class FetcherModeTests(unittest.TestCase):
    def test_child_logs_root_cause_type_without_request_values(self):
        pipe = unittest.mock.Mock()
        failure = FetchFailure("upstream extraction failed", 502)
        failure.__cause__ = AttributeError("sensitive request value")
        with (
            patch("fetcher._fetch_impl", side_effect=failure),
            patch("fetcher.logger.error") as log_error,
        ):
            _fetch_process_entry(pipe, ())
        log_error.assert_called_once_with(
            "Scrapling child fetch failed: status=%s cause=%s",
            502,
            "AttributeError",
        )
        pipe.send.assert_called_once_with(("failure", "upstream extraction failed", 502, None))

    def test_child_logs_unexpected_exception_type_without_request_values(self):
        pipe = unittest.mock.Mock()
        with (
            patch("fetcher._fetch_impl", side_effect=AttributeError("sensitive request value")),
            patch("fetcher.logger.error") as log_error,
        ):
            _fetch_process_entry(pipe, ())
        log_error.assert_called_once_with(
            "Unexpected Scrapling child failure: cause=%s",
            "AttributeError",
        )
        pipe.send.assert_called_once_with(("failure", "upstream extraction failed", 502, None))

    @patch("fetcher._pinned_get", return_value=_Page())
    def test_static_uses_pinned_transport(self, pinned_get):
        result = _fetch_impl("https://example.com/", "static", 1, 1024, 1024, 2)
        self.assertEqual(result.status, 200)
        self.assertEqual(result.text, "Hello")
        pinned_get.assert_called_once()
        self.assertEqual(pinned_get.call_args.args[0], "https://example.com/")
        self.assertEqual(pinned_get.call_args.args[2], 1024)

    def test_unexposed_browser_modes_fail_closed(self):
        for mode in ("dynamic", "stealth"):
            with self.assertRaisesRegex(FetchFailure, "unknown mode"):
                _fetch_impl("https://example.com/", mode, 1, 1024, 1024, 2)

    def test_pinned_transport_uses_explicit_https_port(self):
        scrapling_module = types.ModuleType("scrapling")
        scrapling_module.Selector = _Selector
        sock = _Socket()
        with (
            patch.dict(sys.modules, {"scrapling": scrapling_module}),
            patch("fetcher.socket.create_connection", return_value=sock) as connect,
            patch("fetcher.ssl.create_default_context", return_value=_Context()),
            patch("fetcher.http.client.HTTPResponse", _HttpResponse),
        ):
            _pinned_get(
                "https://example.com:8443/path",
                time.monotonic() + 1,
                1024,
                [ipaddress.ip_address("93.184.216.34")],
            )
        connect.assert_called_once_with(("93.184.216.34", 8443), timeout=ANY)

    def test_pinned_transport_aborts_oversized_chunked_body(self):
        class OversizedResponse(_HttpResponse):
            def read(self, size):
                return b"x" * size

        with (
            patch("fetcher.socket.create_connection", return_value=_Socket()),
            patch("fetcher.ssl.create_default_context", return_value=_Context()),
            patch("fetcher.http.client.HTTPResponse", OversizedResponse),
        ):
            with self.assertRaisesRegex(FetchFailure, "exceeds limit"):
                _pinned_get(
                    "https://example.com/",
                    time.monotonic() + 1,
                    16,
                    [ipaddress.ip_address("93.184.216.34")],
                )

    @patch("fetcher.validate_url_and_resolve", return_value=("https://example.com/", [ipaddress.ip_address("93.184.216.34")]))
    @patch("fetcher._pinned_get")
    def test_cross_host_redirect_is_denied_before_second_connection(self, pinned_get, _resolve):
        redirect = _Page()
        redirect.status = 302
        redirect.headers = {"location": "https://other.example/private"}
        pinned_get.return_value = redirect
        with self.assertRaisesRegex(FetchFailure, "cross-host redirects"):
            _fetch_impl("https://example.com/", "static", 1, 1024, 1024, 2)
        self.assertEqual(pinned_get.call_count, 1)

    @patch("fetcher.validate_url_and_resolve", return_value=("https://example.com/", [ipaddress.ip_address("93.184.216.34")]))
    @patch("fetcher._pinned_get")
    def test_redirect_chain_reuses_one_absolute_deadline(self, pinned_get, _resolve):
        redirect = _Page()
        redirect.status = 302
        redirect.headers = {"location": "https://example.com:443/final"}
        final = _Page()
        final.url = "https://example.com:443/final"
        pinned_get.side_effect = [redirect, final]
        result = _fetch_impl("https://example.com/", "static", 1, 1024, 1024, 2)
        self.assertEqual(result.status, 200)
        self.assertEqual(pinned_get.call_count, 2)
        self.assertEqual(pinned_get.call_args_list[0].args[1], pinned_get.call_args_list[1].args[1])

    @patch("fetcher.validate_url_and_resolve", return_value=("https://example.com/", [ipaddress.ip_address("93.184.216.34")]))
    @patch("fetcher._pinned_get")
    def test_retry_after_is_preserved_exactly(self, pinned_get, _resolve):
        limited = _Page()
        limited.status = 429
        limited.headers = {"retry-after": "Wed, 21 Oct 2030 07:28:00 GMT"}
        pinned_get.return_value = limited
        with self.assertRaises(FetchFailure) as caught:
            _fetch_impl("https://example.com/", "static", 1, 1024, 1024, 2)
        self.assertEqual(caught.exception.status, 429)
        self.assertEqual(caught.exception.retry_after, "Wed, 21 Oct 2030 07:28:00 GMT")

    def test_parent_process_enforces_hard_wall_clock_deadline(self):
        started = time.monotonic()
        with self.assertRaises(FetchFailure) as caught:
            fetch("https://example.com/", "static", 0.01, 1024, 1024, 2)
        self.assertEqual(caught.exception.status, 504)
        self.assertLess(time.monotonic() - started, 0.25)

    def test_parent_drains_near_limit_payload_before_child_exit(self):
        result = _run_fetch_isolated((), 1, context_name="fork", entry=_large_result_entry)
        self.assertEqual(result.status, 200)
        self.assertEqual(len(result.text), 100_000)


if __name__ == "__main__":
    unittest.main()