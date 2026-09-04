import { buildVideoFromBrief } from "../server/build-video-from-brief";

const brief = `[Your Product] — Weekly Recap, week of May 21, 2026.

Bob's wellness journey on wellness-program continues. As of the May 10 milestone, total lost-to-date is 236 lbs, current weight 268 lbs. This week's recap covers progress, wins, challenges, and what's next.

Chapter beats to cover:
1. Open with a warm welcome and a one-line recap of where Bob is on the protocol (lost 236 lbs to date, currently 268 lbs).
2. This week's check-ins: wellness-program dose adherence, hydration, sleep, and how the body's responding mid-protocol.
3. Emotional-eating wins: the moments Bob caught the urge, used a coping skill, and kept the streak alive. Name one specific win.
4. Movement + mindset: a short note on the walking/strength routine and the mental game — what's helping, what's noisy.
5. Look-ahead: next week's focus areas (consistency over intensity), one habit Bob is doubling down on, and an encouraging close inviting viewers to follow the journey at [Your Product].

Tone: warm, honest, calm. Personal but not preachy. No medical claims, no spoken URLs. Treat the audience like a friend on the same path.`;

async function main() {
  const res = await buildVideoFromBrief({
    tenantId: 1,
    brief,
    title: "[Your Product] — Weekly Recap (Week of May 21, 2026)",
    targetMinutes: 5,
    // Bob's cloned voice on Fish Audio
    // https://fish.audio/app/text-to-speech/?modelId=675fecd02fcc4ad28cd84ca61501ca3e
    voice: "675fecd02fcc4ad28cd84ca61501ca3e",
    voiceProvider: "fish",
    projectId: 13,
    customerName: "Bob",
    customerEmail: "huskyauto@gmail.com",
    uploadToDrive: true,
  });
  console.log(JSON.stringify(res, null, 2));
}

main().catch((e) => { console.error("kick failed:", e); process.exit(1); });
