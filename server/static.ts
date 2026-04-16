import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  const deliverablesPath = path.resolve(process.cwd(), "deliverables");
  if (fs.existsSync(deliverablesPath)) {
    app.use("/deliverables", express.static(deliverablesPath));
  }

  app.use("/{*path}", (_req, res) => {
    if (_req.originalUrl.startsWith("/deliverables/")) {
      res.status(404).send("Not found");
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
