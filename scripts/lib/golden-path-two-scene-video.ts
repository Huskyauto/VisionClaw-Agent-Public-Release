/** An exact two-scene job: produce_video now treats slide_scripts as a brief and expands them. */
export function twoSceneVideoJobArgs(imagePath: string) {
  return {
    title: "VisionClaw BWB Pipeline Smoke",
    chapters: [{
      chapterTitle: "Two-scene smoke",
      scenes: [
        { narration: "This is a Built With Bob platform smoke test. The video pipeline is healthy.", imagePath },
        { narration: "Fish Audio narration and video assembly. All systems nominal.", imagePath },
      ],
    }],
    voice: "onyx",
    voiceProvider: "fish",
    strictVoice: true,
    resolution: "1080p",
    fps: 30,
    crossfadeMs: 0,
    kenBurns: false,
    uploadToDrive: false,
    autoFinalize: true,
    autoDeliver: false,
  };
}