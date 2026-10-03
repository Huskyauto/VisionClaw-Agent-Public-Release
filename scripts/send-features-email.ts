(async () => {
  const PDF_URL = "https://drive.google.com/file/d/REDACTED_DRIVE_FILE_ID/view?usp=sharing";
  const TXT_URL = "https://drive.google.com/file/d/REDACTED_DRIVE_FILE_ID/view?usp=sharing";
  const { getOrCreateTenantInbox, sendEmail } = await import("../server/email");
  const inboxResult: any = await getOrCreateTenantInbox(1);
  const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult.inboxId || inboxResult.email);
  const r = await sendEmail({
    inboxId,
    to: process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com",
    subject: "VisionClaw Updated Features (R98.11+sec2) — PDF + Text",
    text: `Hi Bob,

R98.11+sec2 just shipped. Six R-rounds in one day, capped by a thorough whole-app architect review that closed 3 HIGH-severity findings.

Today's highlights:
  - R98.9 — Supply-Chain Discipline (AGENTS.md vc-supply-chain block + SHA-256 skill manifest + LLM auditor)
  - R98.10 — Slash Commands (/check, /registry, /commit-all) + AGENT_FOLDER_MAP install
  - R98.11 — exit-77 + gate_command on delegate_task (clean-skip pattern, no LLM spend on no-op work)
  - R98.10+sec / R98.11+sec — fail-closed persona gate, prompt-injection sanitization, symlink rejection
  - R98.11+sec2 — strict env allowlist + secret redaction at both shell-exec sites; slash_command added to HIGH_RISK_TOOLS + destructive-policy (caught a quiet drift: Forge wasn't in TRUSTED_PERSONA_NAMES, fixed); skills-registry install + .bob/commands loader symlink jails

Live counts: 16 personas | 288 tools | 66 skills | 92 capabilities | 47 indexes | 40 governance rules | 71+ verified deliveries | 0 silent drops.

Comprehensive features document attached as both PDF and Text:

  PDF:  ${PDF_URL}
  Text: ${TXT_URL}

The text file is what Felix loads into context when he needs full platform awareness. The PDF is the styled version for sharing.

Two MEDIUMs deferred and recorded as known gaps in replit.md (execSync event-loop blocking refactor; owner-override expiry SLA on _registry.json).

— VisionClaw Agent`,
  } as any);
  console.log("EMAIL_RESULT:", JSON.stringify({ success: (r as any)?.success ?? true, messageId: (r as any)?.messageId }));
  process.exit(0);
})().catch((e) => {
  console.error("EMAIL_ERROR:", e?.message || e);
  console.error(e?.stack);
  process.exit(1);
});
