import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedIpReason } from "../../server/lib/ssrf-jail";
import { isPrivateIp } from "../../server/tools/lib/safe-fetch";
// ipaddr.js ships no type declarations; tests are excluded from tsc so the
// untyped import is fine. It is the oracle we cross-validate the hand-rolled
// byte classifier against.
// @ts-ignore
import ipaddr from "ipaddr.js";

// --- Curated regression table -------------------------------------------------
// The actual vuln: Node HEX-normalizes IPv4-mapped IPv6 in URL.hostname
// (`[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`), so the old dotted-`::ffff:` regex
// was dead code and the hex form reached loopback/private hosts.
const MUST_BLOCK: string[] = [
  // IPv4 private / reserved
  "127.0.0.1", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.1",
  "192.168.0.1", "169.254.169.254", "100.64.0.1", "100.127.255.1",
  "0.0.0.0", "0.1.2.3", "198.18.0.1", "198.19.255.1",
  "224.0.0.1", "239.255.255.255", "255.255.255.255",
  // IPv6 private / reserved
  "::1", "::", "fe80::1", "fe90::1", "fea0::1", "febf::1",
  "fc00::1", "fd12:3456:789a::1", "ff02::1", "ff00::1",
  // IPv4-mapped IPv6 — both dotted AND the Node-normalized hex form
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a00:1",
  "::ffff:192.168.1.1", "::ffff:169.254.169.254",
  // Representation variants: mixed case, uppercase, alternate :: placement,
  // leading-zero hextets, full-form, embedded dotted v4 mid-string.
  "FE80::1", "Fe80::1", "::FFFF:7F00:1", "::ffFF:127.0.0.1",
  "fc00:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:1", "fd00::dead:BEEF",
  "::ffff:0a00:0001", "0:0:0:0:0:ffff:127.0.0.1",
];

const MUST_ALLOW: string[] = [
  "8.8.8.8", "1.1.1.1", "93.184.216.34", "203.0.114.1",
  "2606:4700:4700::1111", "2001:4860:4860::8888", "2620:fe::fe",
  "::ffff:8.8.8.8", "::ffff:1.1.1.1",            // v4-mapped PUBLIC must still pass
];

test("blockedIpReason: blocks all private/reserved/IPv4-mapped literals", () => {
  for (const ip of MUST_BLOCK) {
    assert.notEqual(blockedIpReason(ip), null, `expected ${ip} to be BLOCKED`);
  }
});

test("blockedIpReason: allows public unicast (v4, v6, v4-mapped-public)", () => {
  for (const ip of MUST_ALLOW) {
    assert.equal(blockedIpReason(ip), null, `expected ${ip} to be ALLOWED (got: ${blockedIpReason(ip)})`);
  }
});

test("blockedIpReason: non-IP strings are not treated as IPs (→ DNS path)", () => {
  for (const s of ["example.com", "not-an-ip", "", "12345", "1.2.3", "g::1", "10.0.0.256"]) {
    assert.equal(blockedIpReason(s), null, `expected ${s} to be passed through (null)`);
  }
});

// --- Cross-validation against ipaddr.js ---------------------------------------
// ipaddr.js range categories that are unambiguously NOT publicly routable and
// MUST be blocked by our classifier. (Documentation/benchmark "reserved" ranges
// and exotic v6 transition ranges like 6to4/teredo/nat64 are intentionally
// out-of-scope — they are not internal-network SSRF targets — so we only assert
// agreement on the security-critical categories below, plus "unicast" = allow.)
const ORACLE_MUST_BLOCK = new Set([
  "private", "loopback", "linkLocal", "carrierGradeNat",
  "multicast", "broadcast", "unspecified", "uniqueLocal",
]);

// Ranges OUR classifier blocks on purpose even though ipaddr.js has no
// category for them (reads them as "unicast"). Being stricter is safe;
// exempt these declared reasons from the unicast-must-allow assertion.
// Pinned to the exact reason string (not a loose keyword) so a future
// unrelated block reason can't silently ride the exemption.
const DELIBERATELY_STRICTER = /^(?:IPv4-mapped → )?198\.18\/15 \(benchmark\)$/;

function oracleRange(ip: string): string {
  let a = ipaddr.parse(ip);
  if (a.kind() === "ipv6" && a.isIPv4MappedAddress && a.isIPv4MappedAddress()) {
    a = a.toIPv4Address();
  }
  return a.range();
}

function randByte() { return Math.floor(Math.random() * 256); }
function randHextet() { return Math.floor(Math.random() * 0x10000).toString(16); }

