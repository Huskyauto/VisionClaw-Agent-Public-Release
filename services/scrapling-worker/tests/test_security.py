import socket

import pytest

from security import UnsafeUrl, validate_url


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com",
        "https://localhost",
        "https://127.0.0.1",
        "https://[::1]/",
        "https://169.254.169.254/latest",
        "https://metadata.google.internal/",
        "https://user:pass@example.com/",
    ],
)
def test_unsafe_destinations_are_rejected(url):
    with pytest.raises(UnsafeUrl):
        validate_url(url)


def test_public_https_is_allowed(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))],
    )
    assert validate_url("https://example.test/path") == "https://example.test/path"


def test_mapped_ipv6_is_rejected(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::ffff:127.0.0.1", 443, 0, 0))],
    )
    with pytest.raises(UnsafeUrl):
        validate_url("https://mapped.example.test/")