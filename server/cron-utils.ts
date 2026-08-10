import { CronExpressionParser } from "cron-parser";

export function getNextCronRun(cronExpression: string): Date {
  try {
    const interval = CronExpressionParser.parse(cronExpression);
    return interval.next().toDate();
  } catch {
    return new Date(Date.now() + 30 * 60 * 1000);
  }
}
