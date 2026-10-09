import type { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { createWorkbenchStore } from "../lib/browser-workbench-store";
import { LibraryError } from "../lib/browser-workbench-library";

/** Mounted AFTER the workspace's authenticated-human, rate and no-store guards. */
export function registerWorkbenchLibraryRoutes(router: Router) {
  const store = createWorkbenchStore(pool);
  router.get("/library", async (_req, res) => {
    try {
      const tid = res.locals.workspaceTenant;
      res.json(await store.view(tid, await store.read(tid)));
    } catch {
      console.error("[browser-workbench] Library read failed");
      res.status(503).json({ error: "Browser files are unavailable. No changes were made." });
    }
  });
  const save = (upload: boolean): import("express").RequestHandler => async (req, res) => {
    try {
      const tid = res.locals.workspaceTenant;
      const state = await store.mutate(tid, req.body, upload);
      // The committed state is authoritative. Do not report save failure because
      // subsequent optional metadata enrichment failed.
      try { res.json(await store.view(tid, state)); }
      catch {
        res.json({ revision: state.revision, folders: state.folders,
          files: state.files.map(f => ({ ...f, available: false, mimeType: "", size: 0 })),
          warning: "Saved. File availability could not be refreshed; refresh before downloading." });
      }
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Check the name, folder and file selection." });
      if (error instanceof LibraryError) return res.status(error.status).json({ error: error.message });
      console.error("[browser-workbench] Library save failed");
      res.status(503).json({ error: "Save could not be confirmed. Refresh before trying again." });
    }
  };
  router.post("/library", save(false));
  router.post("/library/upload", save(true));
}