import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import {
  HOME_RELEASES,
  HOME_VISIBLE_RELEASE_COUNT,
  HomeReleaseUpdates,
  ReleaseCard,
  releaseId,
} from "../client/src/components/home-release-updates";

function isVisible(element: Element) {
  return !element.closest(".hidden");
}

test("rendered home shows three current releases and reveals every older release", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const rootElement = dom.window.document.getElementById("root");
  assert.ok(rootElement);
  const root = createRoot(rootElement);
  const expanded = new Set<string>();
  const toggleRelease = (id: string) => {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
  };

  await act(async () => {
    root.render(
      <>
        {HOME_RELEASES.slice(0, HOME_VISIBLE_RELEASE_COUNT).map((release) => (
          <ReleaseCard
            key={release.version}
            release={release}
            releaseExpanded={expanded}
            toggleRelease={toggleRelease}
          />
        ))}
        <HomeReleaseUpdates releaseExpanded={expanded} toggleRelease={toggleRelease} />
      </>,
    );
  });

  const releaseButtons = () => [...rootElement.querySelectorAll<HTMLButtonElement>('[data-testid^="banner-whats-new-"]')];
  assert.deepEqual(
    releaseButtons().filter(isVisible).map((button) => button.dataset.testid),
    HOME_RELEASES.slice(0, 3).map((release) => releaseId(release.version)),
  );

  const archiveToggle = rootElement.querySelector<HTMLButtonElement>('[data-testid="button-toggle-all-updates"]');
  assert.ok(archiveToggle);
  await act(async () => {
    archiveToggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  assert.equal(releaseButtons().filter(isVisible).length, HOME_RELEASES.length);
  assert.equal(archiveToggle.getAttribute("aria-expanded"), "true");

  await act(async () => root.unmount());
  dom.window.close();
});