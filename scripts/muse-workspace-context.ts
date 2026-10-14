import { buildMuseContextPacket } from "../server/muse-context";
import { ownerTenantId } from "../server/agentic/autonomous-budget";

const args = process.argv.slice(2);
const queue = args.includes("--queue");
const topicsIndex = args.indexOf("--topics");
const topics = topicsIndex >= 0 ? args[topicsIndex + 1] ?? "" : "";
const allowed = new Set(["--queue", "--preview", "--topics"]);
if (queue && args.includes("--preview")) throw new Error("Choose --preview or --queue, not both.");
if (topicsIndex >= 0 && (!topics || topics.startsWith("--"))) throw new Error("--topics requires public topic labels.");
if (queue && !topics.trim()) throw new Error("Queueing requires --topics; use --preview to inspect an empty packet.");
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--topics") { index++; continue; }
  if (!allowed.has(args[index])) throw new Error("Unsupported option. Use --preview or --queue and --topics.");
}
const packet = buildMuseContextPacket(topics);
if (!queue) {
  console.log(JSON.stringify({ status: "preview", packet }));
} else {
  const { sendSparkMessage } = await import("../server/spark-line");
  const receipt = await sendSparkMessage(ownerTenantId(), 2, JSON.stringify(packet));
  console.log(JSON.stringify({ status: "pending", requestId: packet.requestId, outboxId: receipt.outboxId, subscriptionUsageVerified: false }));
}
