import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseAgentMarkdown,
  mapToolsToVisionClaw,
  inferTier,
  parsedToPersonaInsert,
  parseGithubUrl,
  deriveSourceSlug,
  buildRuntimeAdapter,
  buildOperatingLoop,
  buildAutonomyRulesForImport,
} from "../../server/claude-subagent-importer";

const SAMPLE_DETECTION_ENGINEER = `---
name: detection-engineer
description: Delegates to this agent when the user asks about detection rules, SIEM queries, threat hunting.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebFetch
  - WebSearch
model: sonnet
---

You are an expert detection engineer. Produce Sigma/Splunk/KQL rules.

## Core Capabilities
- Sigma
- Splunk SPL
`;

const SAMPLE_TIER2_EXECUTOR = `---
name: web-hunter
description: ffuf/sqlmap/dalfox web testing. Tier 2 — executes web tools directly.
tools:
  - Read
  - Bash
  - WebFetch
model: sonnet
---

Execute ffuf and gobuster against in-scope targets.`;

const SAMPLE_NO_FRONTMATTER = `# detection-engineer

You are an expert detection engineer.`;

const SAMPLE_BAD_YAML = `---
name: bad
tools: [Read, Write
---
body`;

const SAMPLE_NO_NAME = `---
description: missing name field
tools: [Read]
---
body`;

const SAMPLE_UNKNOWN_TOOL = `---
name: weird-agent
description: uses tools we don't know
tools:
  - Read
  - PsychicProjection
  - Bash
---
body`;

describe("parseAgentMarkdown", () => {
  it("parses a normal detection-engineer agent", () => {
    const p = parseAgentMarkdown(SAMPLE_DETECTION_ENGINEER, "detection-engineer.md");
    assert.equal(p.slug, "detection-engineer");
    assert.equal(p.frontmatter.name, "detection-engineer");
    assert.equal(p.frontmatter.model, "sonnet");
    assert.deepEqual(p.frontmatter.tools, ["Read", "Write", "Edit", "Grep", "Glob", "WebFetch", "WebSearch"]);
    assert.match(p.body, /You are an expert detection engineer/);
    assert.equal(p.tier, "advisory");
    assert.equal(p.mappedTools.length, 7);
    assert.equal(p.warnings.length, 0);
  });

  it("flags Tier 2 + Bash agents as executor", () => {
    const p = parseAgentMarkdown(SAMPLE_TIER2_EXECUTOR, "web-hunter.md");
    assert.equal(p.tier, "executor");
    const bash = p.mappedTools.find((t) => t.claudeName === "Bash");
    assert.ok(bash, "Bash tool present");
    assert.equal(bash!.hitlRecommended, true);
  });

  it("rejects missing frontmatter", () => {
    assert.throws(() => parseAgentMarkdown(SAMPLE_NO_FRONTMATTER, "x.md"), /missing or malformed YAML frontmatter/);
  });

  it("rejects malformed YAML", () => {
    assert.throws(() => parseAgentMarkdown(SAMPLE_BAD_YAML, "x.md"), /YAML parse failed/);
  });

  it("rejects missing required `name` field", () => {
    assert.throws(() => parseAgentMarkdown(SAMPLE_NO_NAME, "x.md"), /missing required `name` field/);
  });

  it("warns on unknown tools but does not throw", () => {
    const p = parseAgentMarkdown(SAMPLE_UNKNOWN_TOOL, "weird.md");
    assert.equal(p.tier, "executor"); // Bash present
    assert.ok(p.warnings.some((w) => w.includes("PsychicProjection")), "warning emitted for unknown tool");
    assert.equal(p.mappedTools.length, 3);
  });

  it("rejects empty content", () => {
    assert.throws(() => parseAgentMarkdown("", "x.md"), /empty content/);
    assert.throws(() => parseAgentMarkdown("   \n", "x.md"), /empty content/);
  });

  it("strips UTF-8 BOM", () => {
    const withBom = "\uFEFF" + SAMPLE_DETECTION_ENGINEER;
    const p = parseAgentMarkdown(withBom, "bom.md");
    assert.equal(p.slug, "detection-engineer");
  });

  it("handles CRLF line endings", () => {
    const crlf = SAMPLE_DETECTION_ENGINEER.replace(/\n/g, "\r\n");
    const p = parseAgentMarkdown(crlf, "crlf.md");
    assert.equal(p.slug, "detection-engineer");
  });
});

