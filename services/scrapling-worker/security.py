"""URL and request safety policy for the Scrapling worker."""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeUrl(ValueError):
    pass


def validate_url(value: str) -> str:
    """Validate a URL before every network connection (including redirects)."""
    validate_url_and_resolve(value)
    return value


def validate_url_and_resolve(value: str) -> tuple[str, list[ipaddress.IPv4Address | ipaddress.IPv6Address]]:
    """Validate a URL and return the exact DNS answers for its next connection."""
    try:
        parsed = urlparse(value)
    except ValueError as exc:
        raise UnsafeUrl("invalid URL") from exc
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise UnsafeUrl("only credential-free HTTPS URLs are allowed")
    host = parsed.hostname.rstrip(".").lower()
    if not host or host == "localhost" or host.endswith(".localhost"):
        raise UnsafeUrl("internal destinations are not allowed")
    if host == "metadata" or host == "metadata.google.internal" or host.endswith(".internal"):
        raise UnsafeUrl("internal destinations are not allowed")
    addresses = resolve_public_addresses(host)
    if not addresses:
        raise UnsafeUrl("destination could not be resolved")
    for address in addresses:
        # IPv4-mapped IPv6 addresses must be tested as their IPv4 value too.
        candidate = getattr(address, "ipv4_mapped", None) or address
        if (
            not candidate.is_global
            or candidate.is_private
            or candidate.is_loopback
            or candidate.is_link_local
            or candidate.is_reserved
            or candidate.is_multicast
            or candidate.is_unspecified
        ):
            raise UnsafeUrl("private, link-local, loopback, or metadata destinations are not allowed")
    return value, addresses


def resolve_public_addresses(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    """Resolve once and return the addresses a transport is allowed to use.

    Callers must use this result for the connection itself.  Resolving only in
    validation and resolving again in a client library leaves a DNS rebinding
    window.
    """
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            addresses = [
                ipaddress.ip_address(item[4][0])
                for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            ]
        except (OSError, ValueError):
            raise UnsafeUrl("destination could not be resolved")
    if not addresses:
        raise UnsafeUrl("destination could not be resolved")
    return addresses
