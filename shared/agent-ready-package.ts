export interface AgentReadyInput {
  company: string;
  website: string;
  description: string;
  businessType: "Organization" | "LocalBusiness" | "HVACBusiness";
  services: string[];
  serviceArea?: string;
  phone?: string;
  email?: string;
  pageUrls: string[];
  confirmed: true;
}

export interface AgentReadyFile {
  path: string;
  content: string;
}

export interface AgentReadyPackage {
  version: 1;
  packageId: string;
  input: AgentReadyInput;
  files: AgentReadyFile[];
  checks: { label: string; status: "pass"; detail: string }[];
  limitations: string[];
}

export interface AgentReadyObservation {
  packageId: string;
  checkedAt: string;
  checks: {
    id: string;
    label: string;
    status: "pass" | "fail" | "unknown";
    detail: string;
    url: string;
    sha256?: string;
  }[];
  limitations: string[];
}
