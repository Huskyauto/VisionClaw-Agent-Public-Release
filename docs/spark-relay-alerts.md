# Optional Spark relay connection alerts

Prepared only: notifications are OFF by default. No live mail or activation is
part of this change. Obtain Bob's approval before changing configuration or
testing with a real mailbox. Spark installation/real failover verification is
separate work; these alerts do not prove inference or change its permissions.

## Design and limits

1. Cost: zero model calls, no new scheduler; one observation per existing
   health pass (normally 5 minutes, 15 off-hours). At most one offline attempt
   and one recovery attempt per incident, with a default six-hour inter-incident
   offline cooldown (bounded 30 minutes–24 hours).
2. State: one owner/environment-scoped `agent_jobs` record, never local disk.
3. Failure: read/claim errors suppress mail, not the health monitor. Persist the
   attempt before sending. Ambiguous sends are not automatically retried.
   Inbox verification is required before a recovery can be sent.
4. Identity: advisory transaction lock serializes observation and claim per
   owner/environment; completion is fenced to the claimed notification token.
5. Scope: owner tenant 1, owner-only app, production relay permission gates,
   environment-matched worker heartbeat. No customer recipient or payload.
6. Stop: exact opt-in plus explicit installed confirmation; disabling either
   suppresses all mail. Logs distinguish verified, failed/uncertain and suppressed.
7. Authority: Bob approves installation and live notification activation.
   Health code observes and sends only; it cannot change inference, repair,
   install software, approve work or modify relay permissions.
8. Delta: only deterministic owner email was added. Offline fixtures exercise
   missing installation, disabled relay, wrong scope, sustained staleness,
   concurrency, cooldown, restart, ambiguous delivery and single recovery.

## Configuration

All pre-existing relay gates must already pass. Additionally set, only after
confirmed installation and separate owner authorization:

```
LEGION_SPARK_RELAY_ALERTS_ENABLED=1
LEGION_SPARK_RELAY_INSTALLED=1
LEGION_SPARK_RELAY_ALERT_ENVIRONMENT=production
LEGION_SPARK_RELAY_ALERT_STALE_MINUTES=15
LEGION_SPARK_RELAY_ALERT_COOLDOWN_MINUTES=360
```

Omit any option to use defaults, except the first three which are mandatory.
Threshold integers must be 5–120 minutes; cooldown integers 30–1440 minutes.
Malformed/out-of-range values disable notifications, not silently clamp them.
No credentials or mail recipients belong in this configuration.

The monitor needs an actual worker record before it can alert. It measures
continuous observed staleness after the relay's normal freshness window;
temporary missed polls reset on the next fresh observation. A fresh poll with
`ready=false` still proves the connection, not inference readiness. Future or
malformed timestamps are unknown evidence, not offline or recovered.

Delivery uses the configured owner's own Gmail, shared outbound preflight and
INBOX verification; no AgentMail fallback. Attempts are persisted before send.
A send error, crash or unverified inbox outcome is uncertain, not delivery:
inspect owner mailbox evidence before manually intervening. There is no automatic
resend of that incident, and no recovery mail for an unverified offline mail.
An abandoned claim becomes uncertain after cooldown; it cannot block later
incidents after a fresh connection observation. Fenced late completions cannot
overwrite a newer claim.
Recovery is attempted once after a verified offline notice, even during cooldown.
Cooldown limits subsequent offline incidents, including failed send attempts.
Disable/re-enable retains incident history rather than creating duplicate mail.
An outage and recovery entirely between health passes cannot be detected.

Offline verification (no DB, providers, credentials or live email):

```
npx tsx --test tests/providers/spark-relay-alerts.test.ts
```

Operators and agents should use this runbook when asked about missing Spark
alerts. Do not enable flags, reset attempts, send probes or claim Lenovo
failover without separate owner authorization. Existing relay status remains
the source of worker/inference evidence; mail is notification evidence only.
