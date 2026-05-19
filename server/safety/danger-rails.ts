/**
 * Danger Rails — air-gap destructive operations from auto-execution.
 *
 * Inspired by IJFW's "the model literally cannot run the install for you"
 * pattern. For any operation classified as `blocked`, code MUST call
 * `proposeManualCommand()` instead of executing directly. The returned
 * envelope is shown to the human for paste-execution.
 *
 * This codifies several hard-won lessons:
 *
 *   - Bob's standing rule (replit.md User Preferences):
 *     "DB migrations: psql ALTER TABLE direct, NOT drizzle-kit push."
 *
 *   - The April 25, 2026 incident: the platform's auto-migrate wanted to
 *     DROP TABLE whatsapp_auth CASCADE + 22 DROP/CREATE INDEX pairs, which
 *     would have wiped freshly-shipped encryption-at-rest credentials.
 *     A human glance at the deploy preview was the only line of defense.
 *
 *   - R74.B (Stripe Connect ?? 1 fail-open): destructive billing mutations
 *     must require explicit human authorization, not silent fallback.
 *
 * Usage:
 *
 *   import { classifyCommand, proposeManualCommand } from './safety/danger-rails';
 *
 *   const c = classifyCommand(userInput);
 *   if (c.level === 'blocked') {
 *     return proposeManualCommand({
 *       command: userInput,
 *       reason: 'destructive shell operation',
 *       danger: c.matches[0]?.why,
 *     });
 *   }
 */

export type DangerLevel = 'safe' | 'warn' | 'blocked';

export interface DangerPattern {
  pattern: RegExp;
  name: string;
  why: string;
  level: 'warn' | 'blocked';
}

export interface ManualCommandEnvelope {
  type: 'manual_command_required';
  command: string;
  reason: string;
  danger: string;
  pasteInstructions: string;
}

export interface Classification {
  level: DangerLevel;
  matches: DangerPattern[];
}

/**
 * The destructive-ops deny-list. Any command matching one of these patterns
 * MUST NOT be executed by an automated agent. Use `proposeManualCommand()`
 * to surface a copy-pasteable command for the human operator instead.
 */
