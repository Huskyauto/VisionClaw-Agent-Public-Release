/**
 * Development-only deterministic integration check. No provider calls, no owner
 * conversations changed. Test-only threads/rows are removed in finally.
 */
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { ownerTenantId } from "../server/agentic/autonomous-budget";
import { ensureFelixConnectorSchema } from "../server/felix-connector/schema";
import * as line from "../server/felix-connector/service";
import { listSparkMessages, sendSparkMessage } from "../server/spark-line";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildFelixMcpServer } from "../server/felix-connector/mcp";
import { FELIX_TOOLS } from "../server/felix-connector/policy";
import { FelixOAuthProvider } from "../server/felix-connector/oauth";
import { postgresOAuthStore } from "../server/felix-connector/records";

if (process.env.NODE_ENV === "production") throw new Error("Development fixtures only");
const tenantId = ownerTenantId(), prefix = `connector-test-${randomUUID()}`;
const ids: number[] = [];
const clients = [`${prefix}-a`, `${prefix}-b`];
const outboxIds: number[] = [];
let testServer: McpServer | undefined, testClient: Client | undefined;
try {
  await ensureFelixConnectorSchema();
  const a = await line.ensureClientThread(clients[0], tenantId); ids.push(a.conversationId);
  const b = await line.ensureClientThread(clients[1], tenantId); ids.push(b.conversationId);
  assert.notEqual(a.conversationId, 620);
  assert.notEqual(a.conversationId, b.conversationId);
  assert.equal((await line.ensureClientThread(clients[0], tenantId)).conversationId, a.conversationId);
  await assert.rejects(() => line.clientBinding(clients[0], tenantId + 1), /owner_required/);
  let launches = 0;
  const noInference: any = () => { launches++; };
  const input = {message: "Deterministic connector check. No actions.", idempotency_key: randomUUID()};
  const sent = await Promise.all(Array.from({length: 3}, () => line.sendMessage(a, input, noInference)));
  assert.equal(launches, 1);
  assert.equal(new Set(sent.map(s => s.requestId)).size, 1);
  await assert.rejects(() => line.sendMessage(a, {...input, message: "Different bytes"}, noInference), /mismatch/);
  await assert.rejects(() => line.sendMessage(a, {...input, idempotency_key: randomUUID()}, noInference), /busy/);
  await assert.rejects(() => line.getTurn(b, sent[0].requestId), /not_found/);
  // Simulate a provider-free terminal completion in this fixture only.
  const rawReply = "<think>Private fixture reasoning</think>\n\nDeterministic fixture reply";
  await db.execute(sql`INSERT INTO messages (tenant_id,conversation_id,role,content)
    VALUES (${tenantId},${a.conversationId},'assistant',${rawReply})`);
  await db.execute(sql`UPDATE api_v1_conversation_runs SET status='complete',completed_reply=${rawReply},
    resolved_model='route-fixture',observed_model='provider-fixture' WHERE tenant_id=${tenantId} AND conversation_id=${a.conversationId}`);
  const complete = await line.getTurn(a, sent[0].requestId);
  assert.equal(complete.status, "complete");
  assert.equal(complete.observedModel, "provider-fixture");
  assert.equal(complete.reply.content, "Deterministic fixture reply");
  assert.equal((await line.getThread(a)).lastAssistantMessage.content.content, "Deterministic fixture reply");
  assert.equal((await line.listMessages(a)).messages[0].content.content, "Deterministic fixture reply");
  // Old receipts must also be filtered on read, without rewriting retained evidence.
  const legacyResult = {...complete,reply:{author:"felix",untrusted:true,content:rawReply}};
  await db.execute(sql`UPDATE felix_line_turns SET result=${JSON.stringify(legacyResult)}::jsonb
    WHERE tenant_id=${tenantId} AND client_id=${a.clientId} AND request_id=${sent[0].requestId}`);
  assert.equal((await line.getTurn(a, sent[0].requestId)).reply.content, "Deterministic fixture reply");
  const retained:any = await db.execute(sql`SELECT result FROM felix_line_turns
    WHERE tenant_id=${tenantId} AND client_id=${a.clientId} AND request_id=${sent[0].requestId}`);
  assert.equal(retained.rows[0].result.reply.content,rawReply);
  const userText = "Please explain literal <think>example</think> tags.";
  await db.execute(sql`INSERT INTO messages (tenant_id,conversation_id,role,content)
    VALUES (${tenantId},${a.conversationId},'user',${userText})`);
  assert.equal((await line.getThread(a)).lastUserMessage.content,userText);
  await line.sendMessage(a, {...input, idempotency_key: randomUUID()}, noInference);
  assert.equal((await line.getTurn(a, sent[0].requestId)).observedModel, "provider-fixture");
  assert.equal((await line.getTurn(a, sent[0].requestId)).reply.content, "Deterministic fixture reply");
  await db.execute(sql`UPDATE api_v1_conversation_runs SET status='failed',failure_reason='timeout'
    WHERE tenant_id=${tenantId} AND conversation_id=${a.conversationId}`);
  await assert.rejects(() => line.sendMessage(a, {...input, idempotency_key: randomUUID()}, noInference), /timed out/);
  assert.equal((await line.sendMessage(a, input, noInference)).requestId, sent[0].requestId);
  await db.execute(sql`UPDATE api_v1_conversation_runs SET status='idle',failure_reason=NULL
    WHERE tenant_id=${tenantId} AND conversation_id=${a.conversationId}`);
  for (let i=0;i<8;i++) await db.execute(sql`INSERT INTO felix_line_turns
    (request_id,tenant_id,client_id,conversation_id,idempotency_key,message_hash,result)
    VALUES (${randomUUID()},${tenantId},${a.clientId},${a.conversationId},${randomUUID()},'fixture','{"status":"complete"}'::jsonb)`);
  await assert.rejects(() => line.sendMessage(a, {...input, idempotency_key: randomUUID()}, noInference), /rate_limit/);
  assert.equal((await line.sendMessage(a, input, noInference)).requestId, sent[0].requestId);
  // Synthetic addressed rows avoid spending or touching existing outbox limits.
  const out: any = await db.execute(sql`INSERT INTO spark_outbox (tenant_id,persona_id,conversation_id,message,recipient)
    VALUES (${tenantId},2,${a.conversationId},'<thinking>Private outbox reasoning</thinking>Addressed to fixture A','claude'),
      (${tenantId},2,${b.conversationId},'Addressed to fixture B','claude') RETURNING id`);
  outboxIds.push(...out.rows.map((r: any) => r.id));
  await assert.rejects(() => line.ackOutbox(a, outboxIds[0]), /not_delivered/);
  const pending = await line.checkOutbox(a);
  assert.equal(pending.messages.length, 1);
  assert.equal(pending.messages[0].id, outboxIds[0]);
  assert.equal(pending.messages[0].message.untrusted, true);
  assert.equal(pending.messages[0].message.content, "Addressed to fixture A");
  await assert.rejects(() => line.ackOutbox(a, outboxIds[1]), /not_delivered/);
  await line.ackOutbox(a, pending.latestId);
  assert.equal((await line.checkOutbox(a)).messages.length, 0);
  await assert.rejects(() => line.ackOutbox(a, 0), /regressed/);
  const spark = await listSparkMessages(tenantId, outboxIds[0]-1);
  assert.ok(spark.messages.every(m => !outboxIds.includes(m.id)));
  // MCP protocol proof with no network/auth shortcuts and no model calls.
  testServer = buildFelixMcpServer({token: "fixture-not-a-credential", clientId: clients[0],
    scopes: ["felix:read"], extra: {tenantId}});
  testClient = new Client({name: "fixture-inspector", version: "1.0"});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([testServer.connect(serverTransport), testClient.connect(clientTransport)]);
  const tools = await testClient.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), [...FELIX_TOOLS].sort());
  const denied = await testClient.callTool({name: "felix_send_message", arguments: input});
  assert.equal(denied.isError, true);
  const thread = await testClient.callTool({name: "felix_get_thread", arguments: {}});
  assert.equal(thread.isError, undefined);
  assert.ok(JSON.stringify(thread).includes(String(a.conversationId)));
  assert.ok(!JSON.stringify(thread).includes("Private fixture reasoning"));
  const history = await testClient.callTool({name:"felix_list_messages",arguments:{}});
  const receipt = await testClient.callTool({name:"felix_get_turn",arguments:{request_id:sent[0].requestId}});
  assert.equal(history.isError,undefined);
  assert.equal(receipt.isError,undefined);
  assert.ok(!JSON.stringify(history).includes("Private fixture reasoning"));
  assert.ok(!JSON.stringify(receipt).includes("Private fixture reasoning"));
  assert.ok(JSON.stringify(receipt).includes("Deterministic fixture reply"));
  assert.equal(launches, 2);
  // Only owner settings, never message text or tool arguments, grant work.
  assert.equal((await line.clientBinding(b.clientId, tenantId)).allowWork, false);
  await assert.rejects(() => line.setClientWorkPermission({...b,tenantId:tenantId+1},true), /owner_required/);
  await line.setClientWorkPermission(b,true);
  let workOptions:any;
  const workInput = {message:"Create an owner-requested report using permitted tools",idempotency_key:randomUUID()};
  await line.sendMessage(b,workInput,((_t:any,_c:any,_m:any,opts:any)=>{workOptions=opts;}) as any);
  assert.equal(workOptions.delegatedWork,true);
  assert.equal(workOptions.messagingOnly,undefined);
  await line.setClientWorkPermission(b,false);
  await db.execute(sql`UPDATE api_v1_conversation_runs SET status='complete',completed_reply='fixture work done'
    WHERE tenant_id=${tenantId} AND conversation_id=${b.conversationId}`);
  await line.sendMessage(b,{...workInput,idempotency_key:randomUUID()},((_t:any,_c:any,_m:any,opts:any)=>{workOptions=opts;}) as any);
  assert.equal(workOptions.messagingOnly,true);
  assert.equal(workOptions.delegatedWork,undefined);
  let repeated = false;
  await line.sendMessage(b,workInput,(()=>{repeated=true;}) as any);
  assert.equal(repeated,false);
  assert.equal((await line.clientBinding(b.clientId,tenantId)).allowWork,false);
  // A failed permission/audit write must roll back the entire OAuth consent.
  const origin=new URL("https://agenticcorporation.net");
  const provider=new FelixOAuthProvider(postgresOAuthStore,origin,()=>tenantId);
  const oauthClient=await provider.clientsStore.registerClient({redirect_uris:["https://claude.ai/api/mcp/auth_callback"],token_endpoint_auth_method:"none"});
  clients.push(oauthClient.client_id);
  const consentBinding=await line.ensureClientThread(oauthClient.client_id,tenantId);ids.push(consentBinding.conversationId);
  await line.setClientWorkPermission(consentBinding,true);
  let pendingRequest="";
  await provider.authorize(oauthClient,{redirectUri:oauthClient.redirect_uris[0],scopes:["felix:read","felix:write"],
    codeChallenge:createHash("sha256").update("v".repeat(64)).digest("base64url")},
    {redirect(url:string){pendingRequest=new URL(url,origin).searchParams.get("request")!;}} as any);
  const failing=new FelixOAuthProvider({transaction:fn=>postgresOAuthStore.transaction(tx=>fn({...tx,
    async prepareClient(...args){await tx.prepareClient(...args);throw new Error("injected_consent_failure");},
  }))},origin,()=>tenantId);
  await assert.rejects(()=>failing.consent(pendingRequest,tenantId,false,false),/injected_consent_failure/);
  assert.equal((await line.clientBinding(oauthClient.client_id,tenantId)).allowWork,true,"failed downgrade rolled back");
  assert.equal((await provider.pending(pendingRequest,tenantId)).clientId,oauthClient.client_id,"pending request retained");
  const codes:any=await db.execute(sql`SELECT count(*)::int AS n FROM felix_connector_records
    WHERE tenant_id=${tenantId} AND client_id=${oauthClient.client_id} AND kind='code'`);
  assert.equal(codes.rows[0].n,0,"no code issued before successful permission commit");
  await provider.consent(pendingRequest,tenantId,false,false);
  assert.equal((await line.clientBinding(oauthClient.client_id,tenantId)).allowWork,false);
  console.log(JSON.stringify({passed: true, checks: ["separate_threads", "wrong_owner_denied", "concurrent_dedup",
    "text_mismatch", "busy", "timeout_fence", "cross_client_receipt", "terminal_model_snapshot",
    "addressed_outbox", "ack_seen_only", "spark_exclusion", "six_mcp_tools", "scope_denied",
    "work_default_denied","work_owner_only","work_dispatch","live_work_downgrade","work_retry_no_reexecution","atomic_consent_rollback"], modelCalls: 0}));
} finally {
  await testClient?.close();
  await testServer?.close();
  for (const clientId of clients) {
    await db.execute(sql`DELETE FROM felix_connector_records WHERE tenant_id=${tenantId} AND client_id=${clientId}`);
    await db.execute(sql`DELETE FROM felix_line_audit WHERE tenant_id=${tenantId} AND client_id=${clientId}`);
    await db.execute(sql`DELETE FROM felix_line_turns WHERE tenant_id=${tenantId} AND client_id=${clientId}`);
    await db.execute(sql`DELETE FROM felix_line_clients WHERE tenant_id=${tenantId} AND client_id=${clientId}`);
  }
  for (const id of outboxIds) await db.execute(sql`DELETE FROM spark_outbox WHERE tenant_id=${tenantId} AND id=${id}`);
  for (const id of ids) {
    await db.execute(sql`DELETE FROM messages WHERE tenant_id=${tenantId} AND conversation_id=${id}`);
    await db.execute(sql`DELETE FROM api_v1_conversation_runs WHERE tenant_id=${tenantId} AND conversation_id=${id}`);
    await db.execute(sql`DELETE FROM conversations WHERE tenant_id=${tenantId} AND id=${id}`);
  }
}
process.exit(0);
