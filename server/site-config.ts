const env = process.env;

export const siteConfig = {
  companyName: env.SITE_COMPANY_NAME || "Your Company",
  companyLegal: env.SITE_COMPANY_LEGAL || "Your Company LLC",
  companyEin: env.SITE_COMPANY_EIN || "",
  ownerName: env.SITE_OWNER_NAME || "Admin",
  ownerEmail: env.SITE_OWNER_EMAIL || env.OWNER_ALERT_EMAIL || "",
  ownerPhone: env.SITE_OWNER_PHONE || "",
  location: env.SITE_LOCATION || "",
  state: env.SITE_STATE || "",
  websiteUrl: env.SITE_WEBSITE_URL || "",
  platformName: env.SITE_PLATFORM_NAME || "VisionClaw",
  platformTagline: env.SITE_PLATFORM_TAGLINE || "Agentic AI Corporation Platform",
  contactEmail: env.SITE_CONTACT_EMAIL || env.SITE_OWNER_EMAIL || env.OWNER_ALERT_EMAIL || "",
  agentmailInbox: env.AGENTMAIL_INBOX || "",
  agentmailUsername: env.AGENTMAIL_USERNAME || "",
  googleDriveRootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "",
  googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID || "",
  openaiOAuthClientId: env.OPENAI_OAUTH_CLIENT_ID || "",
  logoUrl: env.SITE_LOGO_URL || "",
};

export type SiteConfig = typeof siteConfig;

export function getPublicSiteConfig() {
  return {
    companyName: siteConfig.companyName,
    companyLegal: siteConfig.companyLegal,
    websiteUrl: siteConfig.websiteUrl,
    platformName: siteConfig.platformName,
    platformTagline: siteConfig.platformTagline,
    contactEmail: siteConfig.contactEmail || siteConfig.ownerEmail,
  };
}

export function getFooterText(): string {
  return `${siteConfig.companyLegal} — Confidential`;
}

export function getCoverLines(): string[] {
  const lines: string[] = [];
  if (siteConfig.companyLegal) lines.push(siteConfig.companyLegal + (siteConfig.companyEin ? ` | EIN: ${siteConfig.companyEin}` : ""));
  if (siteConfig.ownerName || siteConfig.location) {
    const parts: string[] = [];
    if (siteConfig.ownerName) parts.push(`Owner: ${siteConfig.ownerName}`);
    if (siteConfig.location) parts.push(siteConfig.location);
    if (siteConfig.ownerPhone) parts.push(siteConfig.ownerPhone);
    lines.push(parts.join(" | "));
  }
  if (siteConfig.websiteUrl) lines.push(siteConfig.websiteUrl);
  return lines;
}