describe("mapToolsToVisionClaw", () => {
  it("maps known tools and flags unknowns", () => {
    const m = mapToolsToVisionClaw(["Bash", "Read", "Foobar"]);
    assert.equal(m.length, 3);
    const bash = m.find((t) => t.claudeName === "Bash")!;
    assert.equal(bash.hitlRecommended, true);
    assert.match(bash.visionclawHint, /HITL/);
    const foobar = m.find((t) => t.claudeName === "Foobar")!;
    assert.equal(foobar.hitlRecommended, false);
    assert.match(foobar.visionclawHint, /no direct mapping/);
  });
});

describe("inferTier", () => {
  it("Bash → executor", () => {
    assert.equal(inferTier({ frontmatter: { name: "x", tools: ["Bash"] }, body: "" }), "executor");
  });
  it("description with 'Tier 2' → executor", () => {
    assert.equal(
      inferTier({ frontmatter: { name: "x", description: "Recon advisor. Tier 2 capable.", tools: ["Read"] }, body: "" }),
      "executor",
    );
  });
  it("body with 'executes' → executor", () => {
    assert.equal(
      inferTier({ frontmatter: { name: "x", tools: ["Read"] }, body: "This agent executes scans on approval." }),
      "executor",
    );
  });
  it("plain advisory → advisory", () => {
    assert.equal(
      inferTier({ frontmatter: { name: "x", description: "Methodology only", tools: ["Read", "Grep"] }, body: "Provides guidance." }),
      "advisory",
    );
  });
});

