import { storage } from "./storage";
import { buildSystemPrompt, stripThinkTags, windowMessages } from "./chat-engine";
import { getClientForModel, MODEL_REGISTRY, replitOpenai, createMeteredOpenAIClient } from "./providers";
import { loadTTSConfig, type TTSProvider } from "./tts-config";
import { cachedBuffer } from "./cache-gate";
import type { Request, Response } from "express";
import OpenAI from "openai";

import { logSilentCatch } from "./lib/silent-catch";
import { fetchWithTimeout } from "./lib/fetch-with-timeout";
const ELEVENLABS_BASE = "https://api.elevenlabs.io";

function getElevenLabsKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY not configured.");
  return key;
}

async function speechToText(audioBase64: string): Promise<string> {
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v1\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`));
  parts.push(audioBuffer);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const response = await fetchWithTimeout(`${ELEVENLABS_BASE}/v1/speech-to-text`, {
    method: "POST",
    headers: {
      "xi-api-key": getElevenLabsKey(),
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    timeoutMs: 90000,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`STT failed (${response.status}): ${errText}`);
  }

  const result = await response.json() as any;
  return result.text || "";
}

function getOpenAITTSClient(): OpenAI {
  const userKey = process.env.OPENAI_API_KEY;
  if (userKey) {
    // Round 35 — was raw `new OpenAI(...)`; now metered so TTS chars
    // land in the cost ledger.
    return createMeteredOpenAIClient({ apiKey: userKey, providerLabel: "openai-voice-tts" });
  }
  return replitOpenai;
}

async function ttsOpenAI(text: string): Promise<{ buffer: Buffer; format: "mp3" }> {
  const ttsConfig = loadTTSConfig();
  const voice = ttsConfig.openai.voice || "onyx";
  const model = ttsConfig.openai.model || "gpt-4o-mini-tts";
  const client = getOpenAITTSClient();

  const response = await client.audio.speech.create({
    model,
    voice: voice as any,
    input: text,
    response_format: "mp3",
  });

  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), format: "mp3" };
}

async function ttsElevenLabs(text: string, voiceId?: string): Promise<{ buffer: Buffer; format: "pcm" }> {
  const ttsConfig = loadTTSConfig();
  const effectiveVoiceId = voiceId || ttsConfig.elevenlabs.voiceId;
  const response = await fetchWithTimeout(`${ELEVENLABS_BASE}/v1/text-to-speech/${effectiveVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": getElevenLabsKey(),
      "Content-Type": "application/json",
    },
    timeoutMs: 60000,
    body: JSON.stringify({
      text,
      model_id: ttsConfig.elevenlabs.modelId,
      output_format: "pcm_24000",
      voice_settings: {
        stability: ttsConfig.elevenlabs.stability,
        similarity_boost: ttsConfig.elevenlabs.similarityBoost,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), format: "pcm" };
}

async function ttsGoogle(text: string): Promise<{ buffer: Buffer; format: "mp3" }> {
  const maxLen = 200;
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf(". ", maxLen);
    if (splitAt < 50) splitAt = remaining.lastIndexOf(" ", maxLen);
    if (splitAt < 50) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt + 1).trim());
    remaining = remaining.slice(splitAt + 1).trim();
  }

  const audioBuffers: Buffer[] = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    const encoded = encodeURIComponent(chunk);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=en&client=tw-ob`;
    const response = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Referer": "https://translate.google.com/" },
      timeoutMs: 30000,
    });
    if (!response.ok) throw new Error(`Google TTS failed (${response.status})`);
    const ab = await response.arrayBuffer();
    audioBuffers.push(Buffer.from(ab));
  }

  return { buffer: Buffer.concat(audioBuffers), format: "mp3" };
}

async function synthesizeSpeech(text: string, voiceId?: string): Promise<{ buffer: Buffer; format: "mp3" | "pcm"; usedProvider: TTSProvider }> {
  const ttsConfig = loadTTSConfig();
  const provider = ttsConfig.provider;
  const baseOrder: TTSProvider[] = [provider, "openai", "elevenlabs", "edge"];
  const fallbackOrder = baseOrder.filter((v, i, a) => a.indexOf(v) === i);

  // R63.7 gate-before-compress: cache key includes text + voice + provider-order
  // because changing any of those changes the audio. Same text + same voice
  // → same audio bytes, safe to cache (~$0.015 OpenAI / $0.30 ElevenLabs saved per hit).
  const cacheKey = JSON.stringify({
    text,
    voiceId: voiceId || "default",
    provider,
    openaiVoice: ttsConfig.openai.voice,
    openaiModel: ttsConfig.openai.model,
    elevenVoice: ttsConfig.elevenlabs.voiceId,
    elevenModel: ttsConfig.elevenlabs.modelId,
  });

  // Bucket name reflects the *primary* provider attempted (cost-tracking).
  const ns = `tts-${provider}`;

  const cached = await cachedBuffer<{ format: "mp3" | "pcm"; usedProvider: TTSProvider }>(
    ns,
    cacheKey,
    async () => {
      for (const p of fallbackOrder) {
        if (p === "edge" && !ttsConfig.edge.enabled) continue;
        try {
          switch (p) {
            case "openai": {
              const r = await ttsOpenAI(text);
              return { buffer: r.buffer, meta: { format: r.format, usedProvider: "openai" as TTSProvider } };
            }
            case "elevenlabs": {
              const r = await ttsElevenLabs(text, voiceId);
              return { buffer: r.buffer, meta: { format: r.format, usedProvider: "elevenlabs" as TTSProvider } };
            }
            case "edge": {
              const r = await ttsGoogle(text);
              return { buffer: r.buffer, meta: { format: r.format, usedProvider: "edge" as TTSProvider } };
            }
          }
        } catch (err: any) {
          console.error(`[tts] ${p} failed: ${err.message}`);
          if (p === fallbackOrder[fallbackOrder.length - 1]) throw err;
        }
      }
      throw new Error("All TTS providers failed");
    },
  );

  return { buffer: cached.buffer, format: cached.meta.format, usedProvider: cached.meta.usedProvider };
}

function sendAudioSSE(res: Response, buffer: Buffer, format: "mp3" | "pcm") {
  if (format === "mp3") {
    const b64 = buffer.toString("base64");
    res.write(`data: ${JSON.stringify({ type: "audio_mp3", data: b64 })}\n\n`);
  } else {
    const CHUNK_SIZE = 4800;
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      const chunk = buffer.subarray(i, Math.min(i + CHUNK_SIZE, buffer.length));
      res.write(`data: ${JSON.stringify({ type: "audio", data: chunk.toString("base64") })}\n\n`);
    }
  }
}

const SENTENCE_BOUNDARY_RE = /(?<=[.!?])\s+(?=[A-Z"])|(?<=[.!?])$/;
const MIN_CHUNK_LENGTH = 30;
const MAX_PARALLEL_TTS = 3;

function splitIntoSpeakableChunks(text: string): string[] {
  const sentences = text.split(SENTENCE_BOUNDARY_RE).filter(s => s.trim());
  const chunks: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    buffer = buffer ? buffer + " " + sentence : sentence;
    if (buffer.length >= MIN_CHUNK_LENGTH) {
      chunks.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) {
    if (chunks.length > 0 && buffer.length < MIN_CHUNK_LENGTH) {
      chunks[chunks.length - 1] += " " + buffer.trim();
    } else {
      chunks.push(buffer.trim());
    }
  }
  return chunks;
}

async function ttsSentenceChunk(text: string, voiceId?: string): Promise<{ buffer: Buffer; format: "mp3" | "pcm"; usedProvider: TTSProvider } | null> {
  try {
    const cleaned = cleanTextForSpeech(text);
    if (!cleaned || cleaned.length < 5) return null;
    return await synthesizeSpeech(cleaned, voiceId);
  } catch (err: any) {
    console.error(`[voice-stream] TTS chunk failed: ${err.message}`);
    return null;
  }
}

export async function handleVoiceMessage(req: Request, res: Response) {
  const conversationId = parseInt(req.params.id as string);
  const { audio } = req.body;

  if (!audio) {
    return res.status(400).json({ error: "Audio data required" });
  }

  // R115.5+sec round 3 — auth-first ordering: resolve authenticated tenantId
  // BEFORE conv lookup so the storage call is tenant-scoped at the SQL layer.
  const { getTenantFromRequest } = await import("./auth");
  const authenticatedTenantId = getTenantFromRequest(req);
  if (!authenticatedTenantId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const conv = await storage.getConversation(conversationId, authenticatedTenantId);
  if (!conv) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let voiceAborted = false;
  req.on("close", () => { voiceAborted = true; });

  try {
    const transcript = await speechToText(audio);

    if (!transcript.trim()) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Could not understand audio" })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ type: "user_transcript", data: transcript })}\n\n`);

    // R74.12 — was `?? 1` literal; now uses ADMIN_TENANT_ID constant for greppability.
    const { ADMIN_TENANT_ID } = await import("./auth");
    const voiceTenantId = conv.tenantId ?? ADMIN_TENANT_ID;
    await storage.createMessage({ conversationId, role: "user", content: transcript, tenantId: voiceTenantId });
    const [allMessages, settings, persona] = await Promise.all([
      storage.getMessages(conversationId, voiceTenantId),
      storage.getSettings(),
      conv.personaId ? storage.getPersona(conv.personaId) : storage.getActivePersona(),
    ]);

    // R74.13c — C1 fix (cross-tenant leak). Storage signatures are
    //   getMemoryEntries(personaId?, limit=100, offset=0, tenantId?)
    //   getKnowledge(personaId?, limit=100, offset=0, tenantId?)
    // Without an explicit tenantId, both queries returned global rows. Voice
    // chat could pull other tenants' memory/knowledge into the prompt.
    const [memResult, enabledSkills, knResult] = await Promise.all([
      storage.getMemoryEntries(persona?.id, 100, 0, voiceTenantId),
      storage.getEnabledSkillsWithPrompts(),
      storage.getKnowledge(persona?.id, 100, 0, voiceTenantId),
    ]);

    const model = conv.model || "gemini-2.5-flash";
    // R74.12 — pass voice conv's resolved tenant explicitly (was relying on
    // buildSystemPrompt's old `= 1` default which masked any tenant mismatch).
    const { prompt: systemPrompt, injectedMemoryIds } = await buildSystemPrompt(
      persona, memResult.data, settings, enabledSkills, knResult.data, false, "off", transcript, voiceTenantId
    );
    storage.touchMemoryEntries(injectedMemoryIds).catch(() => {});

    const chatMessages = windowMessages(
      allMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: stripThinkTags(m.content),
      }))
    );

    const { client, actualModelId } = await getClientForModel(model);

    const stream = await client.chat.completions.create({
      model: actualModelId,
      messages: [{ role: "system", content: systemPrompt + "\n\nIMPORTANT: Keep your response concise and conversational since this is a voice conversation. Aim for 1-3 sentences unless more detail is specifically needed." }, ...chatMessages],
      max_completion_tokens: 1000,
      stream: true,
    } as any);

    let fullResponse = "";
    let sentenceBuffer = "";
    let chunkIndex = 0;
    let ttsSlotSemaphore = 0;

    const ttsResults: Map<number, { buffer: Buffer; format: "mp3" | "pcm"; provider: string }> = new Map();
    let nextEmitIndex = 0;
    let allChunksDispatched = false;
    let resolveAllEmitted: (() => void) | null = null;
    const allEmitted = new Promise<void>(r => { resolveAllEmitted = r; });

    function tryEmitInOrder() {
      while (ttsResults.has(nextEmitIndex)) {
        const result = ttsResults.get(nextEmitIndex)!;
        ttsResults.delete(nextEmitIndex);
        res.write(`data: ${JSON.stringify({ type: "voice_audio_chunk", index: nextEmitIndex, format: result.format, provider: result.provider })}\n\n`);
        sendAudioSSE(res, result.buffer, result.format);
        res.write(`data: ${JSON.stringify({ type: "voice_chunk_end", index: nextEmitIndex })}\n\n`);
        nextEmitIndex++;
      }
      if (allChunksDispatched && nextEmitIndex >= chunkIndex) {
        resolveAllEmitted?.();
      }
    }

    async function dispatchTTSChunk(text: string, idx: number) {
      while (ttsSlotSemaphore >= MAX_PARALLEL_TTS) {
        await new Promise(r => setTimeout(r, 50));
      }
      ttsSlotSemaphore++;
      try {
        const result = await ttsSentenceChunk(text);
        if (result) {
          ttsResults.set(idx, { buffer: result.buffer, format: result.format, provider: result.usedProvider });
          tryEmitInOrder();
        } else {
          chunkIndex = Math.max(0, chunkIndex);
          nextEmitIndex = Math.max(nextEmitIndex, idx + 1);
          tryEmitInOrder();
        }
      } finally {
        ttsSlotSemaphore--;
      }
    }

    const pendingTTS: Promise<void>[] = [];

    for await (const chunk of (stream as any)) {
      if (voiceAborted) break;
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (!delta) continue;

      fullResponse += delta;
      sentenceBuffer += delta;

      res.write(`data: ${JSON.stringify({ type: "voice_text", data: delta })}\n\n`);

      const sentenceMatch = sentenceBuffer.match(/^([\s\S]*?[.!?])\s+([\s\S]*)$/);
      if (sentenceMatch && sentenceMatch[1].length >= MIN_CHUNK_LENGTH) {
        const completeSentence = sentenceMatch[1].trim();
        sentenceBuffer = sentenceMatch[2];
        const idx = chunkIndex++;
        pendingTTS.push(dispatchTTSChunk(completeSentence, idx));
      }
    }

    if (sentenceBuffer.trim().length > 0) {
      const idx = chunkIndex++;
      pendingTTS.push(dispatchTTSChunk(sentenceBuffer.trim(), idx));
    }

    allChunksDispatched = true;
    if (chunkIndex === 0) {
      (resolveAllEmitted as any)?.();
    } else {
      tryEmitInOrder();
    }

    await allEmitted;

    if (!fullResponse.trim()) fullResponse = "(no response)";
    res.write(`data: ${JSON.stringify({ type: "transcript", data: fullResponse })}\n\n`);

    storage.createMessage({ conversationId, role: "assistant", content: fullResponse, tenantId: voiceTenantId }).catch(() => {});

    const needsTitle = conv.title === "New Chat" || allMessages.length <= 2;
    if (needsTitle) {
      try {
        const titleResp = await replitOpenai.chat.completions.create({
          model: "gpt-5-mini",
          messages: [
            { role: "user", content: `Generate a concise 3-7 word title.\n\nUser: "${transcript.slice(0, 200)}"\nAssistant: "${fullResponse.slice(0, 200)}"\n\nReply with ONLY the title.` }
          ],
          max_completion_tokens: 30,
        });
        let newTitle = titleResp.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, "").replace(/\.+$/, "") || transcript.slice(0, 50);
        await storage.updateConversation(conversationId, { title: newTitle }, voiceTenantId);
        res.write(`data: ${JSON.stringify({ type: "titleUpdate", data: newTitle })}\n\n`);
      } catch {
        storage.updateConversation(conversationId, { title: transcript.slice(0, 50) }, voiceTenantId).catch(() => {});
      }
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error("Voice error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
}

function cleanTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`~|>]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

export async function handleTextToSpeech(req: Request, res: Response) {
  const { text, voiceId, streamed } = req.body;
  if (!text?.trim()) {
    return res.status(400).json({ error: "Text required" });
  }

  const cleanText = cleanTextForSpeech(text);
  if (!cleanText) {
    return res.status(400).json({ error: "No speakable text after cleanup" });
  }

  const maxLen = 4000;
  const truncated = cleanText.length > maxLen ? cleanText.slice(0, maxLen) + "..." : cleanText;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    if (streamed) {
      const chunks = splitIntoSpeakableChunks(truncated);
      if (chunks.length === 0) chunks.push(truncated);

      res.write(`data: ${JSON.stringify({ type: "tts_info", provider: "streamed", format: "mp3", totalChunks: chunks.length })}\n\n`);

      const pendingTTS: Promise<void>[] = [];
      let slotSemaphore = 0;

      const chunkResults: (Buffer | null)[] = new Array(chunks.length).fill(null);
      const chunkFormats: ("mp3" | "pcm")[] = new Array(chunks.length).fill("mp3");
      let resolvedCount = 0;

      const allDone = new Promise<void>((resolve) => {
        for (let i = 0; i < chunks.length; i++) {
          const chunkText = chunks[i];
          const idx = i;
          const p = (async () => {
            while (slotSemaphore >= MAX_PARALLEL_TTS) {
              await new Promise(r => setTimeout(r, 50));
            }
            slotSemaphore++;
            try {
              const result = await ttsSentenceChunk(chunkText, voiceId);
              if (result) {
                chunkResults[idx] = result.buffer;
                chunkFormats[idx] = result.format;
              }
            } finally {
              slotSemaphore--;
              resolvedCount++;
              if (resolvedCount === chunks.length) resolve();
            }
          })();
          pendingTTS.push(p);
        }
      });

      await allDone;

      for (let i = 0; i < chunkResults.length; i++) {
        if (chunkResults[i]) {
          res.write(`data: ${JSON.stringify({ type: "voice_audio_chunk", index: i, format: chunkFormats[i] })}\n\n`);
          sendAudioSSE(res, chunkResults[i]!, chunkFormats[i]);
          res.write(`data: ${JSON.stringify({ type: "voice_chunk_end", index: i })}\n\n`);
        }
      }
    } else {
      const { buffer, format, usedProvider } = await synthesizeSpeech(truncated, voiceId);
      res.write(`data: ${JSON.stringify({ type: "tts_info", provider: usedProvider, format })}\n\n`);
      sendAudioSSE(res, buffer, format);
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error("TTS error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  }
}

export async function handleListVoices(_req: Request, res: Response) {
  const ttsConfig = loadTTSConfig();
  const voices: any[] = [];

  voices.push(
    { voice_id: "alloy", name: "Alloy", provider: "openai", category: "standard" },
    { voice_id: "ash", name: "Ash", provider: "openai", category: "standard" },
    { voice_id: "ballad", name: "Ballad", provider: "openai", category: "standard" },
    { voice_id: "coral", name: "Coral", provider: "openai", category: "standard" },
    { voice_id: "echo", name: "Echo", provider: "openai", category: "standard" },
    { voice_id: "fable", name: "Fable", provider: "openai", category: "standard" },
    { voice_id: "onyx", name: "Onyx", provider: "openai", category: "standard" },
    { voice_id: "nova", name: "Nova", provider: "openai", category: "standard" },
    { voice_id: "sage", name: "Sage", provider: "openai", category: "standard" },
    { voice_id: "shimmer", name: "Shimmer", provider: "openai", category: "standard" },
  );

  voices.push({ voice_id: "google-en", name: "Google (Free)", provider: "edge", category: "free" });

  try {
    const response = await fetchWithTimeout(`${ELEVENLABS_BASE}/v1/voices`, {
      method: "GET",
      headers: { "xi-api-key": getElevenLabsKey() },
      timeoutMs: 15000,
    });
    if (response.ok) {
      const data = await response.json() as any;
      for (const v of (data.voices || [])) {
        voices.push({
          voice_id: v.voice_id,
          name: v.name,
          provider: "elevenlabs",
          category: v.category || "custom",
          labels: v.labels,
        });
      }
    }
  } catch (_silentErr) { logSilentCatch("server/voice.ts", _silentErr); }

  res.json({
    voices,
    currentProvider: ttsConfig.provider,
    currentVoice: ttsConfig.provider === "openai" ? ttsConfig.openai.voice
      : ttsConfig.provider === "elevenlabs" ? ttsConfig.elevenlabs.voiceId
      : "google-en",
  });
}

export async function handleSpeechToText(req: Request, res: Response) {
  const { audio } = req.body;
  if (!audio) {
    return res.status(400).json({ error: "Audio data required" });
  }

  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      // Round 35 — metered factory so STT calls land in the cost ledger.
      const client = createMeteredOpenAIClient({ apiKey: openaiKey, providerLabel: "openai-voice-stt" });
      const audioBuffer = Buffer.from(audio, "base64");
      const file = new File([audioBuffer], "audio.webm", { type: "audio/webm" });
      const transcription = await client.audio.transcriptions.create({
        model: "whisper-1",
        file,
      });
      return res.json({ text: transcription.text });
    }

    const text = await speechToText(audio);
    return res.json({ text });
  } catch (err: any) {
    console.error("STT error:", err.message);
    return res.status(500).json({ error: "Speech-to-text failed: " + err.message });
  }
}
