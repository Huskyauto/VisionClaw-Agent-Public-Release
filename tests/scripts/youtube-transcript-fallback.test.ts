import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeYouTubeUrl,
  extractTranscriptSection,
  vttToText,
} from "../../.agents/skills/youtube-transcript-fallback/scripts/extract";

test("normalizes supported YouTube URL shapes and removes tracking parameters", () => {
  assert.deepEqual(normalizeYouTubeUrl("https://youtu.be/8ZC1G1ezN5o?is=tracking"), {
    videoId: "8ZC1G1ezN5o",
    canonicalUrl: "https://www.youtube.com/watch?v=8ZC1G1ezN5o",
  });
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/shorts/8ZC1G1ezN5o").videoId,
    "8ZC1G1ezN5o",
  );
});

test("rejects non-YouTube and malformed video IDs", () => {
  assert.throws(() => normalizeYouTubeUrl("https://example.com/watch?v=8ZC1G1ezN5o"));
  assert.throws(() => normalizeYouTubeUrl("https://youtube.com/watch?v=short"));
});

test("turns VTT captions into deduplicated plain text", () => {
  const vtt = `WEBVTT
Kind: captions

00:00:00.000 --> 00:00:02.000
<c>Hello &amp; welcome</c>

00:00:02.000 --> 00:00:04.000
Hello &amp; welcome

00:00:04.000 --> 00:00:06.000
to the show.
`;
  assert.equal(vttToText(vtt), "Hello & welcome to the show.");
});

test("accepts only an explicit substantial transcript panel", () => {
  const spoken = Array.from({ length: 320 }, (_, i) => `word${i}`).join(" ");
  assert.equal(extractTranscriptSection(`# Video\n\n## Transcript\n\n${spoken}`), spoken);
  assert.equal(
    extractTranscriptSection(`# Video\n\n## Transcript\n\n${spoken}\n\n## Related videos\n\nnoise noise noise`),
    spoken,
  );
  assert.equal(extractTranscriptSection(`# Video\n\n${spoken}`), null);
  assert.equal(extractTranscriptSection(`## Transcript\n\nSign in to confirm you're not a bot ${spoken}`), null);
});