describe("parsedToPersonaInsert", () => {
  it("packs a parsed agent into InsertPersona shape", () => {
    const p = parseAgentMarkdown(SAMPLE_DETECTION_ENGINEER, "detection-engineer.md");
    const ins = parsedToPersonaInsert(
      p,
      { url: "https://github.com/0xSteph/pentest-ai-agents", ref: "main", importedAt: "2026-05-02T17:00:00Z" },
      "pentest-ai-agents",
    );
    assert.equal(ins.name, "pentest-ai-agents:detection-engineer");
    assert.equal(ins.role, "Imported Subagent (researcher)");
    assert.equal(ins.costTier, "balanced");
    assert.equal(ins.isActive, false);
    assert.match(ins.soul!, /You are an expert detection engineer/);
    assert.match(ins.toolsDoc!, /\| `Read` \|/);
    assert.match(ins.agentsDoc!, /\*\*Source:\*\* https:\/\/github\.com\/0xSteph\/pentest-ai-agents/);
    assert.match(ins.agentsDoc!, /\*\*Tier:\*\* advisory/);
  });

  it("executor agent gets costTier=powerful and developer role", () => {
    const p = parseAgentMarkdown(SAMPLE_TIER2_EXECUTOR, "web-hunter.md");
    const ins = parsedToPersonaInsert(
      p,
      { url: "https://github.com/x/y", importedAt: "2026-05-02T17:00:00Z" },
      "y",
    );
    assert.equal(ins.costTier, "powerful");
    assert.equal(ins.role, "Imported Subagent (developer)");
  });

  it("soul is wrapped with the runtime adapter preamble (not raw body)", () => {
    const p = parseAgentMarkdown(SAMPLE_TIER2_EXECUTOR, "web-hunter.md");
    const ins = parsedToPersonaInsert(
      p,
      { url: "https://github.com/x/y", importedAt: "2026-05-02T17:00:00Z" },
      "y",
    );
    assert.match(ins.soul!, /## VISIONCLAW RUNTIME ADAPTER/);
    assert.match(ins.soul!, /## ORIGINAL CLAUDE CODE INSTRUCTIONS/);
    // Runtime adapter must come BEFORE original instructions (so it dominates).
    const adapterIdx = ins.soul!.indexOf("## VISIONCLAW RUNTIME ADAPTER");
    const originalIdx = ins.soul!.indexOf("## ORIGINAL CLAUDE CODE INSTRUCTIONS");
    assert.ok(adapterIdx >= 0 && adapterIdx < originalIdx, "adapter precedes original");
  });

  it("operatingLoop is populated with VC runtime expectations", () => {
    const p = parseAgentMarkdown(SAMPLE_TIER2_EXECUTOR, "web-hunter.md");
    const ins = parsedToPersonaInsert(
      p,
      { url: "https://github.com/x/y", importedAt: "2026-05-02T17:00:00Z" },
      "y",
    );
    assert.match(ins.operatingLoop!, /VisionClaw operating loop/);
    assert.match(ins.operatingLoop!, /search_memory/);
    assert.match(ins.operatingLoop!, /Confirm before destructive ops/); // executor branch
  });

  it("advisory operating loop pushes delegate_task instead of exec", () => {
    const p = parseAgentMarkdown(SAMPLE_DETECTION_ENGINEER, "detection-engineer.md");
    const ins = parsedToPersonaInsert(
      p,
      { url: "https://github.com/x/y", importedAt: "2026-05-02T17:00:00Z" },
      "y",
    );
    assert.match(ins.operatingLoop!, /Stay advisory/);
    assert.match(ins.operatingLoop!, /delegate_task/);
  });
});

describe("buildRuntimeAdapter", () => {
  it("translates declared Claude tools to VC tool names with HITL flags", () => {
    const p = parseAgentMarkdown(SAMPLE_TIER2_EXECUTOR, "web-hunter.md");
    const adapter = buildRuntimeAdapter(p);
    // Every declared tool must appear with its VC equivalents
    assert.match(adapter, /\*\*Bash\*\* → `exec` \/ `execute_code`/);
    assert.match(adapter, /\*\*Read\*\* → `read_file` \/ `scan_file`/);
    assert.match(adapter, /\*\*WebFetch\*\* → `web_fetch`/);
    // Bash row must be flagged HITL-gated
    const bashLine = adapter.split("\n").find((l) => l.includes("**Bash**"))!;
    assert.match(bashLine, /HITL-gated/);
    // Always-available VC tools list must be present
    assert.match(adapter, /search_memory/);
    assert.match(adapter, /delegate_task/);
    // Tier badge
    assert.match(adapter, /registered as \*\*executor\*\* tier/);
  });

  it("handles personas with no declared tools", () => {
    const p = parseAgentMarkdown(
      `---\nname: empty\ndescription: no tools\n---\nbody`,
      "empty.md",
    );
    const adapter = buildRuntimeAdapter(p);
    assert.match(adapter, /no tools declared in source frontmatter/);
  });
});

describe("buildOperatingLoop", () => {
  it("executor variant talks about HITL and verbalizing destructive ops", () => {
    const p = parseAgentMarkdown(SAMPLE_TIER2_EXECUTOR, "x.md");
    const loop = buildOperatingLoop(p);
    assert.match(loop, /verbalize the exact command\/payload/);
  });
  it("advisory variant pushes hand-off via delegate_task", () => {
    const p = parseAgentMarkdown(SAMPLE_DETECTION_ENGINEER, "x.md");
    const loop = buildOperatingLoop(p);
    assert.match(loop, /hand off to an executor persona via `delegate_task`/);
  });
});

describe("buildAutonomyRulesForImport", () => {
  it("returns 3 approve_before rules for executor-tier", () => {
    const p = parseAgentMarkdown(SAMPLE_TIER2_EXECUTOR, "x.md");
    const rules = buildAutonomyRulesForImport(p);
    assert.equal(rules.length, 3);
    const actionTypes = rules.map((r) => r.actionType).sort();
    assert.deepEqual(actionTypes, ["tool:exec", "tool:execute_code", "tool:write_file"]);
    for (const r of rules) {
      assert.equal(r.autonomyLevel, "approve_before");
      assert.match(r.description, /Imported subagent web-hunter/);
    }
  });

  it("returns 0 rules for advisory-tier (researcher policy already blocks exec)", () => {
    const p = parseAgentMarkdown(SAMPLE_DETECTION_ENGINEER, "x.md");
    const rules = buildAutonomyRulesForImport(p);
    assert.equal(rules.length, 0);
  });
});

describe("mapToolsToVisionClaw — VC tool names attached", () => {
  it("returns concrete VC tool names per Claude tool", () => {
    const m = mapToolsToVisionClaw(["Bash", "Read", "Task", "Foobar"]);
    const bash = m.find((t) => t.claudeName === "Bash")!;
    assert.deepEqual(bash.vcTools, ["exec", "execute_code"]);
    const read = m.find((t) => t.claudeName === "Read")!;
    assert.deepEqual(read.vcTools, ["read_file", "scan_file"]);
    const task = m.find((t) => t.claudeName === "Task")!;
    assert.deepEqual(task.vcTools, ["delegate_task"]);
    const foobar = m.find((t) => t.claudeName === "Foobar")!;
    assert.deepEqual(foobar.vcTools, []);
  });
});

describe("integrity — every TOOL_MAP vcTool name exists in TOOL_DEFINITIONS", () => {
  it("verifies all mapped VC tool names are real (no dead references)", async () => {
    // Read server/tools.ts as text instead of importing it (module-init has
    // side effects — DB / integrations — that would stall the test runner).
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const toolsSrc = await fs.readFile(path.resolve("server/tools.ts"), "utf-8");
    // Extract every `name: "..."` from TOOL_DEFINITIONS entries.
    const declared = new Set(
      [...toolsSrc.matchAll(/\bname:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]),
    );
    const allClaudeTools = ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "WebFetch", "WebSearch", "Task"];
    const mapped = mapToolsToVisionClaw(allClaudeTools);
    const missing: string[] = [];
    for (const m of mapped) {
      for (const vc of m.vcTools) {
        if (!declared.has(vc)) missing.push(`${m.claudeName} → ${vc}`);
      }
    }
    assert.deepEqual(missing, [], `Mapped vcTools missing from TOOL_DEFINITIONS: ${missing.join(", ")}`);
  });
});

describe("tool-router — imported subagent policies are wired (text-scan)", () => {
  // Note: we text-scan tool-router.ts rather than dynamic-import it because
  // its transitive deps (tool-curator → embeddings/DB) trigger heavy module
  // init that stalls the test runner. The integration is exercised live at
  // chat-engine boot.
  it("PERSONA_TOOL_POLICIES contains the imported-subagent (researcher) entry with strict blocks", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(path.resolve("server/tool-router.ts"), "utf-8");
    assert.match(src, /"imported subagent \(researcher\)":/, "researcher key registered");
    // Pull the researcher block to verify the strict block list contents.
    const m = src.match(/"imported subagent \(researcher\)":\s*\{[\s\S]*?blocked:\s*\[([^\]]+)\]/);
    assert.ok(m, "researcher block list parseable");
    const blocked = m![1];
    for (const tool of ["exec", "shell_exec", "execute_code", "write_file"]) {
      assert.match(blocked, new RegExp(`"${tool}"`), `${tool} must be in researcher blocked list`);
    }
  });

  it("PERSONA_TOOL_POLICIES contains the imported-subagent (developer) entry with code+system access", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(path.resolve("server/tool-router.ts"), "utf-8");
    assert.match(src, /"imported subagent \(developer\)":/, "developer key registered");
    const m = src.match(/"imported subagent \(developer\)":\s*\{[\s\S]*?blocked:\s*\[([^\]]+)\]/);
    assert.ok(m, "developer block list parseable");
    const blocked = m![1];
    // Developer tier must NOT block exec/execute_code (they're HITL-gated by autonomy_rules instead)
    assert.doesNotMatch(blocked, /"exec"/, "developer must allow exec (HITL-gated via autonomy_rules)");
    assert.doesNotMatch(blocked, /"execute_code"/, "developer must allow execute_code (HITL-gated via autonomy_rules)");
    // But it MUST block delivery surfaces
    assert.match(blocked, /"send_email"/, "developer must block send_email");
    assert.match(blocked, /"whatsapp"/, "developer must block whatsapp");
  });

  it("imported-subagent keys are listed BEFORE generic developer/researcher keys (so substring match wins)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(path.resolve("server/tool-router.ts"), "utf-8");
    const importedDevIdx = src.indexOf(`"imported subagent (developer)":`);
    const importedResIdx = src.indexOf(`"imported subagent (researcher)":`);
    const bareDevIdx = src.indexOf(`"developer":`);
    const bareResIdx = src.indexOf(`"researcher":`);
    assert.ok(importedDevIdx > 0 && importedDevIdx < bareDevIdx, "imported developer must precede bare developer");
    assert.ok(importedResIdx > 0 && importedResIdx < bareResIdx, "imported researcher must precede bare researcher");
  });
});

