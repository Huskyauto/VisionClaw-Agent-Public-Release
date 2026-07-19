// Canonical Fish Audio reference IDs used across VisionClaw.
// These are PUBLIC model IDs (anyone with the Fish model URL can play them);
// the gating secret is FISH_AUDIO_API_KEY which authorizes the synthesis call.
//
// Why constants instead of env vars: voice IDs are stable, public, and need to
// survive across dev/prod environments without per-deploy config. The synthesis
// itself still requires FISH_AUDIO_API_KEY at runtime.

// Bob Washburn — direct-pitch voice (confirmed by Bob on 2026-05-24, used for
// /audit page founder-pitch audio + future founder-led DM voice notes).
// Source URL: https://fish.audio/m/675fecd02fcc4ad28cd84ca61501ca3e
export const FISH_VOICE_BOB_DIRECT = "675fecd02fcc4ad28cd84ca61501ca3e";
