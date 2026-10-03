import facts from "../../../docs/release-facts.json";

export const CURRENT_SOURCE_RELEASE = "R135.7";
export const SOURCE_UPDATE_SUMMARY = `${CURRENT_SOURCE_RELEASE} — source updated October 3, 2026; app publication pending.`;
export const DEVELOPMENT_PLATFORM_SUMMARY =
  `${facts.metrics.registeredTools} total registered tools; ` +
  `${facts.metrics.declaredTables} declared / ${facts.metrics.liveTables} live development tables; ` +
  `${facts.metrics.platformIndexes} platform indexes (${facts.metrics.nonPrimaryKeyIndexes} non-PK); ` +
  `${facts.metrics.activeCapabilities} capabilities; ${facts.metrics.totalSkills} platform skills; ` +
  `${facts.metrics.activePersonas} personas; ${facts.metrics.coreRegistryModels} curated models; ` +
  `${facts.metrics.governanceRules} governance rules. Development evidence, not production telemetry.`;
export const CURRENT_PLATFORM_DESCRIPTION =
  `${SOURCE_UPDATE_SUMMARY} ${DEVELOPMENT_PLATFORM_SUMMARY} ` +
  "Recent source changes strengthen tenant/file privacy, memory efficiency, public-chat limits, " +
  "durable recovery and owner diagnostics. Production verification and aggregate budget enforcement remain incomplete.";

export function PrepublicationNotice({ mode }: { mode: "business" | "technical" }) {
  return (
    <aside className="border-b border-border bg-muted/50 px-6 py-3 text-sm" data-testid="prepublication-notice">
      <div className="mx-auto max-w-6xl">
        <p className="font-medium">{SOURCE_UPDATE_SUMMARY}</p>
        <p className="text-muted-foreground">
          {mode === "business"
            ? "Prepared improvements: stronger customer-file privacy, leaner memory work and more reliable recovery. These changes are not yet published to the hosted app."
            : "Development snapshot: tenant-scoped Drive/upload boundaries, bound recovery tool rosters, atomic public-chat admissions and bounded verifier diagnostics. Production completion is not yet proven."}
          {" "}<a href="/updates" className="underline underline-offset-4">Changes and readiness limits</a>
        </p>
      </div>
    </aside>
  );
}