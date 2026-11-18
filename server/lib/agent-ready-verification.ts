import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { load } from "cheerio";
import type { AgentReadyObservation, AgentReadyPackage } from "../../shared/agent-ready-package";

type FetchResult = { ok: true; text: string; finalUrl: string; contentType: string; truncated?: boolean }
  | { ok: false; reason: string };
type PublicFetch = (url: string) => Promise<FetchResult>;

const defaultFetch: PublicFetch = async url => {
  const { safeFetchText } = await import("../audit-engine");
  return safeFetchText(url, { timeoutMs: 7000, maxBytes: 256 * 1024, maxRedirects: 0 });
};

function jsonLdMatches(html: string, expected: Record<string, unknown>): boolean {
  const $ = load(html);
  const matches = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(matches);
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record["@graph"])) {
      return record["@graph"].some(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        return matches({ "@context": record["@context"], ...value });
      });
    }
    return Object.entries(expected).every(([key, value]) => isDeepStrictEqual(record[key], value));
  };
  return $("script[type='application/ld+json']").toArray().some(element => {
    try { return matches(JSON.parse($(element).text())); } catch { return false; }
  });
}

/** Scoped observations only: never executes page scripts or writes to the target website. */
export async function verifyAgentReadyInstallation(
  packet: AgentReadyPackage, fetchPublic: PublicFetch = defaultFetch,
): Promise<AgentReadyObservation> {
  const contents = (path: string) => {
    const file = packet.files.find(file => file.path === path);
    if (!file) throw new Error("Package file missing");
    return file.content;
  };
  const targets = [
    { id: "poppy", label: "Website-only Poppy discovery", path: "/.well-known/poppy.json", mime: "application/json",
      matches: (text: string) => isDeepStrictEqual(JSON.parse(text), JSON.parse(contents(".well-known/poppy.json"))) },
    { id: "llms", label: "Published llms.txt", path: "/llms.txt", mime: "text/plain",
      matches: (text: string) => text.replace(/\r\n/g, "\n").trim() === contents("llms.txt").trim() },
    { id: "jsonld", label: "Homepage business structured data", path: "/", mime: "text/html",
      matches: (text: string) => jsonLdMatches(text, JSON.parse(contents("structured-data.jsonld"))) },
  ];
  // Sequential: one public request at a time, no redirect amplification.
  const checks: AgentReadyObservation["checks"] = [];
  for (const target of targets) {
    const url = packet.input.website + target.path;
    let status: "pass" | "fail" | "unknown" = "unknown";
    let detail = "Could not retrieve this public resource. Check the canonical HTTPS domain and try again.";
    let sha256: string | undefined;
    try {
      const response = await fetchPublic(url);
      if (!response.ok) {
        if (response.reason === "HTTP 404" || response.reason === "HTTP 410") {
          status = "fail"; detail = "The expected public resource was not found.";
        }
      } else if (response.truncated || response.finalUrl !== url) {
        detail = "Incomplete response or a changed URL; no installation pass was recorded.";
      } else {
        sha256 = createHash("sha256").update(response.text).digest("hex");
        const mime = response.contentType.split(";")[0].trim().toLowerCase();
        if (mime !== target.mime) {
          status = "fail"; detail = `Expected ${target.mime}; the server returned another content type.`;
        } else {
          let match = false;
          try { match = target.matches(response.text); } catch { /* Invalid remote JSON is a failed comparison. */ }
          status = match ? "pass" : "fail";
          detail = match ? "Retrieved content matches this package's scoped requirements."
            : "Retrieved content does not match this package. Review existing content before making changes.";
        }
      }
    } catch {
      // Do not expose raw network errors, resolved addresses or external content.
      detail = "The public fetch failed; the installation state is unknown.";
    }
    checks.push({ id: target.id, label: target.label, status, detail, url, ...(sha256 ? { sha256 } : {}) });
  }
  return {
    packageId: packet.packageId, checkedAt: new Date().toISOString(), checks,
    limitations: [
      "Read-only observation of three public resources at the time shown; no installation, customer delivery or transaction occurred.",
      "A match is not full Poppy compliance, independent verification of business facts, an audit score or a guarantee of discovery or sales.",
      "Existing richer configurations or safely merged content may differ from this package. Review differences rather than overwrite them.",
      "Download these observations and use Quick Audit separately for the wider before/after website assessment.",
    ],
  };
}
