import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** One-time local handoff only; never print or publish the credential values. */
export function savePrivateOAuthCredentials(credentials, workspace = process.cwd()) {
  const local = path.join(workspace, ".local");
  const directory = path.join(local, "private-oauth");
  for (const parent of [local, directory]) {
    try {
      fs.mkdirSync(parent, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Private OAuth output parent must be a real directory");
    }
  }
  fs.chmodSync(directory, 0o700);
  const output = path.join(directory, `youtube-${randomUUID()}.json`);
  fs.writeFileSync(output, JSON.stringify(credentials, null, 2), { flag: "wx", mode: 0o600 });
  return output;
}
