import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const projectsPage = fs.readFileSync(path.join(root, "client/src/pages/projects.tsx"), "utf8");
const chatPage = fs.readFileSync(path.join(root, "client/src/pages/chat.tsx"), "utf8");
const projectsRoutes = fs.readFileSync(path.join(root, "server/routes/projects.ts"), "utf8");
const conversationsRoutes = fs.readFileSync(path.join(root, "server/routes/conversations.ts"), "utf8");

test("revenue Start working uses one atomic owner-only server handoff and only drafts the prompt", () => {
  assert.match(projectsPage, /\/api\/projects\/\$\{selectedProject\}\/revenue-ideas\/\$\{encodeURIComponent\(idea\.slug\)\}\/conversation/);
  assert.match(projectsPage, /navigate\(`\/chat\/\$\{data\.id\}\?draft=\$\{encodeURIComponent\(idea\.starterPrompt\)\}`\)/);
  assert.doesNotMatch(projectsPage, /revenue-ideas[\s\S]{0,1000}\?prompt=/);
  assert.match(projectsRoutes, /pg_advisory_xact_lock/);
  assert.match(projectsRoutes, /conversationKey/);
  assert.match(projectsRoutes, /INSERT INTO project_conversations/);
  assert.match(projectsRoutes, /tenantId !== ADMIN_TENANT_ID/);
});

test("revenue draft handoff pre-fills without calling sendMessage", () => {
  const draftSetup = chatPage.match(
    /const hasAppliedDraft[\s\S]*?\}, \[conv\]\);/
  )?.[0] || "";
  const draftCleanup = chatPage.match(
    /useEffect\(\(\) => \{\s*if \(!pendingDraftUrlCleanup\.current[\s\S]*?window\.history\.replaceState\(\{\}, "", window\.location\.pathname\);[\s\S]*?\}, \[input\]\);/
  )?.[0] || "";
  assert.match(draftSetup, /draftParam/);
  assert.match(draftSetup, /setInput\(draftParam\)/);
  assert.match(draftSetup, /pendingDraftUrlCleanup\.current = draftParam/);
  assert.match(draftCleanup, /input !== pendingDraftUrlCleanup\.current/);
  assert.match(draftCleanup, /window\.history\.replaceState/);
  assert.doesNotMatch(`${draftSetup}\n${draftCleanup}`, /sendMessage\(/);
});

test("revenue conversation identity cannot be renamed away from its workspace key", () => {
  assert.match(conversationsRoutes, /conv\.title\.startsWith\("Revenue idea \["\)/);
  assert.match(conversationsRoutes, /workspace titles are fixed for reliable reuse/);
});

test("revenue idea actions meet the mobile touch-target minimum", () => {
  const revenueCards = projectsPage.slice(
    projectsPage.indexOf("function renderRevenueIdeaCard"),
    projectsPage.indexOf("function renderProjectCard")
  );
  assert.equal((revenueCards.match(/min-h-11 px-4/g) || []).length, 3);
});