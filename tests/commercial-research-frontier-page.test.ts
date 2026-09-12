import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildResearchFrontierListUrl,
  buildResearchFrontierMutationRequest,
  clampResearchFrontierPage,
} from "../client/src/lib/commercial-research-frontier";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Research Frontier is discoverable only to the platform owner when enabled", () => {
  const app = read("client/src/App.tsx");
  const sidebar = read("client/src/components/app-sidebar.tsx");
  const siteConfig = read("server/site-config.ts");
  const siteConfigHook = read("client/src/hooks/use-site-config.ts");

  assert.match(siteConfig, /researchFrontierEnabled:\s*env\.RESEARCH_FRONTIER_ENABLED\s*===\s*"1"/);
  assert.match(siteConfigHook, /researchFrontierEnabled:\s*boolean/);
  assert.match(siteConfigHook, /researchFrontierEnabled:\s*false/);
  assert.match(app, /isPlatformAdmin\s*&&\s*config\.researchFrontierEnabled/);
  assert.match(app, /path="\/admin\/research-frontier"/);
  assert.match(sidebar, /isPlatformAdmin\s*&&\s*config\.researchFrontierEnabled/);
  assert.match(sidebar, /path="\/admin\/research-frontier"/);
});

test("Research Frontier workspace provides real portfolio discovery and editing states", () => {
  const page = read("client/src/pages/admin-research-frontier.tsx");

  for (const contract of [
    "/api/admin/research-frontier/opportunities",
    "Search opportunities",
    "Maturity",
    "Lifecycle",
    "Evidence",
    "Smallest next test",
    "Score explanation",
    "Create opportunity",
    "Save changes",
    "No opportunities yet",
    "Try again",
  ]) {
    assert.match(page, new RegExp(contract, "i"));
  }

  assert.match(page, /useQuery/);
  assert.match(page, /useMutation/);
  assert.match(page, /buildResearchFrontierMutationRequest/);
  assert.match(page, /apiRequest\(request\.method,\s*request\.url,\s*request\.body\)/);
  assert.match(page, /setTimeout\(\(\)\s*=>\s*setDebouncedSearch\(search\),\s*350\)/);
  assert.match(page, /queryKey:\s*\[BASE,\s*debouncedSearch,\s*maturity,\s*status,\s*page\]/);
  assert.match(page, /overflow-y-auto/);
  assert.match(page, /opportunityScore/);
  assert.match(page, /positiveTotal/);
  assert.match(page, /riskTotal/);
});

test("Research Frontier list URLs omit blank enum filters", () => {
  const base = "/api/admin/research-frontier/opportunities";
  assert.equal(
    buildResearchFrontierListUrl(base, { page: 1, limit: 20, search: "", maturity: "", status: "" }),
    `${base}?page=1&limit=20`,
  );
  assert.equal(
    buildResearchFrontierListUrl(base, {
      page: 2,
      limit: 20,
      search: "  clinic readiness  ",
      maturity: "pilot-ready",
      status: "active",
    }),
    `${base}?page=2&limit=20&q=clinic+readiness&maturity=pilot-ready&status=active`,
  );
});

test("Research Frontier pagination returns to the last available page", () => {
  assert.equal(clampResearchFrontierPage(4, 45, 20), 3);
  assert.equal(clampResearchFrontierPage(2, 0, 20), 1);
  assert.equal(clampResearchFrontierPage(0, 100, 20), 1);
});

test("Research Frontier create mode includes idempotency even while the form is editing", () => {
  const create = buildResearchFrontierMutationRequest("/opportunities", {
    editing: true,
    selectedId: null,
    payload: { title: "New opportunity" },
    idempotencyKey: "create-key",
  });
  assert.deepEqual(create, {
    method: "POST",
    url: "/opportunities",
    body: { title: "New opportunity", idempotencyKey: "create-key" },
  });

  const update = buildResearchFrontierMutationRequest("/opportunities", {
    editing: true,
    selectedId: 42,
    payload: { title: "Updated opportunity" },
    idempotencyKey: "unused-key",
  });
  assert.deepEqual(update, {
    method: "PATCH",
    url: "/opportunities/42",
    body: { title: "Updated opportunity" },
  });
});

test("Research Frontier remains decision support with no consequential action controls", () => {
  const page = read("client/src/pages/admin-research-frontier.tsx");

  assert.doesNotMatch(page, /apiRequest\("(?:POST|PATCH)",\s*"\/api\/(?:missions|payments|outreach|email|social|publish|trading)/);
  assert.match(page, /decision support/i);
  assert.match(page, /does not send outreach, collect payment, create missions, publish, or trade/i);
});