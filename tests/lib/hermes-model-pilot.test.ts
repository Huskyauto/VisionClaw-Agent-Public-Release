import { describe, it, expect } from "./_vitest-shim";
import { selectHermesAdminPilotModel } from "../../server/lib/hermes-model-pilot";

const ADMIN_TENANT_ID = 1;
const DURING_PILOT = new Date("2026-09-01T12:00:00.000Z");

describe("Hermes GLM-5.3-Flash probation", () => {
  it("selects GLM-5.3-Flash for a new admin Hermes conversation during the pilot", () => {
    expect(selectHermesAdminPilotModel({
      tenantId: ADMIN_TENANT_ID,
      adminTenantId: ADMIN_TENANT_ID,
      personaName: "Hermes",
      explicitModelSelected: false,
      now: DURING_PILOT,
    })).toBe("z-ai/glm-5.3-flash");
  });

  it("does not select the pilot for another tenant", () => {
    expect(selectHermesAdminPilotModel({
      tenantId: 2,
      adminTenantId: ADMIN_TENANT_ID,
      personaName: "Hermes",
      explicitModelSelected: false,
      now: DURING_PILOT,
    })).toBeNull();
  });

  it("does not override an explicit model choice", () => {
    expect(selectHermesAdminPilotModel({
      tenantId: ADMIN_TENANT_ID,
      adminTenantId: ADMIN_TENANT_ID,
      personaName: "Hermes",
      explicitModelSelected: true,
      now: DURING_PILOT,
    })).toBeNull();
  });

  it("automatically expires after the 30-day probation window", () => {
    expect(selectHermesAdminPilotModel({
      tenantId: ADMIN_TENANT_ID,
      adminTenantId: ADMIN_TENANT_ID,
      personaName: "Hermes",
      explicitModelSelected: false,
      now: new Date("2026-09-27T05:00:00.000Z"),
    })).toBeNull();
  });
});