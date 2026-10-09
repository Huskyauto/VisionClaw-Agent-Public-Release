// ─────────────────────────────────────────────────────────────────────────────
// R84 — Secret redactor for log output (ported from Hermes Alpha redact.py)
// ─────────────────────────────────────────────────────────────────────────────
// Apply this before any user-facing log line, audit trail, or tenant
// download. Masks 22 known prefixes plus generic ENV/JSON/auth-header/
// Telegram/private-key/DB-conn-string/E.164 patterns.
// Short tokens (<18 chars) become "***"; long tokens preserve first 6 +
// last 4 for debuggability.
// ─────────────────────────────────────────────────────────────────────────────

const PREFIX_PATTERNS = [
  String.raw`sk-[A-Za-z0-9_-]{10,}`,
  String.raw`ghp_[A-Za-z0-9]{10,}`,
  String.raw`github_pat_[A-Za-z0-9_]{10,}`,
  String.raw`xox[baprs]-[A-Za-z0-9-]{10,}`,
  String.raw`AIza[A-Za-z0-9_-]{30,}`,
  String.raw`pplx-[A-Za-z0-9]{10,}`,
  String.raw`fal_[A-Za-z0-9_-]{10,}`,
  String.raw`fc-[A-Za-z0-9]{10,}`,
  String.raw`bb_live_[A-Za-z0-9_-]{10,}`,
  String.raw`gAAAA[A-Za-z0-9_=-]{20,}`,
  String.raw`AKIA[A-Z0-9]{16}`,
  String.raw`sk_live_[A-Za-z0-9]{10,}`,
  String.raw`sk_test_[A-Za-z0-9]{10,}`,
  String.raw`rk_live_[A-Za-z0-9]{10,}`,
  String.raw`SG\.[A-Za-z0-9_-]{10,}`,
  String.raw`hf_[A-Za-z0-9]{10,}`,
  String.raw`r8_[A-Za-z0-9]{10,}`,
  String.raw`npm_[A-Za-z0-9]{10,}`,
  String.raw`pypi-[A-Za-z0-9_-]{10,}`,
  String.raw`dop_v1_[A-Za-z0-9]{10,}`,
  String.raw`doo_v1_[A-Za-z0-9]{10,}`,
  String.raw`am_[A-Za-z0-9_-]{10,}`,
  String.raw`whsec_[A-Za-z0-9]{20,}`,
  String.raw`xai-[A-Za-z0-9]{40,}`,
];

const PREFIX_RE = new RegExp(
  `(?<![A-Za-z0-9_-])(${PREFIX_PATTERNS.join("|")})(?![A-Za-z0-9_-])`,
  "g",
);

const SECRET_ENV_NAMES = `(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)`;
const ENV_ASSIGN_RE = new RegExp(
  `([A-Z_]*${SECRET_ENV_NAMES}[A-Z_]*)\\s*=\\s*(['"]?)(\\S+)\\2`,
  "gi",
);

const JSON_KEY_NAMES = `(?:api_?[Kk]ey|token|secret|password|access_token|refresh_token|auth_token|bearer)`;
const JSON_FIELD_RE = new RegExp(
  `("${JSON_KEY_NAMES}")\\s*:\\s*"([^"]+)"`,
  "gi",
);

const AUTH_HEADER_RE = /(Authorization:\s*Bearer\s+)(\S+)/gi;
const TELEGRAM_RE = /(bot)?(\d{8,}):([-A-Za-z0-9_]{30,})/g;
const PRIVATE_KEY_RE =
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;
const DB_CONNSTR_RE =
  /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:]+:)([^@]+)(@)/gi;
const SIGNAL_PHONE_RE = /(\+[1-9]\d{6,14})(?![A-Za-z0-9])/g;

function maskToken(token: string): string {
  if (token.length < 18) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export function redactSensitiveText(text: string): string {
  if (!text) return text;
  if (process.env.VISIONCLAW_REDACT_SECRETS &&
      ["0", "false", "no", "off"].includes(process.env.VISIONCLAW_REDACT_SECRETS.toLowerCase())) {
    return text;
  }

  let out = text;
  out = out.replace(PREFIX_RE, (_m, tok) => maskToken(tok));
  out = out.replace(ENV_ASSIGN_RE, (_m, name, q, val) => `${name}=${q}${maskToken(val)}${q}`);
  out = out.replace(JSON_FIELD_RE, (_m, key, val) => `${key}: "${maskToken(val)}"`);
  out = out.replace(AUTH_HEADER_RE, (_m, hdr, tok) => `${hdr}${maskToken(tok)}`);
  out = out.replace(TELEGRAM_RE, (_m, prefix, digits) => `${prefix || ""}${digits}:***`);
  out = out.replace(PRIVATE_KEY_RE, "[REDACTED PRIVATE KEY]");
  out = out.replace(DB_CONNSTR_RE, (_m, head, _pw, tail) => `${head}***${tail}`);
  out = out.replace(SIGNAL_PHONE_RE, (_m, phone) => {
    if (phone.length <= 8) return phone.slice(0, 2) + "****" + phone.slice(-2);
    return phone.slice(0, 4) + "****" + phone.slice(-4);
  });
  return out;
}

export function redactArgs(args: any[]): any[] {
  return args.map((a) => {
    if (typeof a === "string") return redactSensitiveText(a);
    if (a && typeof a === "object") {
      try {
        return JSON.parse(redactSensitiveText(JSON.stringify(a)));
      } catch {
        return a;
      }
    }
    return a;
  });
}

let installed = false;
export function installConsoleRedactor(): void {
  if (installed) return;
  installed = true;
  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  console.log = (...args: any[]) => orig.log(...redactArgs(args));
  console.info = (...args: any[]) => orig.info(...redactArgs(args));
  console.warn = (...args: any[]) => orig.warn(...redactArgs(args));
  console.error = (...args: any[]) => orig.error(...redactArgs(args));
  console.debug = (...args: any[]) => orig.debug(...redactArgs(args));
}
