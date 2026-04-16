#!/usr/bin/env npx tsx
/**
 * Felix Presentation Diagnostic & Repair Script
 * 
 * Run: npx tsx scripts/felix-presentation-check.ts
 * 
 * Checks everything that can prevent Felix from building presentations,
 * repairs what it can, and reports what needs manual attention.
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const WARN = "\x1b[33m⚠\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let passes = 0;
let fails = 0;
let warns = 0;
let repairs = 0;

function pass(msg: string) { console.log(`  ${PASS} ${msg}`); passes++; }
function fail(msg: string) { console.log(`  ${FAIL} ${msg}`); fails++; }
function warn(msg: string) { console.log(`  ${WARN} ${msg}`); warns++; }
function info(msg: string) { console.log(`  ${INFO} ${msg}`); }
function header(msg: string) { console.log(`\n${BOLD}─── ${msg} ───${RESET}`); }

async function main() {
  console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║   Felix Presentation Diagnostic & Repair Script          ║${RESET}`);
  console.log(`${BOLD}║   VisionClaw Agent Platform                              ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);

  // ── 1. Check Felix persona exists and is configured correctly ──
  header("1. FELIX PERSONA");
  try {
    const personaResult = await db.execute(sql`SELECT id, name, role FROM personas WHERE id = 2`);
    const rows = (personaResult as any).rows || personaResult;
    if (rows.length > 0) {
      const felix = rows[0];
      pass(`Felix persona exists (id=${felix.id}, name=${felix.name}, role=${felix.role})`);
      const trustResult = await db.execute(sql`SELECT score FROM trust_scores WHERE persona_id = 2 AND tenant_id = 1`);
      const trustRows = (trustResult as any).rows || trustResult;
      const trustScore = trustRows.length > 0 ? parseInt(trustRows[0].score) : 0;
      if (trustScore >= 70) {
        pass(`Trust score: ${trustScore} (full_auto threshold met)`);
      } else {
        warn(`Trust score: ${trustScore} — below 70, may trigger extra approval steps`);
      }
    } else {
      fail("Felix persona (id=2) NOT FOUND in database");
    }
  } catch (e: any) {
    fail(`Database error checking Felix: ${e.message}`);
  }

  // ── 2. Check conversation health ──
  header("2. CONVERSATION HEALTH");
  try {
    const bloatedResult = await db.execute(sql`
      SELECT c.id, c.title, 
        (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) as msg_count,
        (SELECT coalesce(sum(length(m.content)), 0) FROM messages m WHERE m.conversation_id = c.id) as total_chars
      FROM conversations c 
      WHERE c.tenant_id = 1 AND c.persona_id = 2
      ORDER BY c.id DESC LIMIT 20
    `);
    const convRows = (bloatedResult as any).rows || bloatedResult;
    let bloatedCount = 0;
    for (const conv of convRows) {
      const chars = parseInt(conv.total_chars) || 0;
      const msgs = parseInt(conv.msg_count) || 0;
      if (chars > 500_000) {
        fail(`Conv #${conv.id}: ${msgs} msgs, ${(chars / 1_000_000).toFixed(1)}M chars — BLOATED, will cause timeouts`);
        bloatedCount++;
      } else if (chars > 200_000) {
        warn(`Conv #${conv.id}: ${msgs} msgs, ${(chars / 1000).toFixed(0)}K chars — getting large`);
      }
    }
    if (bloatedCount === 0) {
      pass("No bloated Felix conversations found");
    } else {
      info(`${bloatedCount} bloated conversation(s) — start fresh conversations instead of reusing these`);
    }
  } catch (e: any) {
    fail(`Database error: ${e.message}`);
  }

  // ── 3. Check tool metadata bloat in stored messages ──
  header("3. TOOL METADATA BLOAT");
  try {
    const metaResult = await db.execute(sql`
      SELECT m.id, m.conversation_id, length(m.content) as len
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.tenant_id = 1 AND c.persona_id = 2
        AND m.role = 'assistant'
        AND m.content LIKE '%<!-- tools:%'
        AND length(m.content) > 50000
      ORDER BY length(m.content) DESC
      LIMIT 10
    `);
    const metaRows = (metaResult as any).rows || metaResult;
    if (metaRows.length === 0) {
      pass("No oversized tool metadata in stored messages");
    } else {
      warn(`${metaRows.length} message(s) have oversized tool metadata (>50K chars)`);
      for (const row of metaRows) {
        info(`  Message #${row.id} in conv #${row.conversation_id}: ${(parseInt(row.len) / 1000).toFixed(0)}K chars`);
      }
      
      const repairChoice = process.argv.includes("--repair");
      if (repairChoice) {
        let trimmed = 0;
        for (const row of metaRows) {
          try {
            const msgResult = await db.execute(sql`SELECT content FROM messages WHERE id = ${row.id}`);
            const msgRows = (msgResult as any).rows || msgResult;
            if (msgRows.length > 0) {
              let content = msgRows[0].content as string;
              const toolsMatch = content.match(/^(<!-- tools:\[)[\s\S]*?(\] -->)\n?/);
              if (toolsMatch) {
                const truncatedTools = content.slice(0, 500) + '...' + toolsMatch[2];
                content = content.replace(toolsMatch[0], truncatedTools + "\n");
                await db.execute(sql`UPDATE messages SET content = ${content} WHERE id = ${row.id}`);
                trimmed++;
              }
            }
          } catch {}
        }
        if (trimmed > 0) {
          pass(`Repaired: trimmed tool metadata in ${trimmed} message(s)`);
          repairs += trimmed;
        }
      } else {
        info("Run with --repair to automatically trim oversized metadata");
      }
    }
  } catch (e: any) {
    fail(`Database error: ${e.message}`);
  }

  // ── 4. Check SSE streaming configuration ──
  header("4. SSE STREAMING CONFIG");
  const fs = await import("fs");
  
  try {
    const chatEngine = fs.readFileSync("server/chat-engine.ts", "utf-8");
    const windowMatch = chatEngine.match(/const MAX_WINDOW\s*=\s*(\d+)/);
    if (windowMatch) {
      const val = parseInt(windowMatch[1]);
      if (val <= 20) {
        pass(`MAX_WINDOW = ${val} (optimal for presentations)`);
      } else {
        fail(`MAX_WINDOW = ${val} — too high, should be ≤20 for fast presentations`);
      }
    } else {
      warn("Could not find MAX_WINDOW setting");
    }
  } catch (e: any) {
    fail(`Could not read chat-engine.ts: ${e.message}`);
  }

  try {
    const routes = fs.readFileSync("server/routes.ts", "utf-8");
    
    const contextCap = routes.match(/const MAX_CONTEXT_CHARS\s*=\s*(\d[\d_]*)/);
    if (contextCap) {
      const val = parseInt(contextCap[1].replace(/_/g, ""));
      if (val <= 200_000) {
        pass(`MAX_CONTEXT_CHARS = ${val.toLocaleString()} (hard cap active)`);
      } else {
        warn(`MAX_CONTEXT_CHARS = ${val.toLocaleString()} — consider lowering to 200,000`);
      }
    } else {
      fail("No MAX_CONTEXT_CHARS hard cap found — context can bloat without limit");
    }

    const streamTimeout = routes.match(/STREAM_FIRST_CHUNK_TIMEOUT\s*=\s*(\d[\d_]*)/);
    if (streamTimeout) {
      const val = parseInt(streamTimeout[1].replace(/_/g, ""));
      pass(`Stream timeout = ${val / 1000}s (prevents infinite hangs)`);
    } else {
      fail("No STREAM_FIRST_CHUNK_TIMEOUT found — streams can hang forever");
    }

    const toolResultCap = routes.match(/MAX_TOOL_RESULT_FOR_MODEL\s*=\s*(\d[\d_]*)/);
    if (toolResultCap) {
      const val = parseInt(toolResultCap[1].replace(/_/g, ""));
      pass(`Tool result cap = ${val.toLocaleString()} chars per tool result`);
    } else {
      warn("No MAX_TOOL_RESULT_FOR_MODEL cap found");
    }

    const fileCap = routes.match(/MAX_FILE_CONTEXT_CHARS\s*=\s*(\d[\d_]*)/);
    if (fileCap) {
      const val = parseInt(fileCap[1].replace(/_/g, ""));
      pass(`File context cap = ${val.toLocaleString()} chars per uploaded file`);
    } else {
      warn("No MAX_FILE_CONTEXT_CHARS cap found — uploaded file text can bloat context");
    }

    if (routes.includes("executedTools.length === 0")) {
      pass("Self-reflection skipped when tools are used (faster presentations)");
    } else {
      warn("Self-reflection may run after tool-heavy responses, adding delay");
    }

    const toolMetaCap = routes.match(/output:.*typeof.*output.*slice\(0,\s*(\d+)\)/);
    if (routes.includes('.slice(0, 500)') && routes.includes('toolMeta')) {
      pass("Tool metadata stored with 500-char output cap");
    } else {
      warn("Tool metadata output cap may not be active — check toolMeta construction");
    }

    if (routes.includes("try { clearInterval(globalKeepalive)")) {
      pass("globalKeepalive wrapped in try/catch (crash-safe)");
    } else {
      fail("globalKeepalive NOT wrapped in try/catch — may crash and kill response");
    }

    const doneEvent = (routes.match(/done:\s*true/g) || []).length;
    if (doneEvent >= 2) {
      pass(`'done' event sent in ${doneEvent} code paths (client properly notified)`);
    } else {
      warn("'done' event may not be sent in all paths — client could get stuck");
    }

    if (routes.includes("thinking_progress")) {
      pass("Thinking progress indicators active (audience sees activity)");
    } else {
      warn("No thinking_progress events — audience sees nothing while model thinks");
    }
  } catch (e: any) {
    fail(`Could not read routes.ts: ${e.message}`);
  }

  // ── 5. Check provider configuration ──
  header("5. AI PROVIDER CONFIG");
  try {
    const provResult = await db.execute(sql`
      SELECT provider, enabled
      FROM provider_keys
      WHERE provider IN ('replit-openai', 'openai', 'anthropic')
      ORDER BY provider
    `);
    const provRows = (provResult as any).rows || provResult;
    const providers = new Set(provRows.filter((r: any) => r.enabled !== false).map((r: any) => r.provider));
    
    if (providers.has("replit-openai")) {
      pass("Replit OpenAI provider configured (GPT-5.4 for Felix)");
    } else if (process.env.OPENAI_API_KEY) {
      pass("OpenAI API key set (Felix can use GPT models)");
    } else {
      fail("No OpenAI provider configured — Felix needs this for GPT-5.4");
    }
    if (providers.has("openai") || process.env.OPENAI_API_KEY) {
      pass("OpenAI available (DALL-E 3 image fallback)");
    } else {
      warn("OpenAI not configured — image generation fallback unavailable");
    }
  } catch (e: any) {
    warn(`Could not check provider keys: ${e.message}`);
  }

  // ── 6. Check Google Drive connectivity ──
  header("6. GOOGLE DRIVE");
  try {
    const tokenResult = await db.execute(sql`
      SELECT provider FROM oauth_subscriptions 
      WHERE tenant_id = 1 AND provider IN ('google-workspace', 'google')
      ORDER BY provider
    `);
    const tokenRows = (tokenResult as any).rows || tokenResult;
    if (tokenRows.length > 0) {
      for (const row of tokenRows) {
        pass(`${row.provider} OAuth subscription active`);
      }
    } else {
      info("No OAuth subscriptions found — using Replit connector-based auth (normal)");
    }
  } catch (e: any) {
    info("OAuth table not found — Google auth managed by Replit connectors (normal)");
  }

  // ── 7. Check Felix instruction file exists ──
  header("7. FELIX INSTRUCTIONS FILE");
  try {
    if (fs.existsSync("data/Felix-Presentation-Instructions.txt")) {
      const content = fs.readFileSync("data/Felix-Presentation-Instructions.txt", "utf-8");
      pass(`Felix instructions file present (${content.length} chars)`);
    } else {
      fail("data/Felix-Presentation-Instructions.txt MISSING — Felix has no guidance file");
    }
    if (fs.existsSync("data/VisionClaw-Comprehensive-Features.txt")) {
      const content = fs.readFileSync("data/VisionClaw-Comprehensive-Features.txt", "utf-8");
      pass(`Comprehensive features file present (${content.length} chars)`);
    } else {
      fail("data/VisionClaw-Comprehensive-Features.txt MISSING — Felix has no source data");
    }
    if (fs.existsSync("data/visionclaw-logo.png")) {
      pass("VisionClaw logo present");
    } else {
      warn("data/visionclaw-logo.png missing — presentations won't have logo");
    }
  } catch (e: any) {
    fail(`File check error: ${e.message}`);
  }

  // ── 8. Check create_slides tool registration ──
  header("8. PRESENTATION TOOLS");
  try {
    const tools = fs.readFileSync("server/tools.ts", "utf-8");
    if (tools.includes('"create_slides"') || tools.includes("'create_slides'") || tools.includes("create_slides")) {
      pass("create_slides tool registered");
    } else {
      fail("create_slides tool NOT found in tools.ts");
    }
    if (tools.includes('"create_pdf"') || tools.includes("create_pdf")) {
      pass("create_pdf tool registered");
    } else {
      fail("create_pdf tool NOT found in tools.ts");
    }
  } catch (e: any) {
    fail(`Could not check tools.ts: ${e.message}`);
  }

  // ── 9. Check Claude Runner bridge config ──
  header("9. CLAUDE RUNNER BRIDGE");
  try {
    const routes = fs.readFileSync("server/routes.ts", "utf-8");
    const requiresToolsCount = (routes.match(/requiresTools:\s*true/g) || []).length;
    if (requiresToolsCount >= 2) {
      pass(`requiresTools: true passed in ${requiresToolsCount} SSE paths (bridge bypass active)`);
    } else {
      fail("requiresTools flag may not be set in all SSE paths — Claude bridge could intercept Felix");
    }
  } catch (e: any) {
    fail(`Could not check bridge config: ${e.message}`);
  }

  // ── 10. Check Browserless API key (for PDF generation) ──
  header("10. BROWSERLESS (PDF GENERATION)");
  if (process.env.BROWSERLESS_API_KEY) {
    pass("BROWSERLESS_API_KEY is set");
  } else {
    fail("BROWSERLESS_API_KEY not set — PDF generation will fail");
  }

  // ── SUMMARY ──
  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}RESULTS: ${RESET}${PASS} ${passes} passed  ${FAIL} ${fails} failed  ${WARN} ${warns} warnings`);
  if (repairs > 0) {
    console.log(`${PASS} ${repairs} repair(s) applied`);
  }
  
  if (fails === 0) {
    console.log(`\n${BOLD}\x1b[32mAll clear — Felix should be able to build presentations successfully.${RESET}`);
    console.log(`${INFO} Always start a FRESH conversation for presentations.`);
    console.log(`${INFO} Target: ~3 minutes for a complete 12-16 slide deck.\n`);
  } else {
    console.log(`\n${BOLD}\x1b[31m${fails} issue(s) need attention before presentations will work reliably.${RESET}\n`);
  }

  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(2);
});
