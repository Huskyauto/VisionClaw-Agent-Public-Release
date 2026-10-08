import { CronExpressionParser } from "cron-parser";

/** Use the installed parser's API and never silently replace a schedule. */
export function computeNextRecurringRun(cron: string, from = new Date()): Date {
  return CronExpressionParser.parse(cron, {
    currentDate: from,
    tz: "America/Chicago",
  }).next().toDate();
}