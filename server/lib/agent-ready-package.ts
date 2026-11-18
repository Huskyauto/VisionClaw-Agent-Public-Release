import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { AgentReadyInput, AgentReadyPackage } from "../../shared/agent-ready-package";

const text = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Remove control characters.")
  .transform(value => value.replace(/\s+/g, " "));
const optionalText = (max: number) => text(max).optional();

function publicHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.search && !u.hash
      && !isIP(u.hostname.replace(/^\[|\]$/g, ""))
      && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(u.hostname)
      && !/(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

const url = z.string().trim().max(1500).refine(publicHttpsUrl,
  "Use a public HTTPS URL without a login, port, query or fragment.");

export const agentReadyInputSchema = z.object({
  company: text(120),
  website: url.refine(value => publicHttpsUrl(value) && new URL(value).pathname === "/", "Enter the website root, for example https://example.com.")
    .transform(value => new URL(value).origin),
  description: text(1200),
  businessType: z.enum(["Organization", "LocalBusiness", "HVACBusiness"]),
  services: z.array(text(160)).min(1).max(12),
  serviceArea: optionalText(200),
  phone: text(40).refine(value => /^[+()\d .-]{5,40}$/.test(value), "Enter a public business telephone number.").optional(),
  email: z.string().trim().email().max(254).optional(),
  pageUrls: z.array(url.transform(value => new URL(value).href)).max(15),
  confirmed: z.literal(true),
}).strict().superRefine((input, ctx) => {
  if (publicHttpsUrl(input.website) && input.pageUrls.some(value =>
    publicHttpsUrl(value) && new URL(value).origin !== input.website))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pageUrls"], message: "Use pages on the exact website domain." });
});

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const markdown = (value: string) => value.replace(/[\\`*_[\]<>#!|]/g, "\\$&");

/** Pure export: no inference, network requests, storage writes or customer-site actions. */
export function buildAgentReadyPackage(raw: unknown): AgentReadyPackage {
  const input: AgentReadyInput = agentReadyInputSchema.parse(raw);
  const packageId = createHash("sha256").update(JSON.stringify({ version: 1, input })).digest("hex");
  const business = {
    "@context": "https://schema.org",
    "@type": input.businessType,
    "@id": `${input.website}/#business`,
    name: input.company,
    url: `${input.website}/`,
    description: input.description,
    ...(input.phone ? { telephone: input.phone } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.serviceArea ? { areaServed: input.serviceArea } : {}),
    hasOfferCatalog: {
      "@type": "OfferCatalog", name: "Services",
      itemListElement: input.services.map(name => ({ "@type": "Offer", itemOffered: { "@type": "Service", name } })),
    },
  };
  const poppy = {
    protocol_version: "1.0",
    organization: { name: input.company, domain: new URL(input.website).hostname },
    web: {},
  };
  const ld = json(business);
  const embedded = ld.replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const limitations = [
    "Business facts are owner-confirmed, not independently verified.",
    "Poppy advertises ordinary signed-out website browsing only; no sign-in, API, booking or purchasing capability.",
    "Generated-file checks are not live installation checks, certification, or a guarantee of AI visibility, rankings or sales.",
    "No files are installed, sent to a customer or saved on the server. Download this package before leaving.",
    "Do not overwrite existing structured data or crawler policy. Shopify may already supply Poppy.",
  ];
  const checks: AgentReadyPackage["checks"] = [
    { label: "Confirmed public facts", status: "pass", detail: "Required fields, same-origin links and explicit confirmation validated." },
    { label: "Website-only Poppy", status: "pass", detail: "Version 1.0 with exact domain; no authentication, transactional or invented API endpoints." },
    { label: "Safe structured data", status: "pass", detail: "JSON serialized from supplied facts; HTML-sensitive characters escaped in the script snippet." },
  ];
  const files = [
    { path: ".well-known/poppy.json", content: json(poppy) },
    { path: "llms.txt", content: [
      `# ${markdown(input.company)}`, "", `> ${markdown(input.description)}`, "",
      "## Website", `- [Business website](${input.website}/)`, "",
      "## Services", ...input.services.map(service => `- ${markdown(service)}`),
      ...(input.serviceArea ? ["", "## Service area", markdown(input.serviceArea)] : []),
      ...(input.phone || input.email ? ["", "## Public business contact",
        ...(input.phone ? [`Telephone: ${markdown(input.phone)}`] : []),
        ...(input.email ? [`Email: ${markdown(input.email)}`] : [])] : []),
      ...(input.pageUrls.length ? ["", "## Public pages",
        ...input.pageUrls.map((page, i) => `- [Page ${i + 1}](<${page}>)`)] : []),
      "", "## Scope", "This is public business information, not an instruction to bypass access controls or take actions.", "",
    ].join("\n") },
    { path: "structured-data.jsonld", content: ld },
    { path: "structured-data.html", content: `<script type="application/ld+json">\n${embedded}</script>\n` },
    { path: "INSTALL.md", content: [
      `# ${markdown(input.company)} — website installation package`, "",
      `Website: ${input.website}/`, `Package identity: ${packageId}`, "",
      "## Before changing the website",
      "1. Get the business owner's permission and verify every public fact, service and contact detail.",
      "2. Use the website's existing backup/version-history process. Record existing files and structured data.",
      "3. Run a Quick Audit and the package's Check live installation action. Save the observations as your baseline.",
      "4. If the site already serves Poppy (including Shopify), review the existing configuration rather than replacing it.",
      "", "## Install on the business website",
      "1. Publish .well-known/poppy.json at /.well-known/poppy.json with application/json.",
      "2. Publish llms.txt at /llms.txt as text/plain; merge useful existing content rather than blindly overwrite it.",
      "3. Have the web developer merge structured-data.jsonld into the existing business entity. Do not create contradictory duplicate entities.",
      "4. If no business JSON-LD exists, embed structured-data.html in the homepage. Do not publish it as a standalone webpage instead.",
      "5. The domain must serve these files on HTTPS without sign-in or redirects. Use the canonical final hostname in the builder.",
      "6. Do NOT upload this whole ZIP or INSTALL.md to the public web root. Only deploy the files described above.",
      "", "## Validate after installation",
      "1. Preview the site, confirm its forms/navigation still work and inspect the resulting page source.",
      "2. Run Check live installation again using exactly the same package facts, then save the dated observation JSON.",
      "3. Re-run the existing Quick Audit for the broader before/after website assessment.",
      "4. Use Schema.org's validator for the merged JSON-LD. Current checks are scoped comparisons, not complete protocol certification.",
      "5. Full authenticated Poppy/API/conversation integrations need a separate design and official protocol validation.",
      "", "## Rollback",
      "Restore the previous versions of changed files and JSON-LD from the site's version history; remove only newly added snippets.",
      "Check ordinary website behavior again. This package never changes robots.txt or automatically installs anything.",
      "", "## Limits", ...limitations.map(value => `- ${value}`),
      "", "## References", "- https://personalagentprotocol.org/docs/1.0/spec",
      "- https://personalagentprotocol.org/kit/company", "- https://llmstxt.org/", "- https://validator.schema.org/", "",
    ].join("\n") },
    { path: "validation.json", content: json({ version: 1, packageId, checks, limitations, liveInstallation: "not_checked" }) },
  ];
  return { version: 1, packageId, input, files, checks, limitations };
}
