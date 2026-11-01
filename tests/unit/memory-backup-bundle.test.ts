import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { memoryBackupCommand } from "../../server/lib/memory-backup-runner";

test("the actual backup entry runs under plain Node with isolated transports and private uploads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-backup-offline-"));
  const bundle = join(dir, "dist/nightly-memory-backup.cjs");
  try {
    await build({
      entryPoints: [resolve("scripts/nightly-memory-backup.ts")],
      outfile: bundle, platform: "node", format: "cjs", bundle: true, logLevel: "silent",
      plugins: [{
        name: "offline-backup-transports",
        setup(builder) {
          builder.onResolve({ filter: /(?:server\/db|shared\/schema|server\/google-drive)$/ }, args => ({
            path: args.path, namespace: "offline-backup",
          }));
          builder.onLoad({ filter: /.*/, namespace: "offline-backup" }, args => ({
            contents: args.path.endsWith("/db") ? `
              export const db = {select: () => ({from: async () => {
                if(process.env.BACKUP_FIXTURE_CASE === 'db_failed') throw new Error('fixture database unavailable');
                return [{id:1,tenantId:1,fact:'synthetic one',embedding:[1],embeddingVec:[2]},
                  {id:2,tenantId:2,fact:'synthetic two',embedding_vec:[3]}];
              }})};
            ` : args.path.endsWith("/schema") ? "export const memoryEntries = {};" : `
              import assert from 'node:assert/strict';
              export async function uploadAndShare(options) {
                assert.equal(options.share,false);
                assert.equal(options.tenantId,1);
                assert.equal(options.folderLabel,'__VisionClaw-Admin-Backups__/');
                assert.ok(options.fileName.startsWith('__admin-memory-backup-'));
                const data=JSON.parse(options.fileData.toString());
                assert.equal(data.rowCount,2);
                assert.deepEqual(data.rows.map(row=>row.tenantId),[1,2]);
                for(const row of data.rows) for(const key of ['embedding','embeddingVec','embedding_vec'])
                  assert.equal(Object.hasOwn(row,key),false);
                if(process.env.BACKUP_FIXTURE_CASE==='upload_failed') return {success:false,error:'fixture upload unavailable'};
                return {success:true,fileId:'fixture-new',folderUrl:'https://drive.google.com/drive/folders/fixture-folder'};
              }
              export async function listDriveFiles(options) {
                assert.equal(options.folderId,'fixture-folder');
                if(process.env.BACKUP_FIXTURE_CASE==='pruned_failed') return {success:false,error:'fixture listing unavailable'};
                return {success:true,files:[
                  {id:'fixture-new',name:'__admin-memory-backup-new.json',createdTime:'2000-01-01'},
                  {id:'fixture-old',name:'__admin-memory-backup-old.json',createdTime:'2000-01-01'},
                  {id:'unrelated',name:'unrelated.json',createdTime:'2000-01-01'}]};
              }
              export async function deleteDriveFile(id) {
                assert.equal(id,'fixture-old');return {success:true};
              }
            `,
            loader: "js",
          }));
        },
      }],
    });
    const denyNetwork = join(dir, "deny-network.cjs");
    await writeFile(denyNetwork, `
      const deny=()=>{throw new Error('Offline backup test attempted network access')};
      const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;
      require('node:tls').connect=deny;globalThis.fetch=deny;
    `);
    const runner = memoryBackupCommand({ production: true, cwd: dir });
    for (const [status, exit] of [["ok", 0], ["db_failed", 2], ["upload_failed", 3], ["pruned_failed", 4]] as const) {
      const child = spawnSync(runner.command, ["--require", denyNetwork, ...runner.args], {
        timeout: 10_000,
        env: { NODE_ENV: "production", BACKUP_FIXTURE_CASE: status },
        encoding: "utf8",
      });
      assert.equal(child.status, exit, child.stderr);
      const summary = JSON.parse(child.stdout.trim());
      assert.equal(summary.status, status);
      if (status === "ok") {
        assert.equal(summary.rowCount, 2);
        assert.equal(summary.prunedCount, 1);
        assert.equal(summary.driveFileId, "fixture-new");
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
