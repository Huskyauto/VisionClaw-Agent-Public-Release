import { CronExpressionParser } from "cron-parser";

const MIN_CRON_CADENCE_MS = 5 * 60 * 1000;

/** Parse only the portable five-field cron form used by heartbeat repairs. */
export function parseStrictCron(cronExpression: unknown): string {
  if (typeof cronExpression !== "string") throw new Error("cron expression must be a string");
  const value = cronExpression.trim();
  if (!value || value.split(/\s+/).length !== 5 || /^[A-Za-z]+$/.test(value.split(/\s+/)[0])) {
    throw new Error("cron expression must contain exactly five fields");
  }
  if (value.includes("?") || value.includes("@")) throw new Error("cron macros are not supported");
  let interval;
  try {
    interval = CronExpressionParser.parse(value);
    const first = interval.next().toDate();
    const second = interval.next().toDate();
    if (second.getTime() - first.getTime() < MIN_CRON_CADENCE_MS) {
      throw new Error("cron cadence must be at least five minutes");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("cadence")) throw error;
    throw new Error("invalid five-field cron expression");
  }
  return value;
}

export function getNextStrictCronRun(cronExpression: string): Date {
  const value = parseStrictCron(cronExpression);
  return CronExpressionParser.parse(value).next().toDate();
}

export function getNextCronRun(cronExpression: string): Date {
  try {
    const interval = CronExpressionParser.parse(cronExpression);
    return interval.next().toDate();
  } catch {
    return new Date(Date.now() + 30 * 60 * 1000);
  }
}
