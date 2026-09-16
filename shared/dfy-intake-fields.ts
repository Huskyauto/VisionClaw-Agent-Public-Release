/**
 * DFY (Done-For-You, $1,997) customer intake — the online form that collects
 * everything the AI needs to build the customer's back-end fix files
 * (llms.txt, JSON-LD schema, meta tags) with REAL facts instead of blanks.
 *
 * Shared between the public form page (client/src/pages/dfy-intake.tsx) and
 * the server validator + fix-kit grounding (server/dfy-intake.ts,
 * server/audit-fix-kit.ts). The question list mirrors the "information
 * needed" items called out in the delivered AI Readiness Audit reports.
 */

export interface DfyIntakeField {
  key: string;
  label: string;
  /** Short helper shown under the input. */
  hint?: string;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
}

export interface DfyIntakeSection {
  title: string;
  description?: string;
  fields: DfyIntakeField[];
}

export const DFY_INTAKE_SECTIONS: DfyIntakeSection[] = [
  {
    title: "Business basics",
    description: "Exact, consistent contact details — AI assistants and Google both check these match everywhere.",
    fields: [
      { key: "businessName", label: "Business name (exactly as it should appear)", required: true, placeholder: "Herchenbach Mechanical Inc." },
      { key: "phone", label: "Main phone number", required: true, placeholder: "(555) 555-1234" },
      { key: "email", label: "Public contact email", placeholder: "office@company.com" },
      { key: "address", label: "Street address (or 'service-area business, no walk-ins')", required: true, placeholder: "123 Main St, Springfield, IL 62701" },
      { key: "serviceArea", label: "Service area — cities / counties you serve", required: true, multiline: true, placeholder: "Springfield, Chatham, Rochester; Sangamon County…" },
      { key: "hours", label: "Business hours", required: true, placeholder: "Mon–Fri 7am–5pm, Sat 8am–12pm" },
      { key: "emergencyService", label: "Do you offer 24/7 or emergency service? Details:", placeholder: "Yes — 24/7 emergency line, extra fee after 8pm" },
      { key: "yearsInBusiness", label: "Year founded / years in business", placeholder: "Founded 1998 (27 years)" },
    ],
  },
  {
    title: "Services & credentials",
    fields: [
      { key: "coreServices", label: "Core services (one per line)", required: true, multiline: true, placeholder: "AC repair\nFurnace installation\nMaintenance plans\nIndoor air quality\nCommercial HVAC" },
      { key: "residentialCommercial", label: "Residential, commercial, or both? Rough split?", placeholder: "Both — about 70% residential / 30% commercial" },
      { key: "brands", label: "Brands / equipment you sell or service", multiline: true, placeholder: "Carrier, Trane, Lennox…" },
      { key: "certifications", label: "Licenses, certifications, insurance, associations", multiline: true, placeholder: "IL license #055-000000, NATE-certified techs, BBB A+…" },
      { key: "financing", label: "Financing options / partners (if any)", placeholder: "0% for 18 months through Synchrony" },
    ],
  },
  {
    title: "How you want to be described",
    fields: [
      { key: "preferredDescription", label: "Describe your business in 2–4 sentences, in your own words", hint: "This becomes the summary AI assistants read first — plain language beats marketing speak.", required: true, multiline: true },
      { key: "keyPages", label: "Your most important website pages (one URL per line)", multiline: true, placeholder: "https://company.com/ac-repair\nhttps://company.com/contact" },
    ],
  },
  {
    title: "Online profiles",
    description: "Links help AI systems connect your website to your reviews and listings.",
    fields: [
      { key: "googleBusinessProfile", label: "Google Business Profile link (or 'not claimed yet')", placeholder: "https://maps.app.goo.gl/…" },
      { key: "socialLinks", label: "Other profiles — Facebook, Yelp, BBB, Instagram, LinkedIn… (one per line)", multiline: true },
      { key: "youtube", label: "YouTube channel (if any)" },
    ],
  },
  {
    title: "Customer questions & pricing",
    fields: [
      { key: "faqs", label: "The 5–10 questions customers ask most — with your answers", hint: "Format: Q: … A: … These become FAQ content AI assistants can quote directly.", required: true, multiline: true },
      { key: "pricingNotes", label: "Any prices or price ranges you're comfortable publishing", multiline: true, placeholder: "Service call $89, AC tune-up $129, new systems from $6,500…" },
    ],
  },
  {
    title: "Systems you use",
    fields: [
      { key: "crmSoftware", label: "Scheduling / CRM software (if any)", placeholder: "ServiceTitan, Housecall Pro, Jobber…" },
      { key: "bookingLink", label: "Online booking link (if customers can book online)" },
      { key: "anythingElse", label: "Anything else we should know?", multiline: true },
    ],
  },
];

export const DFY_INTAKE_FIELD_KEYS: string[] = DFY_INTAKE_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

export const DFY_INTAKE_REQUIRED_KEYS: string[] = DFY_INTAKE_SECTIONS.flatMap((s) => s.fields.filter((f) => f.required).map((f) => f.key));

/** Max characters accepted per answer (server-enforced). */
export const DFY_INTAKE_MAX_ANSWER_CHARS = 4000;

/** Human-readable label lookup used when grounding the fix-kit prompts. */
export const DFY_INTAKE_LABELS: Record<string, string> = Object.fromEntries(
  DFY_INTAKE_SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, f.label])),
);
