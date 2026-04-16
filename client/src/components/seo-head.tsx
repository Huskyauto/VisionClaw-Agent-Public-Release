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
  const pName = config.platformName || "VisionClaw";

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

    return () => {
      document.title = `${pName} — ${config.platformTagline || "Agentic AI Corporation Platform"}`;
      setMeta("name", "description", "Deploy a 14-agent AI team with 186 tools. Automate research, reporting, documents, outreach, and operations. Free trial.");
      setMeta("property", "og:title", `${pName} — Your Autonomous AI Corporation`);
      setMeta("property", "og:description", "An AI team that researches, writes, builds, and delivers. 14 specialist agents, 186 tools, multi-agent orchestration, full business operations suite.");
      setMeta("property", "og:type", "website");
      setMeta("property", "og:url", window.location.origin);
      setMeta("name", "twitter:card", "summary_large_image");
      setMeta("name", "twitter:title", `${pName} — Your Autonomous AI Corporation`);
      setMeta("name", "twitter:description", "An AI team that researches, writes, builds, and delivers. 14 specialist agents, 186 tools, multi-agent orchestration, full business operations suite.");
    };
  }, [title, description, ogTitle, ogDescription, ogType, canonical, pName, config.platformTagline]);

  return null;
}
