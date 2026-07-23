import { TwitterApi, ApiResponseError } from "twitter-api-v2";

const {
  X_API_KEY,
  X_API_SECRET,
  X_ACCESS_TOKEN,
  X_ACCESS_TOKEN_SECRET,
} = process.env;

if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
  console.error("Missing X_* OAuth1 env vars");
  process.exit(2);
}

const TARGET_USERNAME = "gregisenberg";

const DM_BODY = `Greg — 3 months ago I started building VisionClaw, a 16-persona AI agent platform (371 tools, 179 tables, 119 capabilities, all production). Last week I ingested your last 198 Idea-of-the-Day emails, ran them through a 5-dim VC-fit rubric, and tiered all 218 ideas in my portfolio (26 S, 51 A, 80 B). I picked YouTube Portfolio Ops (your IOTD 2026-04-07) as my top wedge and shipped the one-pager.

The pitch: would Idea Browser Pro subscribers value an agent that auto-scores each new IOTD against their own capability stack + budget + existing wedge map, and only surfaces the 2-3 ideas that fit them this week?

15-min call to show you what came out? — Bob (@huskyauto)`;

console.log(`[isenberg-dm] body length: ${DM_BODY.length} chars (X DM limit: 10000)`);

const client = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_TOKEN_SECRET,
});

async function main() {
  console.log(`[isenberg-dm] looking up @${TARGET_USERNAME}…`);
  let user;
  try {
    user = await client.v2.userByUsername(TARGET_USERNAME);
  } catch (e: any) {
    console.error(`[isenberg-dm] lookup failed: ${e?.message || e}`);
    if (e instanceof ApiResponseError) {
      console.error(`[isenberg-dm] status=${e.code} data=${JSON.stringify(e.data)}`);
    }
    process.exit(3);
  }
  if (!user?.data?.id) {
    console.error(`[isenberg-dm] no user id returned: ${JSON.stringify(user)}`);
    process.exit(3);
  }
  const targetId = user.data.id;
  console.log(`[isenberg-dm] target user id: ${targetId} (${user.data.name})`);

  console.log(`[isenberg-dm] sending DM…`);
  try {
    const res = await client.v2.sendDmToParticipant(targetId, { text: DM_BODY });
    console.log(`[isenberg-dm] SENT — response: ${JSON.stringify(res)}`);
    console.log(`[isenberg-dm] SUCCESS`);
    process.exit(0);
  } catch (e: any) {
    console.error(`[isenberg-dm] SEND FAILED: ${e?.message || e}`);
    if (e instanceof ApiResponseError) {
      console.error(`[isenberg-dm] status=${e.code}`);
      console.error(`[isenberg-dm] data=${JSON.stringify(e.data, null, 2)}`);
      console.error(`[isenberg-dm] errors=${JSON.stringify(e.errors, null, 2)}`);
    }
    process.exit(4);
  }
}

main();