test("blockedIpReason agrees with ipaddr.js on security-critical ranges (IPv4 fuzz)", () => {
  for (let i = 0; i < 5000; i++) {
    const ip = `${randByte()}.${randByte()}.${randByte()}.${randByte()}`;
    const range = oracleRange(ip);
    const reason = blockedIpReason(ip);
    const mine = reason !== null;
    if (range === "unicast") {
      // Our classifier is DELIBERATELY stricter than ipaddr.js in places it
      // has no category for (e.g. RFC 2544 benchmark 198.18/15 reads as
      // "unicast" to ipaddr.js). Extra strictness is fail-closed-safe — only
      // flag when we block a genuinely public IP for no declared reason.
      if (mine && DELIBERATELY_STRICTER.test(reason!)) continue;
      assert.equal(mine, false, `${ip}: ipaddr=unicast but classifier BLOCKED (${reason})`);
    } else if (ORACLE_MUST_BLOCK.has(range)) {
      assert.equal(mine, true, `${ip}: ipaddr=${range} but classifier ALLOWED`);
    }
    // other ranges (e.g. "reserved" doc nets) → no assertion
  }
});

test("blockedIpReason agrees with ipaddr.js on security-critical ranges (IPv6 fuzz)", () => {
  // Generate across our handled prefixes + global unicast so the fuzz actually
  // exercises both block and allow paths.
  const prefixes = ["2606", "2001", "2620", "fe80", "fe90", "feb0", "fc00", "fd00", "ff02", "::ffff"];
  for (let i = 0; i < 5000; i++) {
    const p = prefixes[i % prefixes.length];
    let ip: string;
    if (p === "::ffff") {
      ip = `::ffff:${randByte()}.${randByte()}.${randByte()}.${randByte()}`;
    } else {
      ip = `${p}:${randHextet()}:${randHextet()}::${randHextet()}`;
    }
    let range: string;
    try { range = oracleRange(ip); } catch { continue; }
    const reason = blockedIpReason(ip);
    const mine = reason !== null;
    if (range === "unicast") {
      if (mine && DELIBERATELY_STRICTER.test(reason!)) continue;
      assert.equal(mine, false, `${ip}: ipaddr=unicast but classifier BLOCKED (${reason})`);
    } else if (ORACLE_MUST_BLOCK.has(range)) {
      assert.equal(mine, true, `${ip}: ipaddr=${range} but classifier ALLOWED`);
    }
  }
});

// --- safe-fetch isPrivateIp coverage (server/tools/lib/safe-fetch.ts) ---------
// The tools-layer split (S9) extracted safe-fetch as a shared web/browser
// helper with its OWN prefix-based IPv6 classifier, separate from ssrf-jail's
// byte classifier. It receives CANONICAL literal IPs (Node's URL parser +
// dns.lookup both compress/normalize before it sees them), so we assert on
// canonical forms. Regression anchor: `isPrivateIp` used to block only the
// `fe80:` prefix, missing the rest of fe80::/10 (fe90/fea0/febf) and all of
// ff00::/8 multicast — this table pins that hole shut.
const SF_MUST_BLOCK: string[] = [
  // IPv4 private / reserved
  "127.0.0.1", "10.0.0.1", "172.16.0.1", "172.31.255.1", "192.168.0.1",
  "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
  // IPv6 loopback / unspecified
  "::1", "::",
  // IPv6 link-local fe80::/10 — the regression range (fe80 was the only one caught before)
  "fe80::1", "fe90::1", "fea0::1", "febf::1",
  // IPv6 ULA + multicast
  "fc00::1", "fd12:3456:789a::1", "ff02::1", "ff00::1",
  // IPv4-mapped IPv6, dotted + Node hex form
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1",
  "::ffff:192.168.1.1", "::ffff:169.254.169.254",
];

const SF_MUST_ALLOW: string[] = [
  "8.8.8.8", "1.1.1.1", "93.184.216.34",
  "2606:4700:4700::1111", "2001:4860:4860::8888", "2620:fe::fe",
  "::ffff:8.8.8.8", "::ffff:1.1.1.1",
];

test("safe-fetch isPrivateIp: blocks private/reserved (incl. full fe80::/10 + ff00::/8)", () => {
  for (const ip of SF_MUST_BLOCK) {
    assert.equal(isPrivateIp(ip), true, `expected ${ip} to be PRIVATE`);
  }
});

test("safe-fetch isPrivateIp: allows public unicast (v4, v6, v4-mapped-public)", () => {
  for (const ip of SF_MUST_ALLOW) {
    assert.equal(isPrivateIp(ip), false, `expected ${ip} to be PUBLIC`);
  }
});
