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
  platformName: "VisionClaw",
  platformTagline: "Agentic AI Corporation Platform",
  contactEmail: "",
};

export function useSiteConfig() {
  const { data, isLoading } = useQuery<PublicSiteConfig>({
    queryKey: ["/api/public/site-config"],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return { config: data || DEFAULTS, isLoading };
}
