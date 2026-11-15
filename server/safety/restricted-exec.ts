import fs from "node:fs";
import path from "node:path";

type RestrictedCommand =
  | { binary: string; args: string[]; error?: never }
  | { error: string; binary?: never; args?: never };

// Autonomous commands are a small read-only capability, not a configurable
// shell. In particular: no interpreters, recursive traversal, path-valued
// options, response files, output files or program/config loaders.
const OPTIONS: Record<string, RegExp> = {
  cat: /^-[nbsvETA]+$/, ls: /^-[la1hd]+$/, head: /^-[nc]$/,
  tail: /^-[nc]$/, wc: /^-[clwmL]+$/, stat: /^-L$/,
  file: /^-[bL]+$/, du: /^-[sh]+$/, sha256sum: /^-b$/,
  md5sum: /^-b$/, grep: /^-[niFEclv]+$/, sort: /^-[unrf]+$/,
  uniq: /^-[cdu]+$/, diff: /^-[uq]+$/,
};
const NO_FILES = new Set(["echo", "printf", "pwd", "date", "whoami", "uname", "uptime"]);
const SOURCE_DIRS = new Set(["server", "client", "shared", "scripts", "tests", "docs", "public"]);

export function restrictedCommand(command: string, cwd: string): RestrictedCommand {
  const reject = (why: string): RestrictedCommand => ({ error: `Restricted allowlist execution: ${why}` });
  if (typeof command !== "string" || command.length > 4096 ||
      /[$`|;&<>\r\n\0\\]/.test(command)) {
    return reject("shell syntax, expansion and oversized commands are not permitted");
  }
  const tokens: string[] = [];
  let index = 0;
  while (index < command.length) {
    if (/\s/.test(command[index])) { index++; continue; }
    const quote = command[index] === "'" || command[index] === '"' ? command[index++] : null;
    const start = index;
    if (quote) {
      while (index < command.length && command[index] !== quote) index++;
      if (index === command.length) return reject("unclosed quote");
      tokens.push(command.slice(start, index++));
      if (index < command.length && !/\s/.test(command[index])) return reject("ambiguous token");
    } else {
      while (index < command.length && !/\s/.test(command[index])) {
        if (/['"]/.test(command[index])) return reject("ambiguous token");
        index++;
      }
      tokens.push(command.slice(start, index));
    }
  }
  const [binary, ...args] = tokens;
  if (!binary || args.length > 64 || (!Object.hasOwn(OPTIONS, binary) && !NO_FILES.has(binary))) {
    return reject("command is outside the fixed read-only capability");
  }
  const root = fs.realpathSync(process.cwd());
  const contained = (value: string) => value === root || value.startsWith(root + path.sep);
  let realCwd: string;
  try { realCwd = fs.realpathSync(cwd); }
  catch { return reject("working directory unavailable"); }
  if (!contained(realCwd)) return reject("working directory escapes workspace");
  if (NO_FILES.has(binary)) {
    if (!["echo", "printf"].includes(binary) && args.length) return reject("options not permitted");
    return { binary: `/usr/bin/${binary}`, args };
  }
  let patternSeen = false;
  let fileCount = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      if (!OPTIONS[binary].test(arg)) return reject("option not permitted");
      if ((binary === "head" || binary === "tail") && !/^\d{1,5}$/.test(args[++i] ?? "")) {
        return reject("bounded line/byte count required");
      }
      continue;
    }
    if (binary === "grep" && !patternSeen) { patternSeen = true; continue; }
    if (binary === "uniq" && ++fileCount > 1) return reject("uniq output files are not permitted");
    let real: string;
    try { real = fs.realpathSync(path.resolve(realCwd, arg)); }
    catch { return reject("file unavailable"); }
    if (!contained(real)) return reject("file escapes workspace");
    const relative = path.relative(root, real);
    const parts = relative.split(path.sep);
    if (parts.some((part) => part.startsWith(".")) ||
        (relative !== "" && !SOURCE_DIRS.has(parts[0]) &&
          !(parts.length === 1 && /^(package(-lock)?\.json|tsconfig[^/]*\.json|replit\.md|README[^/]*)$/.test(parts[0])))) {
      return reject("file is outside approved source roots");
    }
  }
  return { binary: `/usr/bin/${binary}`, args };
}
