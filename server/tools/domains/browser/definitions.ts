/**
 * Tools-layer-split S12 — browser-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical.
 */

import type { ToolDefinition } from "../../types";

export const browserDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser",
    description: "Control a remote browser via Chrome DevTools Protocol. Each user gets isolated browser sessions. Actions: navigate, screenshot, content, click, type, evaluate, smart_browse (navigate+screenshot+extract in one step), form_fill (fill multiple fields at once), vision_browse (Set-of-Mark: annotate page with numbered marks over all interactable elements + screenshot — use for autonomous visual browsing), vision_act (click/type/hover/select a numbered mark from vision_browse), read_page_md (TEXT-MODE alternative to vision_browse: returns clean Markdown of the page with every interactive element tagged {vc-N}, plus an `ids` map. Cheap and fast — no screenshot, no vision model, no token cost for image bytes. Prefer this over vision_browse when the page is readable text/forms), act_by_id (click/type/hover/select an element by its vc-N tag from read_page_md — uses a [data-vc-id] attribute selector which survives DOM mutations), tabs, snapshot, open_tab, close_tab, focus_tab, wait, pdf, select, health, close_session. Must be enabled in Settings → Browser Tool.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["navigate", "screenshot", "content", "click", "type", "evaluate", "tabs", "snapshot", "open_tab", "close_tab", "focus_tab", "wait", "pdf", "select", "health", "smart_browse", "form_fill", "vision_browse", "vision_act", "scroll_down", "scroll_up", "close_session", "read_page_md", "act_by_id"],
          description: "navigate: go to URL. screenshot: capture page/element. content: extract text. click/type/select: interact with elements. evaluate: run JS. smart_browse: navigate+screenshot+extract content+find links in one step. form_fill: fill multiple form fields at once. vision_browse: AUTONOMOUS VISUAL MODE — injects numbered red marks (Set-of-Mark) over all interactable elements on the page and takes an annotated screenshot. Returns element map with mark numbers, scroll position, visual diff warnings, and overlay detection. Use this + vision_act for goal-oriented autonomous web interaction. vision_act: execute an action on a specific numbered mark from vision_browse (click, type, hover, select). Returns pageChanged boolean — if false, your action had no effect, try something different. scroll_down: scroll viewport down by 80% and re-annotate with SoM (use when target element is below the fold). scroll_up: scroll viewport up by 80% and re-annotate. tabs: list tabs. snapshot: DOM tree. open_tab/close_tab/focus_tab: tab management. wait: pause N ms. pdf: save as PDF. health: check connection. close_session: end your browser session.",
        },
        url: { type: "string", description: "URL (for navigate, open_tab, smart_browse, vision_browse)" },
        selector: { type: "string", description: "CSS selector (for click, type, content, screenshot, select)" },
        text: { type: "string", description: "Text to type (for type action and vision_act type action)" },
        value: { type: "string", description: "Value to select (for select action on <select> elements)" },
        script: { type: "string", description: "JavaScript to evaluate (for evaluate action). No fetch/eval/import." },
        fullPage: { type: "boolean", description: "Full page screenshot (default: false)" },
        returnBase64: { type: "boolean", description: "Include base64 screenshot data in response (for screenshot and vision_browse)" },
        tabIndex: { type: "number", description: "Target tab index (for actions on specific tabs)" },
        ms: { type: "number", description: "Wait duration in milliseconds (for wait action, max 10000)" },
        mark: { type: "number", description: "For vision_act: the mark number from the annotated screenshot to interact with" },
        type: { type: "string", enum: ["click", "type", "hover", "select"], description: "For vision_act and act_by_id: the interaction type to perform on the marked/identified element" },
        vcId: { type: "string", description: "For act_by_id: the vc-N tag from a previous read_page_md call (e.g. 'vc-7')" },
        maxChars: { type: "number", description: "For read_page_md: max characters of markdown to return (default 30000, max 60000)" },
        scrollY: { type: "number", description: "For vision_browse: scroll to Y position before annotating (pixels from top)" },
        profile: { type: "string", description: "Browser profile name (default: uses default profile)" },
        fields: {
          type: "array",
          description: "For form_fill: array of fields to fill. Each has selector, value, and optional type ('type'|'select'|'click')",
          items: {
            type: "object",
            properties: {
              selector: { type: "string" },
              value: { type: "string" },
              type: { type: "string", enum: ["type", "select", "click"] },
            },
            required: ["selector", "value"],
          },
        },
      },
      required: ["action"],
    },
  },
};

export const stealthBrowseCamofoxDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "stealth_browse_camofox",
    description: "Browse websites using Camofox — a Camoufox-based stealth browser microservice (Firefox fork with C++-level fingerprint spoofing for navigator.hardwareConcurrency, WebGL, AudioContext, screen geometry, WebRTC). Bypasses Cloudflare, Google bot detection, and most anti-scraping systems where stealth_browse (Rayobrowse/Browserless) still gets blocked. Returns token-efficient accessibility snapshots with stable element refs (e1, e2, e3) instead of raw HTML — use refs to click/type. Sessions persist per-tenant cookies/localStorage so authenticated browsing across calls works automatically. Actions: open (new tab at URL), snapshot (re-read accessibility tree), navigate (existing tab to new URL), click (by ref), type (by ref), scroll, screenshot, extract (structured data via JSON Schema with x-ref), list_tabs, close_tab, close_session.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["open", "snapshot", "navigate", "click", "type", "scroll", "screenshot", "extract", "list_tabs", "close_tab", "close_session"],
          description: "open: launch new tab at url (returns tabId + accessibility snapshot with refs). snapshot: re-read snapshot of an existing tab. navigate: send existing tab to new url. click/type: act on element by ref (e.g. 'e3'). scroll: direction up/down/left/right. screenshot: base64 PNG. extract: JSON-Schema-driven structured extraction. list_tabs/close_tab/close_session: housekeeping.",
        },
        url: { type: "string", description: "URL to load (open or navigate)" },
        tabId: { type: "string", description: "Tab identifier returned from a prior open call (required for snapshot/navigate/click/type/scroll/screenshot/extract/close_tab)" },
        ref: { type: "string", description: "Element ref from the accessibility snapshot, e.g. 'e3' (required for click/type)" },
        text: { type: "string", description: "Text to type (for type action)" },
        direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction (default: down)" },
        amount: { type: "number", description: "Scroll amount in pixels (optional)" },
        schema: { type: "object", description: "JSON Schema with x-ref hints for the extract action" },
        sessionKey: { type: "string", description: "Optional sub-session key to isolate distinct workflows for the same tenant (e.g. 'login', 'scrape-job-42')" },
        userIdSuffix: { type: "string", description: "Optional suffix appended to the per-tenant session userId for further isolation (e.g. persona name)" },
        trace: { type: "boolean", description: "On open: capture a full Playwright trace zip for this session (download via Camofox /sessions/:userId/traces). Default: false." },
      },
      required: ["action"],
    },
  },
};

export const browserWorkflowDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "browser_workflow",
    description: "Save and manage reusable browser workflow templates. Records step-by-step browser instructions as named workflows that can be stored, listed, replayed, and deleted. Steps are natural language descriptions of browser actions. On replay, the workflow visits the starting URL and logs each step execution. Inspired by BrowserWing's record-and-replay paradigm. Use to create reusable browser task checklists, store multi-step web procedures, or build a library of common browser operations.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["record", "replay", "list", "delete"], description: "'record' captures a new workflow, 'replay' executes a saved one, 'list' shows all saved workflows, 'delete' removes one" },
        name: { type: "string", description: "Name for the workflow (required for record/replay/delete)" },
        url: { type: "string", description: "Starting URL (required for 'record')" },
        steps: { type: "array", items: { type: "string" }, description: "Natural language steps to record. e.g. ['Click Login', 'Type username', 'Click Submit']" },
        workflow_id: { type: "number", description: "ID of saved workflow to replay or delete" },
      },
      required: ["action"],
    },
  },
};

export const stealthBrowseDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "stealth_browse",
    description: "Browse websites using Rayobrowse stealth browser — a fingerprint-spoofing Chromium that bypasses bot detection, CAPTCHAs, and anti-scraping systems. Unlike standard headless Chrome, Rayobrowse spoofs WebGL, fonts, timezone, screen resolution, user agent, and dozens of other signals to appear as a real user on a real device. Use this tool when: (1) a website blocks standard browser/scraping tools, (2) you need to access bot-protected content, (3) you need to interact with sites that detect automation, (4) standard web_fetch or browser tools return blocked/captcha responses. Falls back to standard browser if Rayobrowse is not configured. Actions: navigate, screenshot, content, click, type, smart_browse, form_fill, close_session.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["navigate", "screenshot", "content", "click", "type", "smart_browse", "form_fill", "close_session"],
          description: "navigate: go to URL with stealth fingerprint. screenshot: capture page. content: extract text content. click: click element. type: type into element. smart_browse: navigate+screenshot+extract in one step. form_fill: fill multiple form fields. close_session: end stealth session.",
        },
        url: { type: "string", description: "URL to navigate to (for navigate, smart_browse)" },
        selector: { type: "string", description: "CSS selector for click/type/form_fill actions" },
        text: { type: "string", description: "Text to type (for type action)" },
        fields: { type: "object", description: "Key-value pairs of selector:value for form_fill" },
        extract: { type: "string", description: "What to extract from the page (for smart_browse). Default: main content" },
      },
      required: ["action"],
    },
  },
};

export const siteLoginDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "site_login",
    description: "Log into a website using credentials stored in the Credential Vault. Navigates to the site, finds the login form, auto-fills username/password from the vault, and submits. If no vault entry exists for the site, returns an error asking the user to add credentials first. Supports password-based logins. For OAuth/SSO logins, use the browser tool directly after retrieving credentials.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The login page URL to authenticate on" },
        usernameSelector: { type: "string", description: "Optional CSS selector for the username/email field. Auto-detected if omitted." },
        passwordSelector: { type: "string", description: "Optional CSS selector for the password field. Auto-detected if omitted." },
        submitSelector: { type: "string", description: "Optional CSS selector for the submit/login button. Auto-detected if omitted." },
      },
      required: ["url"],
    },
  },
};

export const browserDomainDefinitions: ToolDefinition[] = [
  browserDefinition,
  stealthBrowseCamofoxDefinition,
  browserWorkflowDefinition,
  stealthBrowseDefinition,
  siteLoginDefinition,
];
