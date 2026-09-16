export const HERMES_GLM53_FLASH_PILOT_MODEL = "z-ai/glm-5.3-flash";
export const HERMES_GLM53_FLASH_PILOT_START = new Date("2026-08-28T05:00:00.000Z");
export const HERMES_GLM53_FLASH_PILOT_END = new Date("2026-09-27T05:00:00.000Z");

export function selectHermesAdminPilotModel(params: {
  tenantId: number;
  adminTenantId: number;
  personaName?: string | null;
  explicitModelSelected: boolean;
  now?: Date;
}): string | null {
  const now = params.now ?? new Date();
  const duringPilot =
    now >= HERMES_GLM53_FLASH_PILOT_START &&
    now < HERMES_GLM53_FLASH_PILOT_END;

  if (
    params.tenantId === params.adminTenantId &&
    params.personaName === "Hermes" &&
    !params.explicitModelSelected &&
    duringPilot
  ) {
    return HERMES_GLM53_FLASH_PILOT_MODEL;
  }

  return null;
}