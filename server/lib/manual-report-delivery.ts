import { z } from "zod";

/** New owner-operated reports are downloads, not implicit offline-paid orders. */
export const manualReportOnlySchema = z.boolean().default(true);

export function manualReportDelivery(
  input: { reportOnly?: boolean; customerEmail?: string | null },
  ownerEmail?: string | null,
) {
  const reportOnly = manualReportOnlySchema.parse(input.reportOnly);
  const deliveryEmail = reportOnly ? undefined : input.customerEmail?.trim() || undefined;
  return {
    reportOnly,
    customerEmail: deliveryEmail || ownerEmail || "operator@visionclaw",
    deliveryEmail,
  };
}
