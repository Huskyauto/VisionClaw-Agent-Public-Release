import { useState, useRef, useEffect, useCallback } from "react";
import { X, Mic, Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

type TalkPhase = "listening" | "thinking" | "speaking" | "idle" | "wake_listening";

interface TalkModeProps {
  conversationId: number;
  agentName: string;
  onClose: () => void;
  wakeTriggers?: string[];
}

export default function TalkMode({ conversationId, agentName, onClose, wakeTriggers = [] }: TalkModeProps) {
  const [phase, setPhase] = useState<TalkPhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wakeEnabled] = useState(wakeTriggers.length > 0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioReadyRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const activeRef = useRef(true);
  const speakingRef = useRef(false);
  const interruptRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const wakeDetectedRef = useRef(false);

  const SILENCE_TIMEOUT_MS = 1500;
  const SILENCE_THRESHOLD = 15;

  const initAudioPlayback = useCallback(async () => {
    if (audioReadyRef.current) return;
    try {
      const ctx = new AudioContext({ sampleRate: 24000 });
      await ctx.audioWorklet.addModule("/audio-playback-worklet.js");
      const worklet = new AudioWorkletNode(ctx, "audio-playback-processor");
      worklet.connect(ctx.destination);
      playbackCtxRef.current = ctx;
      workletNodeRef.current = worklet;
      audioReadyRef.current = true;
    } catch (err) {
      console.error("Audio playback init failed:", err);
    }
  }, []);

  const playAudioChunk = useCallback((base64Audio: string) => {
    if (!workletNodeRef.current) return;
    const raw = atob(base64Audio);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
    workletNodeRef.current.port.postMessage({ type: "audio", samples: float32 });
  }, []);

  const stopSpeaking = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "clear" });
    }
    speakingRef.current = false;
    interruptRef.current = true;
  }, []);

  const processVoice = useCallback(async (audioBlob: Blob) => {
    if (!activeRef.current) return;
    setPhase("thinking");
    setTranscript("");
    setResponse("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await initAudioPlayback();

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(audioBlob);
      });

      if (!activeRef.current) return;

      const res = await authFetch(`/api/voice/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64 }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Voice request failed");

      const streamReader = res.body?.getReader();
      if (!streamReader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await streamReader.read();
        if (done || !activeRef.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || !activeRef.current) continue;
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case "user_transcript":
                setTranscript(event.data);
                break;
              case "transcript":
                setResponse(event.data);
                setPhase("speaking");
                speakingRef.current = true;
                break;
              case "audio_mp3":
                if (interruptRef.current) break;
                try {
                  const mp3Audio = new Audio(`data:audio/mpeg;base64,${event.data}`);
                  await mp3Audio.play();
                } catch {}
                break;
              case "audio":
                if (interruptRef.current) break;
                playAudioChunk(event.data);
                break;
              case "titleUpdate":
                queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
                break;
              case "done":
                if (workletNodeRef.current) {
                  workletNodeRef.current.port.postMessage({ type: "streamComplete" });
                }
                queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
                setTimeout(() => {
                  if (!activeRef.current) return;
                  speakingRef.current = false;
                  interruptRef.current = false;
                  wakeDetectedRef.current = false;
                  setPhase("idle");
                  setTimeout(() => {
                    if (activeRef.current) startListening();
                  }, 500);
                }, 2000);
                break;
              case "error":
                setError(event.error);
                setPhase("idle");
                break;
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) console.error("Talk parse error:", e);
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      if (activeRef.current) {
        setError(err.message);
        setPhase("idle");
        setTimeout(() => {
          if (activeRef.current) startListening();
        }, 2000);
      }
    } finally {
      abortRef.current = null;
    }
  }, [conversationId, initAudioPlayback, playAudioChunk]);

  const startWakeListening = useCallback(() => {
    if (!activeRef.current) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      startListening();
      return;
    }

    setPhase("wake_listening");

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript.toLowerCase();
        const matched = wakeTriggers.some((w) => t.includes(w));
        if (matched) {
          wakeDetectedRef.current = true;
          recognition.stop();
          if (activeRef.current) startListening();
          return;
        }
      }
    };

    recognition.onerror = () => {
      if (activeRef.current) {
        setTimeout(() => {
          if (activeRef.current) startWakeListening();
        }, 1000);
      }
    };

    recognition.onend = () => {
      if (activeRef.current && !wakeDetectedRef.current) {
        setTimeout(() => {
          if (activeRef.current) startWakeListening();
        }, 500);
      }
    };

    recognition.start();
  }, [wakeTriggers]);

  const startListening = useCallback(async () => {
    if (!activeRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      micCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      let isSpeaking = false;
      let hasSpoken = false;

      const checkLevel = () => {
        if (!activeRef.current || !analyserRef.current) return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;

        if (avg > SILENCE_THRESHOLD) {
          isSpeaking = true;
          hasSpoken = true;
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }

          if (speakingRef.current) {
            stopSpeaking();
          }
        } else if (isSpeaking && hasSpoken) {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              isSpeaking = false;
              if (recorder.state === "recording") {
                recorder.stop();
              }
            }, SILENCE_TIMEOUT_MS);
          }
        }

        rafRef.current = requestAnimationFrame(checkLevel);
      };

      recorder.onstop = () => {
        cancelAnimationFrame(rafRef.current);
        audioCtx.close().catch(() => {});
        stream.getTracks().forEach((t) => t.stop());

        if (hasSpoken && audioChunksRef.current.length > 0 && activeRef.current) {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          processVoice(blob);
        } else if (activeRef.current) {
          setPhase("idle");
          if (wakeEnabled) {
            startWakeListening();
          } else {
            startListening();
          }
        }
      };

      recorder.start(100);
      setPhase("listening");
      rafRef.current = requestAnimationFrame(checkLevel);
    } catch (err: any) {
      setError("Microphone access denied");
      setPhase("idle");
    }
  }, [processVoice, stopSpeaking, wakeEnabled, startWakeListening]);

  useEffect(() => {
    activeRef.current = true;
    if (wakeEnabled) {
      startWakeListening();
    } else {
      startListening();
    }

    return () => {
      activeRef.current = false;
      if (abortRef.current) abortRef.current.abort();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      cancelAnimationFrame(rafRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      if (mediaRecorderRef.current?.state === "recording") {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({ type: "clear" });
      }
      if (playbackCtxRef.current?.state !== "closed") {
        playbackCtxRef.current?.close().catch(() => {});
      }
      if (micCtxRef.current?.state !== "closed") {
        micCtxRef.current?.close().catch(() => {});
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    activeRef.current = false;
    if (abortRef.current) abortRef.current.abort();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    cancelAnimationFrame(rafRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (mediaRecorderRef.current?.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    stopSpeaking();
    onClose();
  }, [onClose, stopSpeaking]);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center" data-testid="talk-mode-overlay">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 z-10"
        onClick={handleClose}
        data-testid="button-close-talk-mode"
      >
        <X className="w-5 h-5" />
      </Button>

      <div className="flex flex-col items-center gap-8 max-w-md text-center px-4">
        <div className="text-lg font-semibold text-foreground">{agentName} — Talk Mode</div>

        <div className={cn(
          "w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500",
          phase === "listening" && "bg-primary/20 animate-pulse shadow-[0_0_40px_hsl(var(--primary)/0.3)]",
          phase === "thinking" && "bg-orange-500/20 shadow-[0_0_40px_rgba(249,115,22,0.3)]",
          phase === "speaking" && "bg-green-500/20 shadow-[0_0_60px_rgba(34,197,94,0.4)]",
          phase === "wake_listening" && "bg-violet-500/10 shadow-[0_0_20px_rgba(139,92,246,0.2)]",
          phase === "idle" && "bg-muted/30",
        )}>
          {phase === "listening" && <Mic className="w-12 h-12 text-primary animate-pulse" />}
          {phase === "thinking" && <Loader2 className="w-12 h-12 text-orange-500 animate-spin" />}
          {phase === "speaking" && (
            <div onClick={stopSpeaking} className="cursor-pointer">
              <Volume2 className="w-12 h-12 text-green-500" />
            </div>
          )}
          {phase === "wake_listening" && <Mic className="w-12 h-12 text-violet-400 opacity-50" />}
          {phase === "idle" && <Mic className="w-12 h-12 text-muted-foreground" />}
        </div>

        <div className="space-y-2 min-h-[80px]">
          <div className={cn(
            "text-sm font-medium uppercase tracking-wider",
            phase === "listening" && "text-primary",
            phase === "thinking" && "text-orange-500",
            phase === "speaking" && "text-green-500",
            phase === "wake_listening" && "text-violet-400",
            phase === "idle" && "text-muted-foreground",
          )}>
            {phase === "listening" && "Listening..."}
            {phase === "thinking" && "Thinking..."}
            {phase === "speaking" && "Speaking..."}
            {phase === "wake_listening" && `Say "${wakeTriggers[0] || "wake word"}" to start`}
            {phase === "idle" && "Starting..."}
          </div>

          {transcript && (
            <div className="text-sm text-muted-foreground italic" data-testid="talk-transcript">
              "{transcript}"
            </div>
          )}

          {response && (
            <div className="text-sm text-foreground max-h-32 overflow-y-auto" data-testid="talk-response">
              {response.slice(0, 300)}{response.length > 300 ? "..." : ""}
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive" data-testid="talk-error">
              {error}
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground/60 space-y-1">
          <p>Speak naturally — pauses are detected automatically</p>
          <p>Click the orb while speaking to interrupt</p>
          {wakeTriggers.length > 0 && (
            <p>Wake words: {wakeTriggers.join(", ")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
