import { useEffect } from "react";
import { useSiteConfig } from "@/hooks/use-site-config";

interface SeoHeadProps {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  canonical?: string;
  useCurrentPlatformDescription?: boolean;
}

export function SeoHead({
  title,
  description,
  ogTitle,
  ogDescription,
  ogType = "website",
  canonical,
  useCurrentPlatformDescription = false,
}: SeoHeadProps) {
  const { config } = useSiteConfig();
  const pName = config.platformName || "VisionClaw Agent";
  const currentDescription = description.replace(/\b(?:413|414|415|416|417) tools\b/g, "418 total registered tools");
  const currentOgDescription = ogDescription?.replace(/\b(?:413|414|415|416|417) tools\b/g, "418 total registered tools");
  const effectiveDescription = useCurrentPlatformDescription
    ? `R130.4+sec adds automatic TypeSafe Jev quality receipts after eligible jury verdicts and successful premium deliverable sections, with strict sensitive-data egress protection. The bounded, report-only signal covers evidence support, goal coverage, and human-review need without changing verdicts, selected text, or existing controls. Current platform: 418 tools, 177 declared / 255 live tables, 806 live indexes (557 non-PK), 137 capabilities, 68 total platform skills, 107 reference surfaces, 18 personas, 41 governance rules.`
    : currentDescription;
  const effectiveOgDescription = useCurrentPlatformDescription
    ? "R130.4+sec adds protected, bounded automatic TypeSafe quality receipts without changing jury or premium deliverable outcomes."
    : (currentOgDescription || effectiveDescription);

  useEffect(() => {
    const fullTitle = title.includes(pName) ? title : `${title} | ${pName}`;
    document.title = fullTitle;

    const setMeta = (attr: string, key: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("name", "description", effectiveDescription);
    setMeta("property", "og:title", ogTitle || fullTitle);
    setMeta("property", "og:description", effectiveOgDescription);
    setMeta("property", "og:type", ogType);
    setMeta("property", "og:url", canonical || window.location.href);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", ogTitle || fullTitle);
    setMeta("name", "twitter:description", effectiveOgDescription);

    let linkEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (canonical) {
      if (!linkEl) {
        linkEl = document.createElement("link");
        linkEl.setAttribute("rel", "canonical");
        document.head.appendChild(linkEl);
      }
      linkEl.setAttribute("href", canonical);
    } else if (linkEl) {
      linkEl.remove();
    }

    // R125+13.3+sec (architect MEDIUM closed 2026-05-24): cleanup fallbacks no
    // longer carry the full release-log dump — they were stale within hours of
    // every R-round and contradicted /trust live counts. Concise current-only
    // copy; the live R-log lives in replit.md + docs/release-log-archive.md.
    return () => {
      document.title = `${pName} — ${config.platformTagline || "Autonomous AI Corporation Platform"}`;
      // R125+13.16+sec — architect HIGH: keep cleanup fallback release-agnostic.
      // Any release-specific R-tag in here drifts within hours of every round
      // and rewrites itself on every SPA unmount. Live counts + release notes
      // are surfaced through /trust and /api/public/trust.
      const fallback = "Deploy an 18-agent AI team with strict tenant isolation and bounded attached-file review recovery that prevents promise-only responses from ending the turn. Live platform stats and current release notes are at /trust.";
      setMeta("name", "description", fallback);
      setMeta("property", "og:title", `${pName} — Your Autonomous AI Corporation`);
      setMeta("property", "og:description", fallback);
      setMeta("property", "og:type", "website");
      setMeta("property", "og:url", window.location.origin);
      setMeta("name", "twitter:card", "summary_large_image");
      setMeta("name", "twitter:title", `${pName} — Your Autonomous AI Corporation`);
      setMeta("name", "twitter:description", "18 specialist AI agents running autonomous corporate operations. Run a live Instant AI Readiness Audit at /audit.");
      // R125+13.7 (architect LOW closed): remove the canonical link on unmount.
      // Without this, a page that set <link rel="canonical" href="/audit"> would
      // leave it on the document during SPA navigation to a page that does NOT
      // pass a canonical prop, causing Google to attribute the new page to /audit.
      const staleCanonical = document.querySelector('link[rel="canonical"]');
      if (staleCanonical) staleCanonical.remove();
    };
  }, [title, effectiveDescription, effectiveOgDescription, ogTitle, ogType, canonical, pName, config.platformTagline]);

  return null;
}
