import { isAbsolute, join } from "node:path";

/**
 * Credential isolation only, not an OS/network sandbox. Callers supply a fresh
 * scratch home and mock side-effecting transports before loading application code.
 */
export function buildOfflineVerificationEnv(
  source: NodeJS.ProcessEnv, home: string,
): NodeJS.ProcessEnv {
  if (!isAbsolute(home)) throw new Error("Offline verification requires an absolute scratch HOME");
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ"] as const) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  Object.assign(env, {
    HOME: home, XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"), TMPDIR: home,
    NODE_ENV: "test", RUN_E2E: "0",
    NODE_OPTIONS: "--max-old-space-size=3072",
    DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/offline?connect_timeout=1",
  });
  // Some modules construct SDK clients at import time. These are deliberately
  // invalid credentials, never a substitute for mocking a provider transport.
  for (const provider of ["OPENAI", "ANTHROPIC", "GEMINI"]) {
    env[`${provider}_API_KEY`] = "offline-constructor-fixture";
    env[`AI_INTEGRATIONS_${provider}_API_KEY`] = "offline-constructor-fixture";
    env[`AI_INTEGRATIONS_${provider}_BASE_URL`] = "https://offline-verification.invalid";
  }
  env.OPENAI_BASE_URL = "https://offline-verification.invalid/v1";
  env.ANTHROPIC_BASE_URL = "https://offline-verification.invalid";
  return env;
}

