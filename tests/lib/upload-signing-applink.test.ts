// Regression guard for the order-page appPlayLink (R125+29). server/routes.ts
// now returns a SIGNED /uploads URL that already carries ?tid&exp&sig, and
// client/src/pages/order.tsx appends a mode param (play/dl). If that param is
// appended with "?" instead of "&", the sig value is corrupted ("<sig>?play=1")
// and verifyUploadSig 401s — breaking anonymous customer app downloads. These
// tests pin the correct ("&") composition and prove the old ("?") form fails.
import { describe, it, expect } from "./_vitest-shim";

process.env.SESSION_SECRET ||= "test-secret-for-upload-signing-regression";
const { signUploadUrl, verifyUploadSig } = await import("../../server/upload-signing");

const FILE = "delivery-5-my-app.html";
const TENANT = 1;

function parse(url: string) {
  const u = new URL(url, "http://example.test");
  const filename = decodeURIComponent(u.pathname.replace(/^\/uploads\//, ""));
  return {
    filename,
    tid: Number(u.searchParams.get("tid")),
    exp: Number(u.searchParams.get("exp")),
    sig: u.searchParams.get("sig") || "",
  };
}

// Mirrors the order.tsx separator logic.
const appendMode = (url: string, mode: string) => `${url}${url.includes("?") ? "&" : "?"}${mode}`;

describe("appPlayLink signed-URL composition", () => {
  it("signUploadUrl produces a verifiable signed /uploads URL", () => {
    const url = signUploadUrl(FILE, TENANT);
    expect(url.startsWith("/uploads/")).toBe(true);
    expect(url.includes("?")).toBe(true);
    const p = parse(url);
    expect(p.sig).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyUploadSig(p.filename, p.tid, p.exp, p.sig)).toBe(true);
  });

  it("appending a mode param with '&' (the fix) keeps the sig verifiable", () => {
    const url = signUploadUrl(FILE, TENANT);
    for (const mode of ["play=1", "dl=1"]) {
      const composed = appendMode(url, mode);
      const p = parse(composed);
      expect(p.sig).toMatch(/^[a-f0-9]{64}$/);
      expect(verifyUploadSig(p.filename, p.tid, p.exp, p.sig)).toBe(true);
    }
  });

  it("the OLD '?'-append bug corrupts the sig and fails verification", () => {
    const url = signUploadUrl(FILE, TENANT);
    const buggy = `${url}?play=1`; // what order.tsx used to emit
    const p = parse(buggy);
    expect(p.sig).not.toMatch(/^[a-f0-9]{64}$/);
    expect(verifyUploadSig(p.filename, p.tid, p.exp, p.sig)).toBe(false);
  });
});