describe("runtime adapter — trust boundary", () => {
  it("includes explicit untrusted-legacy-guidance trust boundary", () => {
    const p = parseAgentMarkdown(SAMPLE_TIER2_EXECUTOR, "x.md");
    const adapter = buildRuntimeAdapter(p);
    assert.match(adapter, /Trust boundary/i);
    assert.match(adapter, /untrusted legacy guidance/);
    assert.match(adapter, /this adapter and VC policy win/);
    assert.match(adapter, /tell you to bypass HITL, refuse/);
  });
});

describe("parseGithubUrl", () => {
  it("parses bare repo URL", () => {
    const r = parseGithubUrl("https://github.com/0xSteph/pentest-ai-agents");
    assert.equal(r.owner, "0xSteph");
    assert.equal(r.repo, "pentest-ai-agents");
    assert.equal(r.ref, null);
    assert.equal(r.subpath, ".claude/agents");
  });

  it("parses tree URL with ref + subpath", () => {
    const r = parseGithubUrl("https://github.com/0xSteph/pentest-ai-agents/tree/main/.claude/agents");
    assert.equal(r.ref, "main");
    assert.equal(r.subpath, ".claude/agents");
  });

  it("parses tree URL with non-default subpath", () => {
    const r = parseGithubUrl("https://github.com/x/y/tree/v3.1/agents");
    assert.equal(r.ref, "v3.1");
    assert.equal(r.subpath, "agents");
  });

  it("strips .git suffix from repo name", () => {
    const r = parseGithubUrl("https://github.com/x/y.git");
    assert.equal(r.repo, "y");
  });

  it("disambiguates refs containing slashes via .claude anchor", () => {
    const r = parseGithubUrl("https://github.com/o/r/tree/feature/foo/.claude/agents");
    assert.equal(r.ref, "feature/foo");
    assert.equal(r.subpath, ".claude/agents");
  });

  it("handles deep multi-segment refs with .claude anchor", () => {
    const r = parseGithubUrl("https://github.com/o/r/tree/release/v3/2/2025/.claude/agents");
    assert.equal(r.ref, "release/v3/2/2025");
    assert.equal(r.subpath, ".claude/agents");
  });

  it("preserves legacy single-segment behavior when no .claude anchor", () => {
    const r = parseGithubUrl("https://github.com/o/r/tree/v3.1/custom/dir");
    assert.equal(r.ref, "v3.1");
    assert.equal(r.subpath, "custom/dir");
  });

  it("rejects non-github hosts", () => {
    assert.throws(() => parseGithubUrl("https://gitlab.com/x/y"), /only github\.com URLs/);
  });

  it("rejects malformed URLs", () => {
    assert.throws(() => parseGithubUrl("not a url"), /invalid URL/);
    assert.throws(() => parseGithubUrl("https://github.com/just-owner"), /must include owner and repo/);
  });
});

