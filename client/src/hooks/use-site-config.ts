import { useQuery } from "@tanstack/react-query";

export interface PublicSiteConfig {
  companyName: string;
  companyLegal: string;
  websiteUrl: string;
  platformName: string;
  platformTagline: string;
  contactEmail: string;
}

const DEFAULTS: PublicSiteConfig = {
  companyName: "Your Company",
  companyLegal: "Your Company LLC",
  websiteUrl: "",
  platformName: "VisionClaw Agent",
  platformTagline: "Autonomous AI Corporation Platform",
  contactEmail: "",
};

export function useSiteConfig() {
  // R74.3 — Lower staleTime to 60s and re-enable focus refetch for this
  // single hook so SEO/meta refresh quickly when admin updates branding.
  // The global default disables focus refetch; this query opts back in
  // because the response is tiny (<1KB) and refresh latency matters.
  const { data, isLoading } = useQuery<PublicSiteConfig>({
    queryKey: ["/api/public/site-config"],
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  return { config: data || DEFAULTS, isLoading };
}
