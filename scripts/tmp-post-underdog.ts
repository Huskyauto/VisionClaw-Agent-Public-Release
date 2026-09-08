import { xPostTweet, isXConfigured } from "../server/social-publisher";

const tweet = `Adobe has an enemy it can't sue away.

An anonymous dev built ComfyUI. Free. Open source. 124K GitHub stars.

Adobe just paid $150M to settle DOJ charges over cancellation-fee traps (3/13/26). Photoshop: $22.99/mo.

But DO NOT switch. Keep paying rent.

Link in comments.`;

const reply = `If you're a small business wondering which AI tools you actually need — and which subscriptions are just rent — we run AI Readiness Audits: https://agenticcorporation.net/audit ($497 self-serve / $1,997 done-for-you).`;

async function main() {
  if (!isXConfigured()) throw new Error("X not configured");
  console.log("tweet chars:", tweet.length, "reply chars:", reply.length);
  if (tweet.length > 280) throw new Error("tweet too long");
  const dry = process.argv.includes("--live") ? false : true;
  if (dry) { console.log("DRY RUN. Pass --live to post."); return; }
  const r1 = await xPostTweet(tweet);
  console.log("POSTED:", JSON.stringify(r1));
  if (!r1.tweetId) throw new Error("no tweet id, aborting reply");
  const r2 = await xPostTweet(reply, r1.tweetId);
  console.log("REPLY:", JSON.stringify(r2));
}
main().then(() => process.exit(0)).catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
