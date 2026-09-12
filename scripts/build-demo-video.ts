/**
 * build-demo-video.ts — produces the public-repo demo video (1080p MP4).
 *
 * Authentic narrated screenshot tour of the live VisionClaw platform.
 * - TTS narration via OpenAI tts-1-hd (voice: onyx)
 * - ffmpeg Ken-Burns slideshow from real app screenshots + lower-third captions
 * - dark outro card (logo + tagline + domain)
 *
 * Counts are CANONICAL (match docs/CURRENT_PLATFORM_TOTALS.md): 393 tools,
 * 210 tables, 616 indexes, 41 governance rules, 16 personas. No spoken URLs.
 *
 * Run:  npx tsx scripts/build-demo-video.ts           (full build)
 *       LIMIT=1 npx tsx scripts/build-demo-video.ts   (first scene only, probe)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, "demo-video");
const WORK = join(DIR, "work");
const AUDIO = join(DIR, "audio");
const OUT = join(DIR, "visionclaw-demo.mp4");
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const LOGO = join(ROOT, "client/public/visionclaw-logo.png");
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY not set");

mkdirSync(WORK, { recursive: true });
mkdirSync(AUDIO, { recursive: true });

type Scene = { img: string; caption: string; narration: string };
const SCENES: Scene[] = [
  {
    img: "01-landing.jpg",
    caption: "16 specialist agents. Real, finished work.",
    narration:
      "VisionClaw isn't another chatbot. It's a full AI corporation you can hire — sixteen specialized agents that run research, reporting, documents, outreach, and internal operations as real, finished work. You stay in control. The busywork disappears.",
  },
  {
    img: "08-compare.jpg",
    caption: "9 manual steps becomes 16 agents, zero effort.",
    narration:
      "What a founder does by hand in nine manual steps, VisionClaw does autonomously. Sixteen agents coordinate the entire job end to end, with governance, memory, and strict multi-tenant isolation built in from the start.",
  },
  {
    img: "06-architecture.jpg",
    caption: "393 tools · 210 tables · 616 indexes · 41 rules",
    narration:
      "Under the hood, it's a serious platform. Three hundred ninety-three production tools, two hundred ten database tables, six hundred sixteen indexes, and forty-one governance rules, all enforcing tenant isolation on every query path.",
  },
  {
    img: "04-skills.jpg",
    caption: "Reusable skills. Senior-practitioner standard.",
    narration:
      "Every workflow is a reusable skill. From drafting a product requirements document to running an A.I. readiness audit, each skill encodes how a senior practitioner approaches the task, so the same professional standard ships every single time.",
  },
  {
    img: "05-audit.jpg",
    caption: "Audit your AI platform. Get a real score.",
    narration:
      "Don't take the marketing's word for it. Run the same eight-dimension audit the founder ran on his own platform, and get a real, SQL-backed score. A number, not a vibes-check.",
  },
  {
    img: "03-trust.jpg",
    caption: "Live trust & transparency dashboard.",
    narration:
      "And it's radically transparent. A live trust dashboard shows what's running right now, which safety layers are active, and exactly what the system has refused. Every number pulled straight from the platform.",
  },
];

const OUTRO_NARR =
  "VisionClaw. Hire an AI corporation, not another chatbot.";

const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : SCENES.length;

function sh(bin: string, args: string[]) {
  return execFileSync(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
}
function dur(file: string): number {
  const out = sh("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1", file,
  ]).toString().trim();
  return parseFloat(out);
}
async function tts(text: string, outFile: string) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1-hd", voice: "onyx", input: text, response_format: "mp3", speed: 1.0 }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outFile, buf);
}

async function main() {
  const clips: string[] = [];

  for (let i = 0; i < Math.min(LIMIT, SCENES.length); i++) {
    const s = SCENES[i];
    const n = i + 1;
    const imgPath = join(DIR, s.img);
    if (!existsSync(imgPath)) throw new Error(`missing screenshot: ${imgPath}`);
    const aud = join(AUDIO, `scene-${n}.mp3`);
    console.log(`[${n}/${SCENES.length}] TTS…`);
    await tts(s.narration, aud);
    const aDur = dur(aud);
    const clipDur = +(aDur + 0.8).toFixed(2);
    const frames = Math.ceil(clipDur * 30);

    const capFile = join(WORK, `cap-${n}.txt`);
    writeFileSync(capFile, s.caption);
    const clip = join(WORK, `clip-${n}.mp4`);

    const vf =
      `[0:v]scale=2304:1296:force_original_aspect_ratio=increase,crop=2304:1296,` +
      `zoompan=z='min(zoom+0.0005,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30,` +
      `drawtext=fontfile=${FONT_BOLD}:textfile=${capFile}:fontcolor=white:fontsize=46:line_spacing=12:` +
      `box=1:boxcolor=0x000000@0.6:boxborderw=28:x=(w-text_w)/2:y=h-text_h-70,` +
      `fade=t=in:st=0:d=0.4,fade=t=out:st=${(clipDur - 0.4).toFixed(2)}:d=0.4,format=yuv420p[v]`;

    console.log(`[${n}/${SCENES.length}] render clip (${clipDur}s)…`);
    sh("ffmpeg", [
      "-y", "-loop", "1", "-t", String(clipDur), "-i", imgPath, "-i", aud,
      "-filter_complex", vf, "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", "-shortest", clip,
    ]);
    clips.push(clip);
  }

  // Outro card (only on full build)
  if (LIMIT >= SCENES.length) {
    const aud = join(AUDIO, `outro.mp3`);
    console.log(`[outro] TTS…`);
    await tts(OUTRO_NARR, aud);
    const clipDur = +(dur(aud) + 1.2).toFixed(2);
    const clip = join(WORK, `clip-outro.mp4`);
    const vf =
      `[1:v]scale=440:-1[lg];[0:v][lg]overlay=(W-w)/2:(H-h)/2-130[bg];` +
      `[bg]drawtext=fontfile=${FONT_BOLD}:text='Hire an AI corporation, not another chatbot.':` +
      `fontcolor=white:fontsize=48:x=(w-text_w)/2:y=H/2+110,` +
      `drawtext=fontfile=${FONT_REG}:text='agenticcorporation.net':fontcolor=0x7AA2FF:fontsize=40:` +
      `x=(w-text_w)/2:y=H/2+200,fade=t=in:st=0:d=0.5,fade=t=out:st=${(clipDur - 0.6).toFixed(2)}:d=0.6,format=yuv420p[v]`;
    console.log(`[outro] render (${clipDur}s)…`);
    sh("ffmpeg", [
      "-y", "-f", "lavfi", "-t", String(clipDur), "-i", `color=c=0x0B0B14:s=1920x1080:r=30`,
      "-loop", "1", "-i", LOGO, "-i", aud,
      "-filter_complex", vf, "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", "-shortest", clip,
    ]);
    clips.push(clip);
  }

  // Concat
  const listFile = join(WORK, "concat.txt");
  writeFileSync(listFile, clips.map((c) => `file '${c}'`).join("\n"));
  if (existsSync(OUT)) rmSync(OUT);
  console.log(`[concat] ${clips.length} clips -> ${OUT}`);
  sh("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-c", "copy", "-movflags", "+faststart", OUT,
  ]);
  const total = dur(OUT);
  console.log(`✓ DONE: ${OUT}  (${total.toFixed(1)}s)`);
}

main().catch((e) => { console.error("✗", e.message || e); process.exit(1); });
