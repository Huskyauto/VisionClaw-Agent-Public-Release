export interface AgentJourneyEvidence {
  url: string;
  excerpt: string;
}

export interface AgentJourneyCheck {
  id: "services" | "area_hours" | "pricing" | "contact_route" | "requirements";
  label: string;
  status: "observed" | "not_found" | "uncertain";
  finding: string;
  evidence: AgentJourneyEvidence[];
  nextStep: string;
}

export interface AgentJourneyResult {
  version: 1;
  method: "read_only_website_evidence";
  pages: string[];
  limitations: string[];
  checks: AgentJourneyCheck[];
}