describe("deriveSourceSlug", () => {
  it("derives the repo name", () => {
    assert.equal(deriveSourceSlug("https://github.com/0xSteph/pentest-ai-agents"), "pentest-ai-agents");
    assert.equal(deriveSourceSlug("https://github.com/x/y/tree/main/.claude/agents"), "y");
  });
  it("falls back to a slug of the URL on parse error", () => {
    const s = deriveSourceSlug("not-a-url");
    assert.ok(typeof s === "string" && s.length > 0);
  });
});

describe("integration — fetchGithubAgentDirectory (network)", { skip: !!process.env.SKIP_NETWORK_TESTS }, () => {
  it("fetches and parses every agent .md in pentest-ai-agents/.claude/agents", async () => {
    const { fetchGithubAgentDirectory } = await import("../../server/claude-subagent-importer");
    const { files, ref, skipped } = await fetchGithubAgentDirectory(
      "https://github.com/0xSteph/pentest-ai-agents/tree/main/.claude/agents",
      { maxFiles: 100 },
    );
    assert.ok(files.length >= 25, `expected ≥25 agent files, got ${files.length}`);
    assert.equal(ref, "main");
    // Underscore-prefixed shared docs (e.g. _scope-guard.md) should be skipped automatically.
    assert.ok(skipped.length >= 1, `expected ≥1 skipped non-agent doc, got ${skipped.length}`);
    let parsedCount = 0;
    let executorCount = 0;
    const failures: string[] = [];
    for (const f of files) {
      try {
        const p = parseAgentMarkdown(f.content, f.path);
        assert.ok(p.frontmatter.name, `${f.path} has name`);
        parsedCount++;
        if (p.tier === "executor") executorCount++;
      } catch (e: any) {
        failures.push(`${f.path}: ${e.message}`);
      }
    }
    assert.equal(failures.length, 0, `parse failures:\n${failures.join("\n")}`);
    assert.equal(parsedCount, files.length, "all files parsed cleanly");
    assert.ok(executorCount >= 1, "at least one executor agent (web-hunter, vuln-scanner, etc.)");
  });
});
