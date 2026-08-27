import { ChevronDown } from "lucide-react";

export function HomeReleaseArchiveRecent({ releaseExpanded, toggleRelease }: {
  releaseExpanded: Set<string>;
  toggleRelease: (id: string) => void;
}) {
  return (
    <>
    <button
      onClick={() => toggleRelease("banner-whats-new-r125_155sec8")}
      className="w-full text-left rounded-lg bg-gradient-to-r from-fuchsia-500/10 via-primary/5 to-transparent border border-fuchsia-500/30 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/15 transition-colors px-4 py-3 flex items-start gap-3"
      data-testid="banner-whats-new-r125_155sec8"
    >
      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-fuchsia-600 text-white leading-none shrink-0 mt-0.5">R125+155+sec8</span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155sec8") ? "" : "line-clamp-2"}`}>{"R125+155+sec8 — **Treasury market data now rejects corrupt provider responses instead of producing fake prices.** Yahoo chart data leads with a bounded Stooq fallback; provider verification HTML cannot masquerade as CSV. **HIGH #1:** incomplete or non-positive prices cannot create a fake `$0.00` portfolio position. **MEDIUM #1:** incomplete or inconsistent OHLC bars are rejected before cache or analysis."}</div>
        <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155sec8") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **135 declared / 230 live tables**, **679 indexes**, **41 governance rules** — 5 targeted regressions, full 233-suite run, typecheck, production build, live AAPL/MSFT/NVDA reads, and clean re-reviews."}</div>
      </div>
      <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155sec8") ? "rotate-180" : ""}`} />
    </button>
    <button
      onClick={() => toggleRelease("banner-whats-new-r125_155sec6")}
      className="w-full text-left rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors px-4 py-3 flex items-start gap-3"
      data-testid="banner-whats-new-r125_155sec6"
    >
      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+155+sec6</span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155sec6") ? "" : "line-clamp-2"}`}>{"R125+155+sec6 — **Immutable harness provenance now makes evaluations and learned runtime addenda reproducible without storing secret-bearing configuration.** Typed capture profiles reject arbitrary persisted data, tenant-matched references block cross-customer provenance links, and transactional activation preserves the prior runtime addendum if a replacement write fails."}</div>
        <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155sec6") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **135 declared / 230 live tables**, **679 indexes**, **41 governance rules** — 233-suite regression run, typecheck, production build, development database verification, and independent final review."}</div>
      </div>
      <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155sec6") ? "rotate-180" : ""}`} />
    </button>
    </>
  );
}