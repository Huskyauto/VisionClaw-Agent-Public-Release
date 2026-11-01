/** An email domain is a starting URL, never proof of company ownership.
 * Research still uses the existing SSRF-safe public-site fetch boundaries. */
export function websiteFromBusinessEmail(email?: string): string | undefined {
  const domain = email?.trim().split("@")[1]?.toLowerCase();
  if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ||
      /^(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|aol|icloud|me|msn|protonmail|proton)\./.test(domain))
    return undefined;
  return `https://${domain}/`;
}
