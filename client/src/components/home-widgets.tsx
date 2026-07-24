// Extracted from client/src/pages/home.tsx (girth-gate slice, mechanical move —
// no behavior change): shared widgets, constants, and types for the home page.
import { useState, useRef, useCallback } from "react";
import {
  Bot, MessageSquare, Brain, Users, BookOpen, FileText, Code, Mail,
  Lightbulb, Car, Search, CalendarDays, BarChart3, Wrench, Sparkles,
  Target, PenTool, Volume2, VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/queryClient";

export const TEMPLATE_ICONS: Record<string, any> = {
  FileText, Code, Mail, Lightbulb, Car, Search, CalendarDays, BarChart3, Wrench, Sparkles, Bot, Brain, MessageSquare, BookOpen, Users,
};

export interface Stats {
  totalConversations: number;
  totalMessages: number;
  totalMemories: number;
  activePersona: string | null;
  status: string;
  uptime: number;
}

export interface HealthReport {
  overall: "healthy" | "degraded" | "down";
  checks: { name: string; category: string; status: string; message: string; latencyMs?: number }[];
  generatedAt: string;
  autoRemediations: string[];
}

export interface HeartbeatLogEntry {
  id: number;
  taskName: string;
  status: string;
  personaName: string | null;
  durationMs: number | null;
  output: string | null;
  createdAt: string;
}

export const PLAYBOOKS = [
  { id: "research", icon: Search, label: "Research a Topic", prompt: "Research the following topic and give me a comprehensive analysis:", color: "text-blue-500", bg: "bg-blue-500/10" },
  { id: "email", icon: Mail, label: "Draft an Email", prompt: "Help me draft a professional email:", color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { id: "social", icon: PenTool, label: "Social Media Post", prompt: "Create an engaging social media post for:", color: "text-violet-500", bg: "bg-violet-500/10" },
  { id: "analyze", icon: BarChart3, label: "Analyze Data", prompt: "Analyze the following data and provide insights:", color: "text-amber-500", bg: "bg-amber-500/10" },
  { id: "code", icon: Code, label: "Write Code", prompt: "Help me write code for:", color: "text-cyan-500", bg: "bg-cyan-500/10" },
  { id: "plan", icon: Target, label: "Create a Plan", prompt: "Create a detailed action plan for:", color: "text-rose-500", bg: "bg-rose-500/10" },
];

export function StatusPulse({ status }: { status: "healthy" | "degraded" | "down" }) {
  const colors = {
    healthy: "bg-emerald-500",
    degraded: "bg-amber-500",
    down: "bg-red-500",
  };
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colors[status]} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colors[status]}`} />
    </span>
  );
}

export function renderBoldText(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-foreground">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function BriefingSpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async () => {
    if (speaking) {
      abortRef.current?.abort();
      if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    abortRef.current = new AbortController();
    let audioCtx: AudioContext | null = null;
    let worklet: AudioWorkletNode | null = null;
    try {
      const cleanText = text.replace(/[#*_~`]/g, "").replace(/\n{2,}/g, ". ").replace(/\n/g, " ");
      const res = await authFetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error("TTS failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "audio_mp3" && data.data) {
              const audio = new Audio(`data:audio/mpeg;base64,${data.data}`);
              audioElRef.current = audio;
              await audio.play();
              await new Promise<void>(r => { audio.onended = () => r(); });
            }
            if (data.type === "audio" && data.data) {
              if (!audioCtx) {
                audioCtx = new AudioContext({ sampleRate: 24000 });
                await audioCtx.audioWorklet.addModule("/audio-playback-worklet.js");
                worklet = new AudioWorkletNode(audioCtx, "audio-playback-processor");
                worklet.connect(audioCtx.destination);
              }
              const raw = atob(data.data);
              const int16 = new Int16Array(raw.length / 2);
              for (let i = 0; i < int16.length; i++) {
                int16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
              }
              const float32 = new Float32Array(int16.length);
              for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
              worklet?.port.postMessage({ type: "audio", samples: float32 });
            }
            if (data.type === "done") {
              if (worklet) worklet.port.postMessage({ type: "streamComplete" });
            }
          } catch {}
        }
      }
      if (worklet) await new Promise(r => setTimeout(r, 2000));
      if (audioCtx) audioCtx.close();
    } catch (err: any) {
      if (err.name !== "AbortError") console.error("Briefing speak error:", err);
    } finally {
      setSpeaking(false);
    }
  }, [text, speaking]);

  return (
    <Button
      size="sm"
      variant={speaking ? "default" : "ghost"}
      className="h-7 text-xs gap-1"
      onClick={speak}
      data-testid="button-speak-briefing"
    >
      {speaking ? (
        <><VolumeX className="w-3 h-3" /> Stop</>
      ) : (
        <><Volume2 className="w-3 h-3" /> Listen</>
      )}
    </Button>
  );
}
