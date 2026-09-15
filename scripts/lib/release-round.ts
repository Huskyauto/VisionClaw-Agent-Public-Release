import { readFileSync } from "node:fs";

const ROUND_PATTERN = /^R(\d+(?:\+\d+(?:\.\d+)*)?)(\+sec(?:(\d+(?:[.-]\d+)*))?)?$/;

export function formatReleaseRound(round: string): { tag: string; packageVersion: string } {
  const match = round.match(ROUND_PATTERN);
  if (!match) throw new Error(`invalid release round: ${round}`);
  const core = match[1].replace(/\+/g, ".");
  const coreParts = core.split(".");
  if (coreParts.length > 3) throw new Error(`release round has too many version components: ${round}`);
  while (coreParts.length < 3) coreParts.push("0");
  const hasSecuritySuffix = Boolean(match[2]);
  const suffixParts = match[3]?.split(/[.-]/);
  if (suffixParts?.some((part) => !part)) throw new Error(`invalid security suffix: ${round}`);
  const tagSuffix = hasSecuritySuffix ? `-sec${suffixParts?.join("-") ?? ""}` : "";
  const packageSuffix = hasSecuritySuffix ? `-sec${suffixParts?.length ? `.${suffixParts.join(".")}` : ""}` : "";
  return {
    tag: `r${core}${tagSuffix}`,
    packageVersion: `${coreParts.join(".")}${packageSuffix}`,
  };
}

export function readCurrentRelease(filePath: string): { round: string; title: string; date: string } {
  const full = readFileSync(filePath, "utf8");
  const marker = full.match(/Current release:\s+\*\*(R[^*]+)\*\*/);
  if (marker) {
    formatReleaseRound(marker[1]);
    const escaped = marker[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const section = full.match(new RegExp(`^#{2,3} ${escaped} — (.+?) \\(([^)]+)\\)\\s*$`, "m"));
    if (!section) throw new Error(`current release marker has no matching section: ${marker[1]}`);
    return { round: marker[1], title: section[1], date: section[2] };
  }
  const section = full.match(/^#{2,3} (R[^ ]+) — (.+?) \(([^)]+)\)\s*$/m);
  if (!section) throw new Error("could not derive current release");
  formatReleaseRound(section[1]);
  return { round: section[1], title: section[2], date: section[3] };
}