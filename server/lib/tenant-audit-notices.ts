import { sql } from "drizzle-orm";

type Execute = (query: any) => Promise<any>;
export async function recordAuditNotice(
  decision: { window: string; warning: string | null }, sourceHash: string,
  store: { execute: Execute; transaction(work: (execute: Execute) => Promise<void>): Promise<void> },
): Promise<void> {
  if (!decision.warning || decision.warning === "findings") {
    await store.execute(sql`UPDATE notifications SET type='info',
      title=${decision.warning === "findings" ? "Audit coverage restored; findings need attention" : "Tenant audit coverage restored"},
      message='The current source audit completed its coverage and precision checks. This historical coverage warning is resolved; retained security findings remain separate.',
      metadata=metadata || jsonb_build_object('resolvedAt',now()::text)
      WHERE tenant_id=1 AND category='security'
        AND metadata->>'auditScheduleKey' LIKE 'tenant-audit:%'
        AND metadata->>'status' IN ('missing','incomplete','stalled','source_changed')
        AND metadata->>'resolvedAt' IS NULL`);
  }
  if (!decision.warning) return;
  const key = `tenant-audit:${decision.window}:${sourceHash}:${decision.warning}`;
  const title = "Tenant audit coverage requires attention";
  const message = `Audit status: ${decision.warning}. A quiet digest is not security clearance. Check the audit job for current coverage and failures.`;
  await store.transaction(async execute => {
    await execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    // If the same warning recurs, reopen its history rather than leaving a
    // resolved notice as the only record. Different source revisions use new keys.
    await execute(sql`UPDATE notifications SET type='warning',title=${title},
      message=${message},is_read=false,metadata=metadata-'resolvedAt'
      WHERE tenant_id=1 AND category='security' AND metadata->>'auditScheduleKey'=${key}
        AND metadata->>'resolvedAt' IS NOT NULL`);
    await execute(sql`INSERT INTO notifications
      (tenant_id,type,title,message,category,metadata,action_url)
      SELECT 1,'warning',${title},${message},'security',
        ${JSON.stringify({ auditScheduleKey: key, status: decision.warning })}::jsonb,'/operator'
      WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE tenant_id=1
        AND metadata->>'auditScheduleKey'=${key})`);
  });
}
