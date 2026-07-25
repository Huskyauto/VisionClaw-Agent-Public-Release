import { useEffect } from "react";
import { useSiteConfig } from "@/hooks/use-site-config";

interface SeoHeadProps {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  canonical?: string;
}

export function SeoHead({
  title,
  description,
  ogTitle,
  ogDescription,
  ogType = "website",
  canonical,
}: SeoHeadProps) {
  const { config } = useSiteConfig();
  const pName = config.platformName || "VisionClaw Agent";

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

    setMeta("name", "description", description);
    setMeta("property", "og:title", ogTitle || fullTitle);
    setMeta("property", "og:description", ogDescription || description);
    setMeta("property", "og:type", ogType);
    setMeta("property", "og:url", canonical || window.location.href);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", ogTitle || fullTitle);
    setMeta("name", "twitter:description", ogDescription || description);

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
      const fallback = "Deploy a 16-agent AI team that runs autonomous corporate operations end to end. Run a live Instant AI Readiness Audit at /audit — score any website /100 across AI access, structured data, metadata, social, and technical health into an A–F grade with concrete recommendations ($497 self-serve / $1,997 done-for-you). Multi-layered safety (AHB intent gates + destructive-tool policy + crisis safety guard), strict per-tenant isolation that fails closed, a hardened SSRF jail on every outbound fetch, MoA jury concordance for HITL routing, deterministic deliverable pipelines, instant-play media delivery. Live platform stats + current release notes at /trust.";
      setMeta("name", "description", fallback);
      setMeta("property", "og:title", `${pName} — Your Autonomous AI Corporation`);
      setMeta("property", "og:description", fallback);
      setMeta("property", "og:type", "website");
      setMeta("property", "og:url", window.location.origin);
      setMeta("name", "twitter:card", "summary_large_image");
      setMeta("name", "twitter:title", `${pName} — Your Autonomous AI Corporation`);
      setMeta("name", "twitter:description", "16 specialist AI agents running autonomous corporate operations. Run a live Instant AI Readiness Audit at /audit.");
      // R125+13.7 (architect LOW closed): remove the canonical link on unmount.
      // Without this, a page that set <link rel="canonical" href="/audit"> would
      // leave it on the document during SPA navigation to a page that does NOT
      // pass a canonical prop, causing Google to attribute the new page to /audit.
      const staleCanonical = document.querySelector('link[rel="canonical"]');
      if (staleCanonical) staleCanonical.remove();
    };
  }, [title, description, ogTitle, ogDescription, ogType, canonical, pName, config.platformTagline]);

  return null;
}
