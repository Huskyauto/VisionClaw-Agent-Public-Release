import { readFileSync } from "node:fs";

const NUMERIC_PART = "(?:0|[1-9]\\d*)";
const ROUND_PATTERN = new RegExp(
  `^R(${NUMERIC_PART}(?:(?:\\.${NUMERIC_PART})|(?:\\+${NUMERIC_PART}(?:\\.${NUMERIC_PART})*))?)(\\+sec(?:(${NUMERIC_PART}(?:-${NUMERIC_PART})*))?)?$`,
);

export function formatReleaseRound(round: string): { tag: string; packageVersion: string } {
  const match = round.match(ROUND_PATTERN);
  if (!match) throw new Error(`invalid release round: ${round}`);
  const rawCore = match[1];
  const core = rawCore.replace(/\+/g, ".");
  const coreParts = core.split(".");
  if (coreParts.length > 3) throw new Error(`release round has too many version components: ${round}`);
  if (coreParts.length > 1 && coreParts.at(-1) === "0") {
    throw new Error(`release round has a non-canonical trailing zero component: ${round}`);
  }
  while (coreParts.length < 3) coreParts.push("0");
  const hasSecuritySuffix = Boolean(match[2]);
  const suffixParts = match[3]?.split("-");
  const tagSuffix = hasSecuritySuffix ? `-sec${suffixParts?.join("-") ?? ""}` : "";
  const packageSuffix = hasSecuritySuffix ? `-sec${suffixParts?.length ? `.${suffixParts.join(".")}` : ""}` : "";
  const plusParts = rawCore.split("+");
  if (plusParts.length === 2 && !plusParts[1].includes(".")) {
    const plusSecuritySuffix = hasSecuritySuffix
      ? `.sec${suffixParts?.length ? `.${suffixParts.join(".")}` : ""}`
      : "";
    return {
      tag: `r${plusParts[0]}-plus${plusParts[1]}${tagSuffix}`,
      packageVersion: `${plusParts[0]}.0.0-plus.${plusParts[1]}${plusSecuritySuffix}`,
    };
  }
  return {
    tag: `r${core}${tagSuffix}`,
    packageVersion: `${coreParts.join(".")}${packageSuffix}`,
  };
}

export function readCurrentRelease(filePath: string): { round: string; title: string; date: string } {
  const full = readFileSync(filePath, "utf8");
  const markers = [...full.matchAll(/Current release:\s+\*\*(R[^*]+)\*\*/g)];
  const sections = [...full.matchAll(/^#{2,3} (R[^ ]+) — (.+?) \(([^)]+)\)\s*$/gm)];
  if (markers.length > 0) {
    if (markers.length !== 1) {
      throw new Error(`expected exactly one current release marker, found ${markers.length}`);
    }
    const markerRound = markers[0][1];
    formatReleaseRound(markerRound);
    const firstSection = sections[0];
    if (!firstSection || firstSection[1] !== markerRound) {
      throw new Error(`current release marker must identify the first release section: ${markerRound}`);
    }
    return { round: markerRound, title: firstSection[2], date: firstSection[3] };
  }
  const section = sections[0];
  if (!section) throw new Error("could not derive current release");
  formatReleaseRound(section[1]);
  return { round: section[1], title: section[2], date: section[3] };
}