import type { Request, Response, NextFunction } from "express";

const ACCESS_KEY = process.env.RENDER_ACCESS_KEY || "";
const REQUIRE_AUTH = (process.env.RENDER_REQUIRE_AUTH ?? "true") !== "false";

if (REQUIRE_AUTH && !ACCESS_KEY) {
  console.error("[auth] FATAL: RENDER_ACCESS_KEY env var is empty and RENDER_REQUIRE_AUTH is not 'false'. Refusing to start.");
  process.exit(1);
}

export function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  if (!REQUIRE_AUTH) return next();
  const header = req.header("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] !== ACCESS_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
