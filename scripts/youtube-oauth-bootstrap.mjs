#!/usr/bin/env node
/**
 * Built With Bob — YouTube OAuth bootstrap.
 *
 * Usage:  node youtube-oauth-bootstrap.mjs ./client_secret_xxxxx.json
 *
 * Reads a Google OAuth "Desktop app" client_secret JSON, runs a one-shot
 * loopback OAuth flow, exchanges the auth code for a refresh token, and
 * saves a private local credential handoff without printing its values.
 *
 * Requires: `npm install -g googleapis open` (or run in a folder with them).
 */
import fs from "node:fs";
import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";
import open from "open";
import { savePrivateOAuthCredentials } from "./lib/private-oauth-output.mjs";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

const path = process.argv[2];
if (!path) {
  console.error("Usage: node youtube-oauth-bootstrap.mjs <client_secret.json>");
  process.exit(1);
}
if (!fs.existsSync(path)) {
  console.error(`File not found: ${path}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(path, "utf8"));
const cfg = raw.installed || raw.web;
if (!cfg || !cfg.client_id || !cfg.client_secret) {
  console.error("client_secret JSON is missing client_id/client_secret. Did you download a Desktop OAuth client?");
  process.exit(1);
}

const PORT = 53217; // arbitrary unused localhost port
const REDIRECT = `http://localhost:${PORT}`;

const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces refresh_token to be issued every time
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, REDIRECT);
    const code = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    if (err) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(`OAuth error: ${err}`);
      console.error(`OAuth error: ${err}`);
      server.close();
      process.exit(1);
    }
    if (!code) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Missing code in callback");
      return;
    }
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body style="font-family:system-ui;padding:40px;text-align:center">
      <h2>Done. You can close this tab.</h2>
      <p>Credentials captured. Check the terminal for the private handoff location.</p>
    </body></html>`);
    server.close();

    if (!tokens.refresh_token) {
      console.error("\nNo refresh_token returned. Re-run the script — Google only issues one on first consent. Workaround:");
      console.error("  https://myaccount.google.com/permissions  →  remove 'Built With Bob Uploader'  →  re-run this script.");
      process.exit(1);
    }

    const output = savePrivateOAuthCredentials({
      YOUTUBE_CLIENT_ID: cfg.client_id,
      YOUTUBE_CLIENT_SECRET: cfg.client_secret,
      YOUTUBE_REFRESH_TOKEN: tokens.refresh_token,
    });
    console.log(`Credentials saved to private local file: ${output}`);
    console.log("Use the secure Secrets fields to configure these values, then delete the handoff file.");
    console.log("Never paste credential values into chat, logs, GitHub, or shared files.");
    process.exit(0);
  } catch (e) {
    console.error("OAuth setup failed; credential values and provider error details were withheld.");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, async () => {
  console.log(`\nOpening browser for Google OAuth consent...`);
  console.log(`If it doesn't open automatically, visit this URL manually:\n`);
  console.log(authUrl);
  console.log(`\n(Listening on ${REDIRECT} — leave this terminal running until you see "Done. You can close this tab.")\n`);
  try { await open(authUrl); } catch { /* user will paste manually */ }
});
