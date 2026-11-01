import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";

// Render the real static preparation page, without bypassing app authentication.
// No app server, database, credentials or external providers are used.
test("decision package fits phone widths without clipping or sideways scrolling", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "decision-mobile-"));
  const browser = await chromium.launch({
    headless: true, channel: "chromium",
    executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
    args: ["--no-sandbox"],
  });
  try {
    await build({
      stdin: {
        contents: `import React from "react"; import {createRoot} from "react-dom/client";
          import Page from "./client/src/pages/admin-ai-stack-decision-review";
          createRoot(document.getElementById("root")).render(<Page/>);`,
        resolveDir: process.cwd(), loader: "tsx",
      },
      bundle: true, outfile: path.join(dir, "page.js"), platform: "browser",
      jsx: "automatic", alias: { "@": path.resolve("client/src") },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    execFileSync(path.resolve("node_modules/.bin/tailwindcss"), [
      "-i", "client/src/index.css", "-o", path.join(dir, "page.css"),
      "--content", "client/src/pages/admin-ai-stack-decision-review.tsx,client/src/components/ui/{button,badge,card}.tsx",
    ], { stdio: "pipe" });
    await writeFile(path.join(dir, "index.html"), `<!doctype html><html class="dark">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="page.css">
      <body><div style="display:flex;height:100vh;overflow:hidden">
      <main style="flex:1;overflow:hidden"><div id="root" style="height:100%"></div></main>
      </div><script src="page.js"></script></body></html>`);
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of [320, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`file://${path.join(dir, "index.html")}`);
      const docs = page.getByRole("navigation", { name: "Decision review documents" }).getByRole("button");
      await docs.first().waitFor();
      assert.equal(await docs.count(), 8);
      for (let i = 0; i < 8; i++) {
        await docs.nth(i).click();
        const overflow = await page.evaluate(() => {
          const shell = document.querySelector(".decision-review-page")!;
          return [shell, ...shell.querySelectorAll("*")].filter((node) => {
            const el = node as HTMLElement;
            const style = getComputedStyle(el);
            if (style.display === "none" || !el.getClientRects().length) return false;
            // Ignore deliberately clipped decorative circles and hidden table headers.
            if (el.tagName === "HEADER" || el.classList.contains("pointer-events-none") || el.closest("thead")?.clientWidth === 1) return false;
            return el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2;
          }).map((el) => `${el.tagName}.${el.className}: ${el.clientWidth}/${el.scrollWidth}`);
        });
        assert.deepEqual(overflow, [], `width ${width}, document ${i}: overflowing elements`);
        const scroller = page.locator("#root > div");
        const scroll = await scroller.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
          return { top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight };
        });
        assert.ok(scroll.top > 0 || scroll.height <= scroll.viewport, "vertical scrolling must work");
      }
      console.log(`Verified ${width}px: all 8 documents fit and scroll vertically`);
    }
    assert.deepEqual(errors, []);
    assert.ok((await readFile(path.join(dir, "page.css"), "utf8")).length > 0);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