export const DESTRUCTIVE_PATTERNS: DangerPattern[] = [
  // === Schema / migrations ===
  {
    pattern: /\b(npm|pnpm|yarn|npx)\s+(run\s+)?db:push\b/i,
    name: 'db:push',
    why: "Destructive schema sync. Bob's User Preferences (replit.md line 7+13): 'DB migrations: psql ALTER TABLE direct, NOT drizzle-kit push.' April 25, 2026 incident: db:push wanted to DROP whatsapp_auth CASCADE.",
    level: 'blocked',
  },
  {
    pattern: /\b(npx|pnpx|yarn)\s+drizzle-kit\s+push\b/i,
    name: 'drizzle-kit push',
    why: 'Same as db:push — destructive auto-migrate. Use psql ALTER TABLE direct.',
    level: 'blocked',
  },
  {
    pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i,
    name: 'DROP statement',
    why: 'Destructive SQL. Surface for human review before running against any non-throwaway DB.',
    level: 'blocked',
  },
  {
    pattern: /\bTRUNCATE\s+TABLE\b/i,
    name: 'TRUNCATE',
    why: 'Wipes all rows in a table. Surface for human review.',
    level: 'blocked',
  },
  {
    // DELETE FROM <table>; or end-of-string with no WHERE.
    // Matches "DELETE FROM users;" but NOT "DELETE FROM users WHERE id = 1".
    pattern: /\bDELETE\s+FROM\s+\w+\s*(;|$)/im,
    name: 'DELETE without WHERE',
    why: 'DELETE without a WHERE clause wipes the entire table. If you really meant it, paste it manually.',
    level: 'blocked',
  },

  // === Git destructive ===
  {
    pattern: /\bgit\s+push\s+(--force\b|-f\b|--force-with-lease\b)/i,
    name: 'git force-push',
    why: 'Rewrites remote history — affects every collaborator. Surface for human paste.',
    level: 'blocked',
  },
  {
    pattern: /\bgit\s+(reset\s+--hard|clean\s+-fd|filter-branch|reflog\s+expire|update-ref\s+-d)\b/i,
    name: 'git destructive op',
    why: 'Discards local work or rewrites history. Human-only operation.',
    level: 'blocked',
  },
  {
    pattern: /\bgit\s+rebase\s+(-i|--interactive|--onto)\b/i,
    name: 'git interactive rebase',
    why: 'Rewrites commit history. Human-only operation.',
    level: 'blocked',
  },

  // === Filesystem destructive ===
  {
    // rm -rf targeting root, $HOME, ~, or cwd directly.
    pattern: /\brm\s+(-[rRf]+\s+)+(\/(\s|$)|\$HOME\b|~\/|\.\s*$|\*\s*$)/i,
    name: 'rm -rf root/home/cwd',
    why: 'Catastrophic delete. Even if the path looks safe, scripts can resolve $variables to unexpected paths.',
    level: 'blocked',
  },

  // === Deploy / publish ===
  {
    pattern: /\b(deploy|publish)\s+(--prod\b|--production\b|production\b)/i,
    name: 'production deploy',
    why: 'Production publish must be human-initiated. Surface the exact command for human paste.',
    level: 'blocked',
  },

  // === Secret rotation / dangerous env ===
  {
    pattern: /\bSESSION_SECRET\s*=\s*['"]/,
    name: 'SESSION_SECRET assignment',
    why: 'Rotating SESSION_SECRET invalidates every session AND breaks every encrypted-at-rest credential (Telegram tokens, WhatsApp creds — both AES-256-GCM-keyed off SESSION_SECRET via HKDF). Human-only operation.',
    level: 'blocked',
  },

  // === Package manager (would change package.json — Bob's standing rule) ===
  {
    // npm install <pkg>, npm add <pkg>, etc — but NOT bare `npm install` (re-installs from lock).
    pattern: /\b(npm|pnpm|yarn)\s+(install|add|remove|uninstall|i)\s+(?!--save-dev|-D\b)\S+/i,
    name: 'package install/remove',
    why: "Bob's standing rule: NEVER edit package.json. Use the platform's package-management tool primitive, never raw npm install <pkg>.",
    level: 'warn',
  },
];

/**
 * Classify a shell command by its destructive risk.
 *
 *   safe    → no patterns matched, OK to execute
 *   warn    → execute but log a warning
 *   blocked → MUST NOT auto-execute; call `proposeManualCommand()`
 */
export function classifyCommand(command: unknown): Classification {
  if (typeof command !== 'string' || command.trim() === '') {
    return { level: 'safe', matches: [] };
  }
  const matches: DangerPattern[] = [];
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.pattern.test(command)) matches.push(p);
  }
  if (matches.length === 0) return { level: 'safe', matches };
  if (matches.some((m) => m.level === 'blocked')) return { level: 'blocked', matches };
  return { level: 'warn', matches };
}

/**
 * Build a manual-command envelope for the human to paste themselves.
 * The agent surfaces this in chat; it never executes the command.
 */
export function proposeManualCommand(opts: {
  command: string;
  reason: string;
  danger?: string;
}): ManualCommandEnvelope {
  const danger = opts.danger || 'Destructive operation — agent will not auto-execute.';
  return {
    type: 'manual_command_required',
    command: opts.command,
    reason: opts.reason,
    danger,
    pasteInstructions:
      `This command is on the destructive-ops deny-list and will not be auto-executed.\n` +
      `Review it carefully, then paste it into your shell yourself if you want to proceed:\n\n` +
      `    ${opts.command}\n\n` +
      `Why this is gated: ${danger}`,
  };
}

/**
 * Convenience: throw if a command is blocked. Use in tool execution paths
 * that don't have a structured way to surface the manual envelope.
 */
export class DestructiveCommandBlockedError extends Error {
  constructor(
    public readonly classification: Classification,
    public readonly command: string,
  ) {
    super(
      `Destructive command blocked: ${classification.matches.map((m) => m.name).join(', ')}\n` +
        `Reason: ${classification.matches.map((m) => m.why).join('; ')}\n` +
        `If you really want this, paste the command into your shell yourself.`,
    );
    this.name = 'DestructiveCommandBlockedError';
  }
}

export function assertSafeOrThrow(command: string): void {
  const c = classifyCommand(command);
  if (c.level === 'blocked') {
    throw new DestructiveCommandBlockedError(c, command);
  }
}
