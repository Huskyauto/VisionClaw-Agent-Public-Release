import { assertOwnerGmailConnectorProfile } from "../google-gmail-delivery-verification";

/** Owner-only legacy ingestion must use the same renewable mailbox as reports. */
export async function resolveOwnerGmailReadToken(deps: {
  owner: string;
  managed: () => Promise<string | null>;
  profile: (token: string) => Promise<{ emailAddress?: string } | null>;
  legacy: () => Promise<string | null>;
}): Promise<string | null> {
  const token = await deps.managed();
  if (!token) return deps.legacy();
  const profile = await deps.profile(token);
  if (!profile) return deps.legacy();
  assertOwnerGmailConnectorProfile(profile, deps.owner);
  return token;
}
