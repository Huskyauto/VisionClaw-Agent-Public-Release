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
  const effectiveDescription = useCurrentPlatformDescription
    ? `Deploy an 18-agent AI team with 413 tools, 134 capabilities, and 155 reference surfaces. ${pName} protects account transitions, tenant analysis, commerce links, and password-reset credentials; validates database-backed skills before prompt injection; requires approval for high-risk actions; and guides every persona to disagree honestly rather than mirror unsupported beliefs.`
    : description;
  const effectiveOgDescription = useCurrentPlatformDescription
    ? "An AI team that researches, writes, builds, and delivers — with tenant-bound account, analysis, commerce, and reset protections; managed skills validated before prompt injection; human approval for high-risk actions; and honest non-sycophantic persona guidance."
    : (ogDescription || effectiveDescription);

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
      const fallback = "Deploy an 18-agent AI team that runs autonomous corporate operations end to end. Run a live Instant AI Readiness Audit at /audit — score any website /100 across AI access, structured data, metadata, social, and technical health into an A–F grade with concrete recommendations ($497 self-serve / $1,997 done-for-you). Multi-layered safety includes AHB intent gates, destructive-tool policy, crisis safeguards, strict fail-closed tenant isolation, managed skills validated on write and again before prompt injection, a hardened SSRF jail, HITL routing, deterministic deliverable pipelines, and instant-play media delivery. Live platform stats + current release notes at /trust.";
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
