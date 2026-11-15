import { z } from "zod";

// Deliberately accepts data, never HTML, remote URLs or executable SVG.
const screenshot = z.string().max(1_500_000).regex(
  /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
  "Use a PNG, JPEG or WebP screenshot under 1 MB.",
);
export const demoStepSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1800),
  seconds: z.number().int().min(2).max(30),
  screenshot: screenshot.optional(),
  pointer: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict().optional(),
}).strict();
export const demoProjectSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(120),
  steps: z.array(demoStepSchema).min(1).max(12),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 6_000_000, "Project must be under 6 MB.");
export type DemoProject = z.infer<typeof demoProjectSchema>;
export type DemoStep = z.infer<typeof demoStepSchema>;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

/** Pure, offline DOM/CSS output. No timers encode scene state; every frame is draw(t). */
export function renderDemoHtml(input: DemoProject): string {
  const project = demoProjectSchema.parse(input);
  const json = JSON.stringify(project).replace(/[<>&\u2028\u2029]/g, char =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(project.title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101820;color:#edf5f5;font:16px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:auto;padding:clamp(16px,4vw,44px)}h1{font-size:clamp(24px,4vw,40px);margin:8px 0 20px}
h1,h2,p,button{overflow-wrap:anywhere}h2{font-size:clamp(20px,3vw,30px)}.eyebrow{color:#8bdbca;font-size:13px;letter-spacing:.09em;text-transform:uppercase}
#stage{border:1px solid #38505a;border-radius:16px;background:#172731;overflow:hidden}
#visual{position:relative;display:none;background:#0b1218}#screen{display:block;width:100%;height:auto}
#pointer{position:absolute;width:24px;height:24px;border:3px solid #fff;border-radius:50%;background:#087e6e;box-shadow:0 0 0 5px #14b8a644;transform:translate(-50%,-50%);pointer-events:none}
.copy{padding:clamp(18px,4vw,36px)}#step-copy{white-space:pre-wrap;color:#c0d3dc}#step-count{color:#8bdbca}
.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:20px}
button{min-height:44px;padding:10px 18px;border:1px solid #57747d;border-radius:8px;background:#1c3c43;color:#fff;cursor:pointer}
button:focus-visible,input:focus-visible{outline:3px solid #79ead4;outline-offset:3px}label{display:block}input[type=range]{width:100%;min-height:44px;accent-color:#80e1cc}
.timeline{flex:1;min-width:180px}small{display:block;color:#aabdc7;margin-top:20px}#time{font-variant-numeric:tabular-nums}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
@media print{body{background:white;color:black}.controls{display:none}#stage{break-inside:avoid}}
</style></head><body><main><div class="eyebrow">Product walkthrough</div><h1>${escapeHtml(project.title)}</h1>
<section id="stage" aria-label="Walkthrough frame"><div id="visual"><img id="screen" alt=""><span id="pointer" hidden></span></div><div class="copy"><span id="step-count">Step 1 of ${project.steps.length}</span><h2 id="step-title">${escapeHtml(project.steps[0].title)}</h2><p id="step-copy">${escapeHtml(project.steps[0].description)}</p></div></section>
<div class="controls"><button id="play" type="button" aria-pressed="false">Play</button><button id="restart" type="button">Restart</button><div class="timeline"><label for="clock">Walkthrough timeline <output id="time"></output></label><input id="clock" type="range" min="0" step="0.05" value="0"></div><button id="next" type="button">Next step</button></div>
<small>Illustrated reconstruction, not a live recording or proof of execution. No account is accessed and no operation is performed. Playback starts paused. Use Next step or the timeline without animation.</small>
<noscript>This walkthrough needs JavaScript for playback. No operations are performed.</noscript>
</main><script>
"use strict";
const project=${json};
const stage=document.getElementById("stage"),clock=document.getElementById("clock"),play=document.getElementById("play");
const total=project.steps.reduce((sum,step)=>sum+step.seconds,0);
clock.max=String(total);
let playing=false,raf=0,previous=0;
function draw(t){
 t=Math.max(0,Math.min(Number.isFinite(t)?t:0,total));let start=0,index=0;
 while(index<project.steps.length-1 && t>=start+project.steps[index].seconds){start+=project.steps[index].seconds;index++;}
 const step=project.steps[index],image=document.getElementById("screen"),visual=document.getElementById("visual"),pointer=document.getElementById("pointer");
 document.getElementById("step-title").textContent=step.title;
 document.getElementById("step-copy").textContent=step.description;
 document.getElementById("step-count").textContent="Step "+(index+1)+" of "+project.steps.length;
 visual.style.display=step.screenshot?"block":"none";
 if(step.screenshot){if(image.getAttribute("src")!==step.screenshot)image.setAttribute("src",step.screenshot);image.alt=step.title+" screenshot";}
 else{image.removeAttribute("src");image.alt="";}
 pointer.hidden=!step.screenshot||!step.pointer;
 if(step.pointer){pointer.style.left=step.pointer.x+"%";pointer.style.top=step.pointer.y+"%";}
 document.getElementById("time").textContent=t.toFixed(1)+" / "+total+"s";clock.value=String(t);
}
function pause(){playing=false;cancelAnimationFrame(raf);play.textContent="Play";play.setAttribute("aria-pressed","false");}
function tick(now){if(!playing)return;const t=Number(clock.value)+(now-previous)/1000;previous=now;draw(t);if(t>=total)pause();else raf=requestAnimationFrame(tick);}
play.onclick=()=>{if(playing){pause();return;}if(Number(clock.value)>=total)draw(0);playing=true;play.textContent="Pause";play.setAttribute("aria-pressed","true");previous=performance.now();raf=requestAnimationFrame(tick);};
clock.oninput=()=>{pause();draw(Number(clock.value));};
document.getElementById("restart").onclick=()=>{pause();draw(0);};
document.getElementById("next").onclick=()=>{pause();let start=0;for(const step of project.steps){start+=step.seconds;if(start>Number(clock.value)+0.01){draw(Math.min(start,total));break;}}};
document.addEventListener("visibilitychange",()=>{if(document.hidden)pause();});
draw(0);
</script></body></html>`;
}
