export interface FelixSparkOffer {
  slug: string;
  name: string;
  promise: string;
  buyer: string;
  buyerProvides: string[];
  customerReceives: string[];
  boundaries: string[];
  proposedPrice: string;
  holdReason: string;
  nextProof: string;
}

// Owner-only planning copy. These are not catalog entries or sellable SKUs.
export const FELIX_SPARK_OFFERS: FelixSparkOffer[] = [
  {
    slug: "proof-of-work",
    name: "Proof of Work",
    promise: "Get a short, source-backed answer to one business question so you can check the evidence before making a decision.",
    buyer: "A founder or agency that needs research it can inspect and share.",
    buyerProvides: [
      "One specific research question, the intended reader, and any source documents or links to consider.",
    ],
    customerReceives: [
      "One reviewed research brief with dated source links, the main findings, and a clear list of what could not be verified.",
      "A receipt that identifies the exact delivered file and lets the buyer check its hash.",
    ],
    boundaries: [
      "This is research, not a compliance audit, certification, CMMC/NIST evidence pack, or guarantee that every source is correct.",
      "No recurring monitoring is included in a single brief.",
    ],
    proposedPrice: "$79 for one brief; $199 for three briefs used within 90 days.",
    holdReason: "The product-specific brief, exact-file receipt, intake, payment, review, and delivery path have not been proven together.",
    nextProof: "Produce one bounded non-compliance sample and verify its sources, receipt, owner review, and test delivery.",
  },
  {
    slug: "dead-lead-revival",
    name: "Dead Lead Revival",
    promise: "Turn a stale lead list into researched notes and ready-to-review messages instead of emailing people blindly.",
    buyer: "A business with old leads it is authorized to research and potentially contact.",
    buyerProvides: [
      "A small CSV with each lead's name or company and enough context to identify it; the buyer confirms it may use the list.",
    ],
    customerReceives: [
      "A returned spreadsheet with one row per accepted lead: what fresh public information was found, a source link or an explicit 'not found,' and one tailored message draft.",
      "A count of unusable rows and the agreed replacement credit or proportional refund for paid rows that cannot be researched.",
    ],
    boundaries: [
      "No contact details, decision-maker identity, or response is guaranteed.",
      "No messages are sent as part of this purchase. Any later send needs the buyer's authorization and Bob's separate approval.",
    ],
    proposedPrice: "$2 per prevalidated lead, minimum 20 ($40); $149 for 100 leads used within 90 days.",
    holdReason: "Private CSV intake, lead validation, cost limits, refund/credit handling, and the no-send boundary need product-specific tests.",
    nextProof: "Run a synthetic ten-lead sample, then test paid-count rules for 20 and 100 rows without sending anything.",
  },
  {
    slug: "while-you-slept",
    name: "While You Slept",
    promise: "See what changed overnight and the three things to handle first, in one proposed one-day brief.",
    buyer: "A local business owner who can connect the needed review and inbox sources and name competitor pages to watch.",
    buyerProvides: [
      "Permission to read the selected reviews and inbox, competitor page URLs, and the business's time zone.",
    ],
    customerReceives: [
      "One brief for the requested day covering new reviews with draft replies, competitor-page changes, inbox items needing attention, and the top three priorities.",
      "Clear 'source unavailable' notes where a connected source cannot be checked, rather than made-up activity.",
    ],
    boundaries: [
      "The brief does not post review replies, answer email, or guarantee that a third-party site reveals every change.",
      "A one-day sample has no guaranteed 6 AM delivery time. No scheduled or ongoing service is included.",
    ],
    proposedPrice: "$9 for a one-day sample. Not on sale yet.",
    holdReason: "Customer connections, one-time intake, and safe delivery have not been proven; owner review cannot support the original automatic 6 AM promise.",
    nextProof: "Produce and review a one-day sample from authorized sources, then prove safe one-time intake and delivery before offering it.",
  },
  {
    slug: "quote-second-opinion",
    name: "Quote Second Opinion",
    promise: "Compare your HVAC bids side by side before you sign, and know what to ask the contractors.",
    buyer: "A homeowner comparing a costly HVAC decision; a contractor may buy separate job reviews.",
    buyerProvides: [
      "Up to three written bids for one HVAC job, the location, and any equipment or scope details already known.",
    ],
    customerReceives: [
      "One reviewed comparison memo for that job: bid totals and included work side by side, math or missing-item questions, dated source-backed price context, and questions to ask a licensed contractor.",
    ],
    boundaries: [
      "This is a document review, not an on-site inspection, load calculation, diagnosis, fraud finding, or guarantee of a local fair price.",
      "A five-review pack covers five separate jobs, not five bids on a single job.",
    ],
    proposedPrice: "$29 per job; $119 for five separate job reviews used within 90 days.",
    holdReason: "A real three-bid sample, safe quote intake, dependable local price sources, and product-specific delivery checks still need validation.",
    nextProof: "Show a sourced three-bid HVAC sample alongside an existing paid alternative and get buyer feedback before checkout.",
  },
  {
    slug: "sop-to-agent",
    name: "SOP-to-Agent",
    promise: "Find out whether one written routine could become a safe assistant, with a written feasibility result and safe example.",
    buyer: "A business with one repeatable procedure and authority over the accounts it would use.",
    buyerProvides: [
      "One written step-by-step procedure, the systems it uses, and which actions would require approval.",
    ],
    customerReceives: [
      "For the feasibility pilot: a scoped plan, risks, and a safe example run. The pilot is not a running agent.",
    ],
    boundaries: [
      "No unlimited or indefinite operation from a one-time payment; no unsupervised messages, purchases, or other consequential actions.",
      "Procedures needing broad access or action-taking require a separate reviewed scope and quote.",
    ],
    proposedPrice: "$149 feasibility pilot; proposed credit toward a separate $399 setup for the same procedure within 30 days. Setup is not offered yet.",
    holdReason: "The feasibility pilot's intake, review, cost limits, and safe delivery are unproven. There is no validated way to run and bill an ongoing customer agent.",
    nextProof: "Demonstrate a harmless read-only example and prove safe one-time pilot delivery. Do not offer running-agent setup without a separately validated service.",
  },
];