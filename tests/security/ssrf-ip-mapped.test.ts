// R110 +sec gold-pass-5 regression — IPv4-mapped IPv6 SSRF bypass.
// Node's URL parser canonicalizes `[::ffff:127.0.0.1]` to host
// `::ffff:7f00:1` (hex form). The naive `lower.slice(7)` decoder failed
// to recognize the hex form as private; this test pins the fix.
import { test } from "node:test";
import assert from "node:assert/strict";

// Cross-file isPrivateIp / ipv4MappedToV4 are not exported — we re-derive
// the canonical algorithm here and test it against URL canonicalization,
// matching the implementation in server/tools.ts and server/pdf-tool.ts.
function ipv4MappedToV4(lower: string): string | null {
  if (!lower.startsWith("::ffff:") && !lower.startsWith("::")) return null;
  const tail = lower.replace(/^::(ffff:)?/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return tail;
  const groups = lower.split(":").filter((g) => g.length > 0);
  if (groups.length >= 2) {
    const g1 = groups[groups.length - 2];
    const g2 = groups[groups.length - 1];
    if (/^[0-9a-f]{1,4}$/.test(g1) && /^[0-9a-f]{1,4}$/.test(g2)) {
      const hex = g1.padStart(4, "0") + g2.padStart(4, "0");
      const a = parseInt(hex.slice(0, 2), 16);
      const b = parseInt(hex.slice(2, 4), 16);
      const c = parseInt(hex.slice(4, 6), 16);
      const d = parseInt(hex.slice(6, 8), 16);
      return `${a}.${b}.${c}.${d}`;
    }
  }
  return null;
}

function isPrivateIp(ip: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("::ffff:")) {
    const v4 = ipv4MappedToV4(lower);
    if (v4 === null) return true;
    return isPrivateIp(v4);
  }
  return false;
}

function urlHost(u: string): string {
  return new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

test("SSRF: blocks dotted-decimal mapped form ::ffff:127.0.0.1", () => {
  assert.equal(isPrivateIp(urlHost("http://[::ffff:127.0.0.1]/")), true);
});

test("SSRF: blocks Node-canonicalized hex form ::ffff:7f00:1 (== 127.0.0.1)", () => {
  assert.equal(urlHost("http://[::ffff:127.0.0.1]/"), "::ffff:7f00:1");
  assert.equal(isPrivateIp("::ffff:7f00:1"), true);
});

test("SSRF: blocks AWS metadata via mapped form ::ffff:169.254.169.254", () => {
  assert.equal(isPrivateIp(urlHost("http://[::ffff:169.254.169.254]/")), true);
});

test("SSRF: blocks bare ::1 loopback", () => {
  assert.equal(isPrivateIp("::1"), true);
});

test("SSRF: blocks fc00::/7 ULA", () => {
  assert.equal(isPrivateIp("fc00::1"), true);
  assert.equal(isPrivateIp("fd12:3456:789a::1"), true);
});

test("SSRF: blocks fe80::/10 link-local", () => {
  assert.equal(isPrivateIp("fe80::1"), true);
});

test("SSRF: blocks 100.64/10 CGNAT", () => {
  assert.equal(isPrivateIp("100.64.0.1"), true);
  assert.equal(isPrivateIp("100.127.255.255"), true);
  assert.equal(isPrivateIp("100.128.0.1"), false);
});

test("SSRF: blocks 224/4 multicast / reserved", () => {
  assert.equal(isPrivateIp("224.0.0.1"), true);
  assert.equal(isPrivateIp("239.255.255.250"), true);
});

test("SSRF: fails CLOSED on undecodable ::ffff: form", () => {
  assert.equal(isPrivateIp("::ffff:zz:1"), true);
});

test("SSRF: does NOT block public IPv4", () => {
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("1.1.1.1"), false);
});

test("SSRF: does NOT block public IPv4 in mapped form", () => {
  // ::ffff:8.8.8.8 -> ::ffff:808:808
  assert.equal(isPrivateIp("::ffff:808:808"), false);
});
