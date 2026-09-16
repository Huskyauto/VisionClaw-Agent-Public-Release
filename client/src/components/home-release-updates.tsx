import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import updatesData from "@/data/updates.json";

interface ReleaseEntry {
  version: string;
  title: string;
  type: string;
  highlights: { icon: string; text: string }[];
}

const RELEASE_STYLES: Record<string, { badge: string; card: string }> = {
  security: {
    badge: "bg-emerald-600",
    card: "border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent hover:border-emerald-500/50",
  },
  fix: {
    badge: "bg-amber-600",
    card: "border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent hover:border-amber-500/50",
  },
  improvement: {
    badge: "bg-violet-600",
    card: "border-violet-500/30 bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent hover:border-violet-500/50",
  },
  feature: {
    badge: "bg-cyan-600",
    card: "border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent hover:border-cyan-500/50",
  },
};

const DEFAULT_STYLE = {
  badge: "bg-sky-600",
  card: "border-sky-500/30 bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent hover:border-sky-500/50",
};

export const HOME_VISIBLE_RELEASE_COUNT = 3;
export const HOME_RELEASES = updatesData as ReleaseEntry[];

export function releaseId(version: string) {
  return `banner-whats-new-${version.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function plainText(value: string) {
  return value.replace(/\*\*/g, "").replace(/`/g, "");
}

export function ReleaseCard({ release, releaseExpanded, toggleRelease, historical = false }: {
  release: ReleaseEntry;
  releaseExpanded: Set<string>;
  toggleRelease: (id: string) => void;
  historical?: boolean;
}) {
  const id = releaseId(release.version);
  const expanded = releaseExpanded.has(id);
  const style = RELEASE_STYLES[release.type] ?? DEFAULT_STYLE;
  const detail = release.highlights.map((highlight) => plainText(highlight.text)).join(" · ");

  return (
    <button
      type="button"
      onClick={() => toggleRelease(id)}
      className={`relative w-full text-left rounded-lg border transition-colors px-4 py-3 flex items-start gap-3 ${style.card}`}
      data-testid={id}
      aria-expanded={expanded}
      aria-controls={`${id}-details`}
    >
      {historical && (
        <span className="absolute right-3 top-3 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-bold">
          Historical
        </span>
      )}
      <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-sm text-white leading-none shrink-0 mt-0.5 ${style.badge}`}>
        {release.version}
      </span>
      <span className="min-w-0 flex-1 pr-16">
        <span className={`block text-sm font-semibold leading-tight ${expanded ? "" : "line-clamp-2"}`}>
          {release.title}
        </span>
        <span id={`${id}-details`} className={`block text-xs text-muted-foreground mt-0.5 ${expanded ? "leading-relaxed" : "truncate"}`}>
          {detail}
        </span>
      </span>
      <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>
  );
}

export function HomeReleaseUpdates({ releaseExpanded, toggleRelease }: {
  releaseExpanded: Set<string>;
  toggleRelease: (id: string) => void;
}) {
  const [showAllUpdates, setShowAllUpdates] = useState(false);
  const olderReleases = HOME_RELEASES.slice(HOME_VISIBLE_RELEASE_COUNT);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowAllUpdates((visible) => !visible)}
        className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2 rounded-lg border border-border/60 hover:border-border hover:bg-muted/40 transition-colors text-xs text-muted-foreground"
        data-testid="button-toggle-all-updates"
        aria-expanded={showAllUpdates}
        aria-controls="home-older-updates"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAllUpdates ? "rotate-180" : ""}`} />
        {showAllUpdates ? "Hide older updates" : "Show older updates"}
      </button>

      <div id="home-older-updates" data-testid="home-recent-releases" className={`space-y-5 ${showAllUpdates ? "" : "hidden"}`}>
        <p className="text-xs text-muted-foreground px-1">
          Historical release archive — every card below is a release-time snapshot, not a current platform-total claim.
        </p>
        {olderReleases.map((release) => (
          <ReleaseCard
            key={release.version}
            release={release}
            releaseExpanded={releaseExpanded}
            toggleRelease={toggleRelease}
            historical
          />
        ))}
      </div>
    </>
  );
}