/**
 * Read-only guide to service pages in the owner's Income Products navigation.
 * These are NOT checkout SKUs or evidence of sales. Actual registered/built-in
 * product prices and availability come from the separate commerce catalog.
 * Never add order, lead, customer, or payment-link administration pages here.
 */
export const OWNER_SERVICE_OFFERINGS = [
  {
    name: "Website Audit",
    path: "/admin/website-audit",
    summary: "Operator workspace for reviewing a customer's website and preparing an audit.",
    availability: "Admin workflow; price and checkout availability not established by this directory.",
  },
  {
    name: "Company Reports",
    path: "/admin/executive-report",
    summary: "Operator workspace for preparing a company report.",
    availability: "Admin workflow; price and checkout availability not established by this directory.",
  },
  {
    name: "CMMC Level 1 / FCI",
    path: "/admin/cmmc",
    summary: "Self-assessment preparation workflow; not certification, an SPRS submission, or independent verification.",
    availability: "Assessment workspace; do not advertise it as a purchasable or certified result.",
  },
  {
    name: "HVAC Missed-Call Recovery",
    path: "/admin/missed-call-recovery",
    summary: "Seven-day proposal workspace for missed-call text-back, web-lead intake, follow-up, reporting and handoff.",
    availability: "Feature-gated proposal workspace; no sending, calling, integrations or payments are performed here.",
  },
  {
    name: "Smart Leads",
    path: "/admin/smart-leads",
    summary: "Lead enrichment and research-dossier service workspace.",
    availability: "Admin service workflow; this directory does not verify an active checkout or price.",
  },
  {
    name: "AI Site Review",
    path: "/audit",
    summary: "AI site review and audit offering with its own service page, distinct from the catalog's AI Task Fit assessment.",
    availability: "Consult the service page for current terms; do not assume a catalog SKU or sale.",
  },
  {
    name: "Research Report",
    path: "/admin/research-report",
    summary: "Custom AI research report service with research, synthesis and source citations.",
    availability: "Also appears in the built-in catalog; use its catalog entry for the actual SKU and price.",
  },
  {
    name: "Archive Rescue",
    path: "/archive-rescue",
    summary: "Public service offer for processing and organizing a customer's archive.",
    availability: "Public offer page; this directory does not include the private order queue or verify current pricing.",
  },
] as const;