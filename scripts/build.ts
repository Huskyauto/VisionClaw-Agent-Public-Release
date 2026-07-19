import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import { execSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "passport",
  "passport-local",
  "pg",
  "uuid",
  "ws",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  // Skip dev-data sync during deployment builds — it reads from a DB that may
  // be slow/unreachable from the build runner and isn't needed when shipping
  // the production bundle. Only run during local builds where DATABASE_URL
  // points at the dev DB.
  if (process.env.REPLIT_DEPLOYMENT === "1" || process.env.SKIP_DEV_DATA_SYNC === "1") {
    console.log("[build] skipping dev-data sync (deployment build)");
  } else {
    console.log("syncing dev data for production...");
    try {
      execSync("npx tsx scripts/sync-dev-to-prod.ts", { stdio: "inherit", timeout: 60_000 });
    } catch (e: any) {
      console.log("dev sync skipped (non-fatal):", e.message);
    }
  }

  const snapshotExists = await readFile("dist/dev-data-snapshot.json", "utf-8").catch(() => null);

  await rm("dist", { recursive: true, force: true });

  if (snapshotExists) {
    const { writeFile, mkdir } = await import("fs/promises");
    await mkdir("dist", { recursive: true });
    await writeFile("dist/dev-data-snapshot.json", snapshotExists);
    console.log("preserved dev snapshot through build");
  }

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  // Optional runtime-only modules that are dynamically imported but not in
  // package.json. Without explicit external marking, esbuild tries to bundle
  // them and fails the build. At runtime, the import() is wrapped in try/catch
  // so a missing module degrades the feature gracefully instead of crashing.
  const optionalRuntimeExternals = [
    "@coinbase/cdp-sdk",
  ];
  const externals = [
    ...allDeps.filter((dep) => !allowlist.includes(dep)),
    ...optionalRuntimeExternals,
  ];

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // BWB weekly-recap chain: in prod these run as child processes, but `npx tsx`
  // is unavailable in the deployed image (tsx + esbuild are build-time-only
  // devDeps and get pruned → `ERR_MODULE_NOT_FOUND` for tsx's nested esbuild).
  // Pre-bundle each to dist/<name>.cjs so prod runs them with plain `node`
  // (see scripts/lib/bwb-script-runner.ts); dev still uses tsx from source.
  // NOT minified — readable stack traces in the deployment logs are exactly
  // where BWB render failures get diagnosed.
  console.log("building BWB weekly-recap chain (node-runnable prod bundles)...");
  const bwbChainEntries = [
    "scripts/bwb-weekly-orchestrator.ts",
    "scripts/build-bwb-weekly.ts",
    "scripts/bwb-render-github.ts",
    "scripts/build-bwb-video.ts",
  ];
  for (const entry of bwbChainEntries) {
    const base = entry.split("/").pop()!.replace(/\.ts$/, "");
    await esbuild({
      entryPoints: [entry],
      platform: "node",
      bundle: true,
      format: "cjs",
      outfile: `dist/${base}.cjs`,
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      minify: false,
      external: externals,
      logLevel: "info",
    });
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
