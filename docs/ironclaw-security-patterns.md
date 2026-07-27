# IronClaw Security Patterns — Reference for VisionClaw

## Source
nearai/ironclaw — Rust reimplementation of OpenClaw with defense-in-depth security.

## Key Patterns Implemented in VisionClaw

### 1. SafetyLayer (server/safety-layer.ts)
- **LeakDetector**: Scans all tool outputs and inbound messages for API key patterns
  - OpenAI, Anthropic, AWS, GitHub, Stripe, Slack, SendGrid, Google, PEM keys, Bearer tokens
  - Actions: block (reject), redact (replace with [REDACTED]), warn (log only)
- **PolicyEngine**: Blocks dangerous patterns
  - System file access (/etc/passwd, .ssh/, .aws/credentials)
  - Shell injection (; rm -rf, curl | sh)
  - Crypto private keys
  - SQL injection patterns
  - Encoded exploit payloads
- **Injection Protection**: Escapes special tokens, role markers, tool_output boundaries

### 2. Integration Points
- **Tool output scanning**: chat-engine.ts — every tool result goes through `scanToolOutput()` before being sent to the LLM
- **Inbound message scanning**: routes.ts — user messages scanned via `scanInboundMessage()` at both authenticated and public chat endpoints
- **External content wrapping**: external-content-security.ts — existing XML boundary protection extended

### 3. IronClaw Patterns NOT YET Implemented (Future Work)
- **WASM credential injection**: IronClaw uses WebAssembly sandboxes to inject credentials at runtime without exposing them to the agent. VisionClaw currently uses server-side decryption via `decryptApiKey()`.
- **Endpoint allowlisting**: IronClaw maintains an explicit allowlist of HTTP endpoints tools can access. VisionClaw currently relies on URL validation in the browser/fetch tools.
- **Audit trail DB table**: IronClaw logs every security event to a dedicated audit table. VisionClaw currently logs to console.
- **Per-tool permission scopes**: IronClaw assigns each tool a set of permission scopes (read_fs, write_fs, network, etc.). VisionClaw uses the existing risk classification system.
- **Rate limiting per tool**: IronClaw rate-limits individual tool invocations to prevent abuse. VisionClaw has conversation-level rate limiting but not per-tool.

## Architecture Decisions
- Safety scanning is synchronous and lightweight (regex-based) to avoid latency
- Block action returns sanitized message to LLM instead of raw content
- Warn action logs but does not modify content (for monitoring)
- High-entropy hex patterns (64-char) are warn-only to avoid false positives on hashes
- Bearer token patterns are redact-only (not block) since they appear in legitimate HTTP documentation
