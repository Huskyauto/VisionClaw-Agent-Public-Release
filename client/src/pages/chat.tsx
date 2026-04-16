import { useState, useRef, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Send, Brain, Bot, User, Copy, Check, Loader2, Sparkles, ChevronDown, Settings2, ChevronRight, Wrench, ChevronUp, Paperclip, X, FileText, Image as ImageIcon, Users, Mic, MicOff, Volume2, VolumeX, Camera, MessageSquare, Download, FolderOpen, ShieldAlert, ShieldCheck, ShieldX, Crown, GitBranch, ArrowDown, RotateCcw, Square, Monitor, Minimize2, Maximize2, Globe, MousePointer, Type, Eye, Pause, Play, AlertTriangle, Upload } from "lucide-react";
import TalkMode from "@/components/talk-mode";
import CameraCapture from "@/components/camera-capture";
import ActivityPulse from "@/components/activity-pulse";
import { DelegationLiveFeed } from "@/components/delegation-live";
import LiveCanvas, { extractCanvasBlocks } from "@/components/live-canvas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { queryClient, apiRequest, authFetch } from "@/lib/queryClient";
import { uploadFile } from "@/lib/upload";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Conversation, Message, Persona } from "@shared/schema";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, AreaChart, Area,
} from "recharts";

const CHART_COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

interface ChartData {
  type: "bar" | "line" | "pie" | "area";
  title: string;
  data: Record<string, any>[];
  xKey?: string;
  yKey?: string;
  colors?: string[];
}

function ChartRenderer({ chart }: { chart: ChartData }) {
  const colors = chart.colors || CHART_COLORS;
  const xKey = chart.xKey || "name";
  const yKeys = (chart.yKey || "value").split(",").map(k => k.trim());

  return (
    <div className="my-3 p-3 rounded-lg bg-muted/30 border border-border" data-testid="inline-chart">
      <div className="text-xs font-medium text-foreground mb-2">{chart.title}</div>
      <ResponsiveContainer width="100%" height={200}>
        {chart.type === "pie" ? (
          <PieChart>
            <Pie data={chart.data} cx="50%" cy="50%" outerRadius={70} dataKey={yKeys[0]} nameKey={xKey}
              label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
              {chart.data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
            <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
          </PieChart>
        ) : chart.type === "area" ? (
          <AreaChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
            {yKeys.map((key, i) => <Area key={key} type="monotone" dataKey={key} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.3} />)}
          </AreaChart>
        ) : chart.type === "line" ? (
          <LineChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
            {yKeys.map((key, i) => <Line key={key} type="monotone" dataKey={key} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} />)}
          </LineChart>
        ) : (
          <BarChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 11 }} />
            {yKeys.map((key, i) => <Bar key={key} dataKey={key} fill={colors[i % colors.length]} radius={[2, 2, 0, 0]} />)}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function parseChartBlocks(content: string): { charts: ChartData[]; cleanContent: string } {
  const charts: ChartData[] = [];
  const cleaned = content.replace(/```chart\s*\n([\s\S]*?)```/g, (_, json) => {
    try {
      const parsed = JSON.parse(json.trim());
      if (parsed.chartData) charts.push(parsed.chartData);
      else if (parsed.type && parsed.data) charts.push(parsed);
    } catch {}
    return "";
  });
  return { charts, cleanContent: cleaned.trim() };
}

function extractChartsFromTools(tools: ToolCallInfo[]): ChartData[] {
  const charts: ChartData[] = [];
  for (const tool of tools) {
    if (tool.name === "generate_chart" && tool.output) {
      const out = typeof tool.output === "string" ? (() => { try { return JSON.parse(tool.output); } catch { return null; } })() : tool.output;
      if (out?.chartData) charts.push(out.chartData);
    }
  }
  return charts;
}

const getAuthUrl = (url: string) => {
  if (!url.startsWith("/uploads/")) return url;
  return url;
};

async function fetchAuthBlob(url: string): Promise<string> {
  const token = localStorage.getItem("vc_token");
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch file");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function AuthImage({ src, alt, className, ...props }: { src: string; alt: string; className?: string; [key: string]: any }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src.startsWith("/uploads/")) {
      setBlobUrl(src);
      return;
    }
    let revoked = false;
    fetchAuthBlob(src).then(url => {
      if (!revoked) setBlobUrl(url);
    }).catch(() => {});
    return () => { revoked = true; if (blobUrl?.startsWith("blob:")) URL.revokeObjectURL(blobUrl); };
  }, [src]);
  if (!blobUrl) return <div className={className} style={{ background: "var(--muted)" }} />;
  return <img src={blobUrl} alt={alt} className={className} {...props} />;
}

interface Attachment {
  url: string;
  name: string;
  type: string;
  preview?: string;
}

interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  tier: string;
  description: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-foreground"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

const activeAutoAudioRef = { current: null as any };
const autoTtsAbortRef = { current: null as AbortController | null };
const streamTtsQueueRef = { current: [] as string[], processing: false, abort: null as AbortController | null };
const autoTtsState = { active: false, paused: false, audioCtx: null as AudioContext | null, listeners: new Set<() => void>() };
function notifyAutoTtsListeners() { autoTtsState.listeners.forEach(fn => fn()); }
function useAutoTtsState() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick(t => t + 1);
    autoTtsState.listeners.add(fn);
    return () => { autoTtsState.listeners.delete(fn); };
  }, []);
  return autoTtsState;
}
function pauseAutoTts() {
  if (!autoTtsState.active) return;
  autoTtsState.paused = true;
  if (sharedAudioCtxRef.current && sharedAudioCtxRef.current.state === "running") {
    sharedAudioCtxRef.current.suspend();
  }
  if (autoTtsState.audioCtx && autoTtsState.audioCtx.state === "running") {
    autoTtsState.audioCtx.suspend();
  }
  if (activeAutoAudioRef.current) {
    if (typeof activeAutoAudioRef.current.pause === "function") activeAutoAudioRef.current.pause();
  }
  notifyAutoTtsListeners();
}
function resumeAutoTts() {
  if (!autoTtsState.active) return;
  autoTtsState.paused = false;
  if (sharedAudioCtxRef.current && sharedAudioCtxRef.current.state === "suspended") {
    sharedAudioCtxRef.current.resume();
  }
  if (autoTtsState.audioCtx && autoTtsState.audioCtx.state === "suspended") {
    autoTtsState.audioCtx.resume();
  }
  if (activeAutoAudioRef.current) {
    if (typeof activeAutoAudioRef.current.play === "function") activeAutoAudioRef.current.play();
  }
  notifyAutoTtsListeners();
}

function cleanTextForSpeech(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/`[^`]+`/g, "");
  cleaned = cleaned.replace(/\{[\s\S]*?\}/g, (match) => {
    if (match.includes('"') || match.includes("'") || match.includes(":")) return "";
    return match;
  });
  cleaned = cleaned.replace(/\[[\s\S]*?\]/g, (match) => {
    if (match.includes('"') || match.includes("{") || match.includes(",")) return "";
    return match;
  });
  cleaned = cleaned.replace(/^(import|export|const|let|var|function|class|if|else|for|while|return|switch|case|try|catch|throw|async|await|def|print|self)\b.*$/gm, "");
  cleaned = cleaned.replace(/[a-zA-Z_]\w*\s*[({]\s*[^)]*\)\s*[;{]?\s*$/gm, "");
  cleaned = cleaned.replace(/\w+\.\w+\.\w+/g, "");
  cleaned = cleaned.replace(/[=!<>]{2,}/g, "");
  cleaned = cleaned.replace(/=>/g, "");
  cleaned = cleaned.replace(/[{}\[\]();]/g, "");
  cleaned = cleaned.replace(/"[^"]{0,20}":\s*"[^"]*"/g, "");
  cleaned = cleaned.replace(/"[^"]{0,20}":\s*\d+/g, "");
  cleaned = cleaned.replace(/"[^"]{0,20}":\s*(true|false|null)/g, "");
  cleaned = cleaned.replace(/\b[A-Z_]{3,}_[A-Z_]{2,}\b/g, "");
  cleaned = cleaned.replace(/\b(O\(n[^)]*\))/gi, "");
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");
  cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");
  cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, "$2");
  cleaned = cleaned.replace(/(\*|_)(.*?)\1/g, "$2");
  cleaned = cleaned.replace(/~~(.*?)~~/g, "$1");
  cleaned = cleaned.replace(/^[-*+]\s+/gm, "");
  cleaned = cleaned.replace(/^\d+\.\s+/gm, "");
  cleaned = cleaned.replace(/^>\s+/gm, "");
  cleaned = cleaned.replace(/^---+$/gm, "");
  cleaned = cleaned.replace(/^\|.*\|$/gm, "");
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = cleaned.replace(/https?:\/\/\S+/g, "");
  cleaned = cleaned.replace(/\b\w+_\w+\b/g, (m) => m.replace(/_/g, " "));
  cleaned = cleaned.replace(/\b[a-f0-9]{16,}\b/gi, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned.replace(/^\s*$/gm, "");
  cleaned = cleaned.replace(/\n{2,}/g, ". ");
  return cleaned.trim();
}

function findSentenceBoundary(text: string): number {
  const minLen = 40;
  if (text.length < minLen) return -1;
  const sentenceEnders = /[.!?]\s/g;
  let lastMatch = -1;
  let match;
  while ((match = sentenceEnders.exec(text)) !== null) {
    if (match.index >= minLen - 2) {
      lastMatch = match.index + 1;
    }
  }
  if (lastMatch === -1 && text.length > 200) {
    const commaIdx = text.lastIndexOf(", ", text.length - 10);
    if (commaIdx >= minLen) lastMatch = commaIdx + 1;
  }
  return lastMatch;
}

async function processStreamTtsQueue(authFetchFn: typeof fetch) {
  if (streamTtsQueueRef.processing) return;
  streamTtsQueueRef.processing = true;
  autoTtsState.active = true;
  autoTtsState.paused = false;
  notifyAutoTtsListeners();
  while (streamTtsQueueRef.current.length > 0) {
    const chunk = streamTtsQueueRef.current.shift();
    if (!chunk?.trim()) continue;
    if (streamTtsQueueRef.abort?.signal.aborted) break;
    try {
      const res = await authFetchFn("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chunk, streamed: true }),
        signal: streamTtsQueueRef.abort?.signal,
      });
      if (!res.ok) continue;
      const reader = res.body?.getReader();
      if (!reader) continue;
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        if (streamTtsQueueRef.abort?.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === "audio_mp3" && d.data) {
              await playMp3Base64(d.data);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") break;
    }
  }
  streamTtsQueueRef.processing = false;
  autoTtsState.active = false;
  autoTtsState.paused = false;

  notifyAutoTtsListeners();
}

function stopStreamTts() {
  streamTtsQueueRef.current = [];
  streamTtsQueueRef.processing = false;
  if (streamTtsQueueRef.abort) {
    streamTtsQueueRef.abort.abort();
    streamTtsQueueRef.abort = null;
  }
}

function stopAllAutoTts() {
  stopStreamTts();
  if (autoTtsAbortRef.current) {
    autoTtsAbortRef.current.abort();
    autoTtsAbortRef.current = null;
  }
  if (activeAutoAudioRef.current) {
    try {
      if (typeof activeAutoAudioRef.current.stop === "function") {
        activeAutoAudioRef.current.stop();
      } else if (typeof activeAutoAudioRef.current.pause === "function") {
        activeAutoAudioRef.current.pause();
        activeAutoAudioRef.current.currentTime = 0;
      }
    } catch {}
    activeAutoAudioRef.current = null;
  }
  autoTtsState.active = false;
  autoTtsState.paused = false;

  autoTtsState.audioCtx = null;
  notifyAutoTtsListeners();
}

const sharedAudioCtxRef = { current: null as AudioContext | null };

function getSharedAudioCtx(): AudioContext {
  if (!sharedAudioCtxRef.current || sharedAudioCtxRef.current.state === "closed") {
    sharedAudioCtxRef.current = new AudioContext();
  }
  if (sharedAudioCtxRef.current.state === "suspended" && !autoTtsState.paused) {
    sharedAudioCtxRef.current.resume();
  }
  return sharedAudioCtxRef.current;
}

function warmAudioContext() {
  try {
    const ctx = getSharedAudioCtx();
    ctx.resume();
  } catch {}
}

function playMp3Base64(base64: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const ctx = getSharedAudioCtx();
      await ctx.resume();
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      activeAutoAudioRef.current = source as any;
      source.onended = () => { activeAutoAudioRef.current = null; resolve(); };
      source.start(0);
    } catch (e) {
      activeAutoAudioRef.current = null;
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
      activeAutoAudioRef.current = audio;
      audio.onended = () => { activeAutoAudioRef.current = null; resolve(); };
      audio.onerror = (err) => { activeAutoAudioRef.current = null; reject(err); };
      audio.play().catch((err) => { activeAutoAudioRef.current = null; reject(err); });
    }
  });
}

function SpeakButton({ text, isLastAssistant }: { text: string; isLastAssistant?: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ats = useAutoTtsState();
  const isAutoPlaying = ats.active && !!isLastAssistant;

  const stop = useCallback(() => {
    abortRef.current?.abort();
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    setSpeaking(false);
    setPaused(false);
  }, []);

  const togglePause = useCallback(() => {
    if (audioElRef.current) {
      if (paused) { audioElRef.current.play(); } else { audioElRef.current.pause(); }
    }
    if (audioCtxRef.current) {
      if (paused) { audioCtxRef.current.resume(); } else { audioCtxRef.current.suspend(); }
    }
    setPaused(!paused);
  }, [paused]);

  const speak = useCallback(async () => {
    if (speaking) { stop(); return; }
    setSpeaking(true);
    setPaused(false);
    setHasPlayed(true);
    abortRef.current = new AbortController();
    let worklet: AudioWorkletNode | null = null;
    try {
      const res = await authFetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanTextForSpeech(text) }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error("TTS failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let format: string | null = null;
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
            if (data.type === "tts_info") { format = data.format; }
            if (data.type === "audio_mp3" && data.data) {
              const audio = new Audio(`data:audio/mpeg;base64,${data.data}`);
              audioElRef.current = audio;
              await audio.play();
              await new Promise<void>(r => { audio.onended = () => r(); });
            }
            if (data.type === "audio" && data.data) {
              if (!audioCtxRef.current) {
                audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
                await audioCtxRef.current.audioWorklet.addModule("/audio-playback-worklet.js");
                worklet = new AudioWorkletNode(audioCtxRef.current, "audio-playback-processor");
                worklet.connect(audioCtxRef.current.destination);
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
      if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    } catch (err: any) {
      if (err.name !== "AbortError") console.error("Speak error:", err);
    } finally {
      setSpeaking(false);
      setPaused(false);
    }
  }, [text, speaking, stop]);

  const isActive = speaking || isAutoPlaying;
  const isPaused = speaking ? paused : ats.paused;

  if (isActive) {
    return (
      <div className="flex items-center gap-1.5" data-testid="speak-controls">
        <button
          className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 active:scale-95 transition-all"
          onClick={isAutoPlaying ? (isPaused ? resumeAutoTts : pauseAutoTts) : togglePause}
          data-testid="button-pause-resume"
          title={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? <Play className="w-5 h-5 ml-0.5" /> : <Pause className="w-5 h-5" />}
        </button>
        <button
          className="flex items-center justify-center w-8 h-8 rounded-full bg-destructive/90 text-destructive-foreground shadow hover:bg-destructive active:scale-95 transition-all"
          onClick={isAutoPlaying ? stopAllAutoTts : stop}
          data-testid="button-stop-speaking"
          title="Stop"
        >
          <Square className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5" data-testid="speak-controls-idle">
      <button
        className={cn(
          "opacity-0 group-hover:opacity-100 md:opacity-0 max-md:opacity-60 transition-opacity p-1.5 rounded-md",
          "text-muted-foreground hover:text-foreground active:text-foreground"
        )}
        onClick={speak}
        data-testid="button-speak-message"
        title="Listen"
      >
        <Volume2 className="w-4 h-4" />
      </button>
      {hasPlayed && !speaking && (
        <button
          className="opacity-0 group-hover:opacity-100 md:opacity-0 max-md:opacity-60 transition-opacity p-1.5 rounded-md text-muted-foreground hover:text-foreground active:text-foreground"
          onClick={speak}
          data-testid="button-replay-message"
          title="Replay"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function parseToolsMeta(content: string): { tools: ToolCallInfo[]; cleanContent: string } {
  const match = content.match(/^<!-- tools:(\[[\s\S]*?\]) -->\n?/);
  if (!match) return { tools: [], cleanContent: content };
  try {
    const parsed = JSON.parse(match[1]);
    const tools: ToolCallInfo[] = parsed.map((t: any) => ({ name: t.name, input: t.input || {}, output: t.output, done: true }));
    return { tools, cleanContent: content.slice(match[0].length) };
  } catch {
    return { tools: [], cleanContent: content };
  }
}

function parseAutoRouteMeta(content: string): { route: { model: string; label: string; category: string; reason: string } | null; cleanContent: string } {
  const match = content.match(/^<!-- auto_route:(\{[\s\S]*?\}) -->\n?/);
  if (!match) return { route: null, cleanContent: content };
  try {
    return { route: JSON.parse(match[1]), cleanContent: content.slice(match[0].length) };
  } catch {
    return { route: null, cleanContent: content };
  }
}

function parseAttachmentsMeta(content: string): { attachments: Attachment[]; cleanContent: string } {
  const match = content.match(/^<!-- attachments:(\[[\s\S]*?\]) -->\n?/);
  if (!match) return { attachments: [], cleanContent: content };
  try {
    const parsed = JSON.parse(match[1]);
    return { attachments: parsed, cleanContent: content.slice(match[0].length) };
  } catch {
    return { attachments: [], cleanContent: content };
  }
}

function parseThinkBlocks(content: string): { thinking: string | null; response: string } {
  const thinkMatch = content.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/);
  if (!thinkMatch) return { thinking: null, response: content };
  const thinking = thinkMatch[1].trim();
  const response = content.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g, "").trim();
  return { thinking, response };
}

function ThinkingBlock({ content, defaultOpen = false }: { content: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-2" data-testid="thinking-block">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
        data-testid="button-toggle-thinking-block"
      >
        <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
        <Brain className="w-3 h-3" />
        <span>Reasoning</span>
      </button>
      {open && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-muted-foreground/20 text-xs text-muted-foreground italic leading-relaxed whitespace-pre-wrap" data-testid="thinking-content">
          {content}
        </div>
      )}
    </div>
  );
}

const markdownComponents = {
  code({ node, className, children, ...props }: any) {
    const isInline = !className;
    return isInline ? (
      <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>
    ) : (
      <pre className="bg-muted rounded-md p-3 overflow-x-auto my-2">
        <code className="text-xs font-mono" {...props}>{children}</code>
      </pre>
    );
  },
  a({ href, children, ...props }: any) {
    const isUpload = href && (href.startsWith("/uploads/") || href.includes("/uploads/"));
    if (isUpload) {
      const filename = href.split("/").pop() || "file";
      const isPdf = filename.toLowerCase().endsWith(".pdf");
      const handleDownload = async (e: React.MouseEvent) => {
        e.preventDefault();
        try {
          const blobUrl = await fetchAuthBlob(href);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        } catch { }
      };
      return (
        <a
          href="#"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 my-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-medium transition-colors no-underline cursor-pointer"
          data-testid={`download-${filename}`}
          {...props}
        >
          {isPdf ? <FileText className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
          <span>{typeof children === "string" ? children : filename}</span>
          <Download className="w-3 h-3 opacity-60" />
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80" {...props}>
        {children}
      </a>
    );
  },
  img({ src, alt, ...props }: any) {
    const isScreenshot = src && (src.includes("/api/browser/screenshots/") || src.includes("lh3.googleusercontent.com/d/") || src.includes("drive.google.com/"));
    if (isScreenshot) {
      return (
        <div className="my-2">
          <img
            src={src}
            alt={alt || "Browser screenshot"}
            className="rounded-lg border border-border max-w-full max-h-[400px] object-contain cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => window.open(src, "_blank")}
            data-testid="chat-browser-screenshot"
            {...props}
          />
          {alt && alt !== "Browser screenshot" && <p className="text-[10px] text-muted-foreground mt-1">{alt}</p>}
        </div>
      );
    }
    return <img src={src} alt={alt} className="max-w-full rounded-lg my-2" {...props} />;
  },
  p({ children }: any) { return <p className="mb-2 last:mb-0">{children}</p>; },
  ul({ children }: any) { return <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>; },
  ol({ children }: any) { return <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>; },
};

function MessageBubble({ msg, agentName, streamThinking, streamThinkingDone, toolCalls, isLastAssistant }: { msg: Message; agentName: string; streamThinking?: string; streamThinkingDone?: boolean; toolCalls?: ToolCallInfo[]; isLastAssistant?: boolean }) {
  const isUser = msg.role === "user";
  const { attachments: userAttachments, cleanContent: contentAfterAttachments } = isUser ? parseAttachmentsMeta(msg.content) : { attachments: [], cleanContent: msg.content };
  const { route: autoRoute, cleanContent: contentAfterRoute } = !isUser ? parseAutoRouteMeta(msg.content) : { route: null, cleanContent: contentAfterAttachments };
  const { tools: storedTools, cleanContent } = !isUser ? parseToolsMeta(contentAfterRoute) : { tools: [], cleanContent: contentAfterRoute };
  const { thinking, response: rawResponse } = !isUser ? parseThinkBlocks(cleanContent) : { thinking: null, response: cleanContent };
  const { charts, cleanContent: response } = !isUser ? parseChartBlocks(rawResponse) : { charts: [], cleanContent: rawResponse };
  const chartDataFromTools = !isUser ? extractChartsFromTools(toolCalls || storedTools) : [];
  const allCharts = [...charts, ...chartDataFromTools];
  const showStreamThinking = !isUser && streamThinking !== undefined;
  const allToolCalls = toolCalls && toolCalls.length > 0 ? toolCalls : storedTools.length > 0 ? storedTools : null;
  const imageAttachments = userAttachments.filter((a) => a.type.startsWith("image/"));
  const fileAttachments = userAttachments.filter((a) => !a.type.startsWith("image/"));

  return (
    <div className={cn("flex gap-3 group", isUser ? "flex-row-reverse" : "flex-row")} data-testid={`message-${msg.id}`}>
      <div className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm mt-0.5",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      )}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <span>🦞</span>}
      </div>
      <div className={cn("flex flex-col gap-1 max-w-[75%]", isUser ? "items-end" : "items-start")}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">
            {isUser ? "You" : agentName}
          </span>
          <span className="text-xs text-muted-foreground/60">
            {format(new Date(msg.createdAt), "h:mm a")}
          </span>
          {autoRoute && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1" data-testid="badge-auto-route">
              <Sparkles className="w-2.5 h-2.5" /> {autoRoute.label}
            </span>
          )}
          {!isUser && <CopyButton text={response || msg.content} />}
          {!isUser && <SpeakButton text={response || msg.content} isLastAssistant={isLastAssistant} />}
        </div>
        {isUser && imageAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end" data-testid="message-image-attachments">
            {imageAttachments.map((att, idx) => (
              <AuthImage
                key={idx}
                src={att.url}
                alt={att.name}
                className="rounded-lg max-w-[200px] max-h-[200px] object-cover border border-border"
                data-testid={`img-attachment-${idx}`}
              />
            ))}
          </div>
        )}
        {isUser && fileAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end" data-testid="message-file-attachments">
            {fileAttachments.map((att, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-xs bg-primary/80 text-primary-foreground rounded-lg px-2 py-1">
                <FileText className="w-3 h-3" />
                <span className="truncate max-w-[120px]">{att.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className={cn(
          "rounded-xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-card border border-card-border text-card-foreground rounded-tl-sm prose prose-sm dark:prose-invert max-w-none"
        )}>
          {isUser ? response : (
            <>
              {showStreamThinking && streamThinking && (
                <ThinkingBlock content={streamThinking} defaultOpen={!streamThinkingDone} />
              )}
              {!showStreamThinking && thinking && (
                <ThinkingBlock content={thinking} defaultOpen={false} />
              )}
              {allToolCalls && (
                <ToolCallsBlock calls={allToolCalls} />
              )}
              {response ? (() => {
                const canvasData = extractCanvasBlocks(response);
                if (canvasData) {
                  return (
                    <>
                      {canvasData.before && (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {canvasData.before}
                        </ReactMarkdown>
                      )}
                      <LiveCanvas html={canvasData.canvasHtml} title={canvasData.canvasTitle} />
                      {canvasData.after && (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {canvasData.after}
                        </ReactMarkdown>
                      )}
                    </>
                  );
                }
                return (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {response}
                  </ReactMarkdown>
                );
              })() : showStreamThinking && !streamThinkingDone ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Reasoning...</span>
                </div>
              ) : null}
              {allCharts.map((chart, i) => (
                <ChartRenderer key={i} chart={chart} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface OrchestrationStepInfo {
  taskId: number;
  description: string;
  persona: string;
  status: "pending" | "running" | "complete" | "failed";
  error: string | null;
  retried: boolean;
  startedAt: number | null;
  completedAt: number | null;
}

interface OrchestrationPlanInfo {
  planId: string;
  objective: string;
  status: string;
  steps: OrchestrationStepInfo[];
  failedCount: number;
  elapsedMs: number | null;
  event: string | null;
}

const PERSONA_COLORS: Record<string, string> = {
  Forge: "text-orange-400",
  Teagan: "text-pink-400",
  Radar: "text-cyan-400",
  Neptune: "text-blue-400",
  Scribe: "text-purple-400",
  Proof: "text-green-400",
  Apollo: "text-yellow-400",
  Atlas: "text-emerald-400",
  "Chief of Staff": "text-slate-400",
  Lobster: "text-red-400",
  VisionClaw: "text-primary",
};

function OrchestrationPlanCard({ plan }: { plan: OrchestrationPlanInfo }) {
  const [showReport, setShowReport] = useState(false);
  const completed = plan.steps.filter(s => s.status === "complete").length;
  const failed = plan.steps.filter(s => s.status === "failed").length;
  const running = plan.steps.filter(s => s.status === "running").length;
  const total = plan.steps.length;
  const isDone = plan.status === "complete" || plan.status === "failed";
  const progressPct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
  const hasFails = failed > 0;
  const failedSteps = plan.steps.filter(s => s.status === "failed");
  const retriedSteps = plan.steps.filter(s => s.retried);
  const elapsed = plan.elapsedMs ? (plan.elapsedMs / 1000).toFixed(0) : null;

  const formatDuration = (startMs: number | null, endMs: number | null) => {
    if (!startMs || !endMs) return null;
    const secs = ((endMs - startMs) / 1000).toFixed(1);
    return `${secs}s`;
  };

  const friendlyError = (err: string | null) => {
    if (!err) return "Unknown error";
    if (/timed?\s*out|timeout/i.test(err)) return "Timed out — the step took too long and was stopped";
    if (/ETIMEDOUT|ESOCKETTIMEDOUT|socket hang up/i.test(err)) return "Network connection lost to the AI provider";
    if (/Plan timeout exceeded/i.test(err)) return "Overall plan time limit exceeded — remaining steps were cancelled";
    if (/rate.?limit|429|too many/i.test(err)) return "Hit rate limit from AI provider — too many requests too fast";
    if (/quota|billing|insufficient/i.test(err)) return "API quota or billing limit reached";
    if (/auth|unauthorized|403|401/i.test(err)) return "Authentication error with external service";
    if (/tool.*not found|unknown tool/i.test(err)) return "Tried to use a tool that doesn't exist";
    if (err.length > 200) return err.slice(0, 200) + "...";
    return err;
  };

  return (
    <div className="mb-3 rounded-lg border border-primary/20 bg-primary/5 overflow-hidden" data-testid="orchestration-plan-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <Crown className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="text-xs font-semibold text-primary/90">CEO Orchestrator</span>
        {elapsed && !isDone && (
          <span className="text-[9px] text-muted-foreground">{elapsed}s</span>
        )}
        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isDone ? (plan.status === "complete" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400") : "bg-amber-500/10 text-amber-400"}`}>
          {plan.status === "complete" ? "Complete" : plan.status === "failed" ? "Failed" : running > 0 ? "Executing" : "Planning"}
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{plan.objective}</p>
        <div className="w-full h-1.5 rounded-full bg-muted/30 mb-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${hasFails ? "bg-gradient-to-r from-green-500 to-red-500" : "bg-green-500"}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="space-y-1.5">
          {plan.steps.map((step) => {
            const icon = step.status === "complete" ? <Check className="w-3 h-3 text-green-500" /> :
              step.status === "failed" ? <AlertTriangle className="w-3 h-3 text-red-500" /> :
              step.status === "running" ? <Loader2 className="w-3 h-3 animate-spin text-amber-400" /> :
              <div className="w-3 h-3 rounded-full border border-muted-foreground/30" />;
            const duration = formatDuration(step.startedAt, step.completedAt);
            return (
              <div key={step.taskId} data-testid={`orchestration-step-${step.taskId}`}>
                <div className="flex items-start gap-2 text-[11px]">
                  <div className="shrink-0 mt-0.5">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <span className="text-foreground/80">{step.description}</span>
                    <span className={`ml-1.5 ${PERSONA_COLORS[step.persona] || "text-muted-foreground"}`}>
                      [{step.persona}]
                    </span>
                    {step.retried && (
                      <span className="ml-1 text-[9px] text-amber-400/80">(retried)</span>
                    )}
                    {duration && (
                      <span className="ml-1 text-[9px] text-muted-foreground/60">{duration}</span>
                    )}
                  </div>
                </div>
                {step.status === "failed" && step.error && (
                  <div className="ml-5 mt-0.5 text-[10px] text-red-400/90 bg-red-500/5 rounded px-2 py-1 border border-red-500/10">
                    {friendlyError(step.error)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isDone && (
          <div className="mt-2 pt-2 border-t border-primary/10">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                {completed}/{total} steps completed{hasFails ? `, ${failed} failed` : ""}
                {elapsed ? ` in ${elapsed}s` : ""}
              </p>
              {hasFails && (
                <button
                  onClick={() => setShowReport(!showReport)}
                  className="text-[10px] text-red-400 hover:text-red-300 underline underline-offset-2 transition-colors"
                  data-testid="btn-failure-report"
                >
                  {showReport ? "Hide Report" : "View Failure Report"}
                </button>
              )}
            </div>
          </div>
        )}

        {showReport && hasFails && (
          <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/5 p-3 space-y-3" data-testid="failure-report-panel">
            <div className="flex items-center gap-2 text-xs font-semibold text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              Failure Report
            </div>

            <div className="text-[11px] text-muted-foreground space-y-1">
              <p><span className="text-foreground/80 font-medium">Objective:</span> {plan.objective}</p>
              <p><span className="text-foreground/80 font-medium">Result:</span> {completed} of {total} steps succeeded, {failed} failed{retriedSteps.length > 0 ? `, ${retriedSteps.length} retried` : ""}</p>
              {elapsed && <p><span className="text-foreground/80 font-medium">Total time:</span> {elapsed}s</p>}
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-red-400/90 uppercase tracking-wide">Failed Steps</p>
              {failedSteps.map((step) => (
                <div key={step.taskId} className="rounded border border-red-500/15 bg-red-500/5 px-2.5 py-2 space-y-1">
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-mono text-red-400/70 shrink-0">#{step.taskId}</span>
                    <div className="text-[11px] text-foreground/80 flex-1">{step.description}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={`${PERSONA_COLORS[step.persona] || "text-muted-foreground"}`}>{step.persona}</span>
                    {step.retried && <span className="text-amber-400/80">Auto-retried</span>}
                    {formatDuration(step.startedAt, step.completedAt) && (
                      <span className="text-muted-foreground/60">Duration: {formatDuration(step.startedAt, step.completedAt)}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1.5 mt-1">
                    <span className="font-medium">Why it failed:</span> {friendlyError(step.error)}
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[10px] text-muted-foreground/80 border-t border-red-500/10 pt-2 space-y-0.5">
              <p className="font-medium text-foreground/60">What you can do:</p>
              {failedSteps.some(s => /timed?\s*out|timeout/i.test(s.error || "")) && (
                <p>- Timeout failures: Try breaking the task into smaller pieces, or ask for just one part at a time</p>
              )}
              {failedSteps.some(s => /rate.?limit|429/i.test(s.error || "")) && (
                <p>- Rate limit: Wait a minute and try again</p>
              )}
              {failedSteps.some(s => /tool.*not found|unknown tool/i.test(s.error || "")) && (
                <p>- Tool error: The agent tried to use a capability that isn't available. Rephrase your request</p>
              )}
              <p>- You can retry the same request — Felix will attempt a fresh approach</p>
              <p>- For complex tasks, try asking for one deliverable at a time</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ToolCallInfo {
  id?: string;
  name: string;
  input: Record<string, any>;
  output?: any;
  done: boolean;
  confirmationId?: string;
  riskLevel?: string;
  toolDescription?: string;
  awaitingApproval?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  test_api_keys: "Testing API Keys",
  check_system_status: "Checking System Status",
  list_models: "Listing Models",
  search_memory: "Searching Memory",
  create_memory: "Storing Memory",
  search_knowledge: "Searching Knowledge",
  create_knowledge: "Storing Knowledge",
  get_daily_notes: "Reading Daily Notes",
  list_conversations: "Listing Conversations",
  web_fetch: "Fetching Web Content",
  web_search: "Searching the Web",
  write_daily_note: "Writing Daily Note",
  update_memory: "Updating Memory",
  delegate_task: "Delegating Task",
  generate_chart: "Generating Chart",
  orchestrate: "CEO Orchestrating",
  plan_and_execute: "Planning & Executing",
  deep_research: "Deep Researching",
  lobster: "Multi-Agent Dispatch",
  browser: "Browsing the Web",
  create_pdf: "Creating PDF Document",
  create_slides: "Building Presentation",
  create_spreadsheet: "Creating Spreadsheet",
  send_email: "Sending Email",
  google_drive: "Accessing Google Drive",
  create_document: "Writing Document",
  analyze_pdf: "Analyzing PDF",
  generate_audio: "Generating Audio",
  create_slideshow_video: "Producing Video",
  firecrawl_scrape: "Scraping Web Page",
  firecrawl_search: "Searching with Firecrawl",
  draft_social_post: "Drafting Social Post",
  publish_social_post: "Publishing Social Post",
  vision_browse: "Vision Browsing",
  exec: "Running Code",
  execute_code: "Executing Code",
  calendar_sync: "Syncing Calendar",
  check_inbox: "Checking Inbox",
  read_file: "Reading File",
  debate: "Running AI Debate",
  tree_of_thought: "Thinking Deeply",
  estimate_cost: "Estimating Cost",
};

function friendlyToolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ActionBalloon {
  id: string;
  label: string;
  timestamp: number;
}

function ActionBalloons({ balloons }: { balloons: ActionBalloon[] }) {
  const visible = balloons.slice(-4);
  if (visible.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-[60] flex flex-col gap-2 pointer-events-none" data-testid="action-balloons">
      {visible.map((b, i) => (
        <div
          key={b.id}
          className="flex items-center gap-2.5 px-4 py-2.5 bg-primary/95 text-primary-foreground rounded-xl shadow-lg backdrop-blur-sm animate-in slide-in-from-right-5 fade-in duration-500"
          style={{ animationDelay: `${i * 80}ms`, opacity: i < visible.length - 1 ? 0.7 : 1 }}
          data-testid={`action-balloon-${b.id}`}
        >
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="text-sm font-medium">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function ToolApprovalCard({ call }: { call: ToolCallInfo }) {
  const [responding, setResponding] = useState(false);
  const [decided, setDecided] = useState<boolean | null>(null);

  const handleDecision = async (approved: boolean) => {
    setResponding(true);
    try {
      await apiRequest("POST", `/api/tool-confirm/${call.confirmationId}`, { approved });
      setDecided(approved);
    } catch {
      setDecided(false);
    } finally {
      setResponding(false);
    }
  };

  if (decided !== null) {
    return (
      <div className={`mt-1.5 p-2 rounded-md border text-xs ${decided ? "border-green-500/30 bg-green-500/5 text-green-400" : "border-red-500/30 bg-red-500/5 text-red-400"}`}>
        <div className="flex items-center gap-1.5">
          {decided ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldX className="w-3.5 h-3.5" />}
          <span className="font-medium">{decided ? "Approved" : "Denied"}</span>
        </div>
      </div>
    );
  }

  const inputSummary = Object.entries(call.input || {})
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)}`)
    .join("\n");

  return (
    <div className="mt-1.5 p-3 rounded-md border border-amber-500/30 bg-amber-500/5" data-testid="tool-approval-card">
      <div className="flex items-start gap-2 mb-2">
        <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-amber-400">This action requires your approval</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{call.toolDescription || "High-risk tool execution"}</p>
        </div>
      </div>
      {inputSummary && (
        <pre className="text-[10px] p-2 rounded bg-muted/50 text-muted-foreground mb-2 whitespace-pre-wrap break-words max-h-[80px] overflow-y-auto">{inputSummary}</pre>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => handleDecision(true)}
          disabled={responding}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors disabled:opacity-50"
          data-testid="button-approve-tool"
        >
          {responding ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
          Approve
        </button>
        <button
          onClick={() => handleDecision(false)}
          disabled={responding}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors disabled:opacity-50"
          data-testid="button-deny-tool"
        >
          {responding ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldX className="w-3 h-3" />}
          Deny
        </button>
      </div>
    </div>
  );
}

function ToolCallsBlock({ calls }: { calls: ToolCallInfo[] }) {
  const hasApprovalPending = calls.some((c) => c.awaitingApproval);
  const [expanded, setExpanded] = useState(hasApprovalPending);
  const completedCount = calls.filter((c) => c.done).length;
  const allDone = completedCount === calls.length && !hasApprovalPending;

  useEffect(() => {
    if (hasApprovalPending) setExpanded(true);
  }, [hasApprovalPending]);

  return (
    <div className="mb-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 overflow-hidden" data-testid="tool-calls-block">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-primary/80 hover:bg-primary/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-tools"
      >
        {allDone ? (
          <Check className="w-3 h-3 shrink-0" />
        ) : (
          <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
        )}
        <Wrench className="w-3 h-3 shrink-0" />
        <span className="font-medium">
          {allDone ? `Used ${calls.length} tool${calls.length > 1 ? "s" : ""}` : `Running tools (${completedCount}/${calls.length})...`}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-primary/10">
          {calls.map((call, i) => (
            <div key={i} className="text-xs mt-1.5">
              <div className="flex items-center gap-1.5 text-primary/70">
                {call.awaitingApproval ? (
                  <ShieldAlert className="w-3 h-3 text-amber-500" />
                ) : call.done ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                <span className="font-medium">{TOOL_LABELS[call.name] || call.name}</span>
                {Object.keys(call.input).length > 0 && !call.awaitingApproval && (
                  <span className="text-muted-foreground truncate max-w-[200px]">
                    ({Object.values(call.input).map(String).join(", ")})
                  </span>
                )}
              </div>
              {call.awaitingApproval && call.confirmationId && (
                <ToolApprovalCard call={call} />
              )}
              {call.done && call.output && (() => {
                const out = typeof call.output === "string" ? (() => { try { return JSON.parse(call.output); } catch { return null; } })() : call.output;
                const fileUrl = out?.url && typeof out.url === "string" && out.url.startsWith("/uploads/") ? out.url : null;
                const browserScreenshotUrl = out?.screenshotUrl && typeof out.screenshotUrl === "string" && out.screenshotUrl.startsWith("/api/browser/screenshots/") ? out.screenshotUrl : null;
                const filePath = out?.path && typeof out.path === "string" ? out.path : null;
                return (
                  <>
                    {fileUrl && (
                      <a
                        href={getAuthUrl(fileUrl)}
                        download={fileUrl.split("/").pop() || "file"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 mt-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-medium transition-colors no-underline"
                        data-testid={`download-tool-output-${i}`}
                      >
                        {fileUrl.endsWith(".pdf") ? <FileText className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                        <span>{fileUrl.split("/").pop()}</span>
                        <Download className="w-3 h-3 opacity-60" />
                      </a>
                    )}
                    {browserScreenshotUrl && (
                      <div className="mt-1.5">
                        <img
                          src={browserScreenshotUrl}
                          alt={out?.title || "Browser screenshot"}
                          className="rounded-lg border border-border max-w-full max-h-[300px] object-contain cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(browserScreenshotUrl, "_blank")}
                          data-testid={`browser-screenshot-${i}`}
                        />
                        {out?.url && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{out.url}</p>}
                      </div>
                    )}
                    <pre className="mt-1 p-2 rounded bg-muted/50 text-[10px] text-muted-foreground overflow-x-auto max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words">
                      {typeof call.output === "string" ? call.output : JSON.stringify(call.output, null, 2).slice(0, 1000)}
                    </pre>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingIndicator({ name }: { name: string }) {
  return (
    <div className="flex gap-3" data-testid="thinking-indicator">
      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5 text-sm">🦞</div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{name}</span>
        <div className="bg-card border border-card-border rounded-xl rounded-tl-sm px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">Thinking...</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [, params] = useRoute("/chat/:id");
  const [location, navigate] = useLocation();
  const conversationId = params ? parseInt(params.id) : null;
  const { toast } = useToast();

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamThinking, setStreamThinking] = useState("");
  const [streamThinkingDone, setStreamThinkingDone] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [projectBanner, setProjectBanner] = useState<{ projectId: number; projectName: string; trigger: string } | null>(null);
  const [deliveryBanner, setDeliveryBanner] = useState<{ id: number; presenterToken?: string; presenterUrl?: string; editUrl?: string; slideCount?: number; personaName?: string; toolName?: string } | null>(null);
  const [orchestrationPlan, setOrchestrationPlan] = useState<OrchestrationPlanInfo | null>(null);
  const [browserLive, setBrowserLive] = useState<{ visible: boolean; screenshotUrl?: string; statusText: string; pageTitle?: string; pageUrl?: string; type: string; stepCount: number; minimized: boolean; visionNarration?: string }>({ visible: false, statusText: "", type: "", stepCount: 0, minimized: false });
  const browserLiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionBalloons, setActionBalloons] = useState<ActionBalloon[]>([]);
  const balloonTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem("vc_tts_enabled") === "true");
  const ttsEnabledRef = useRef(ttsEnabled);
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);
  useEffect(() => { setProjectBanner(null); setSuggestedQuestions([]); setDeliveryBanner(null); }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const checkDeliveries = async () => {
      try {
        const resp = await authFetch(`/api/conversations/${conversationId}/pending-deliveries`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.deliveries?.length > 0) {
            const d = data.deliveries[0];
            const p = d.payload || {};
            setDeliveryBanner({ id: d.id, presenterToken: p.presenterToken, presenterUrl: p.presenterUrl, editUrl: p.editUrl, slideCount: p.slideCount, personaName: p.personaName, toolName: p.toolName });
          }
        }
      } catch {}
    };
    const timer = setTimeout(checkDeliveries, 2000);
    return () => clearTimeout(timer);
  }, [conversationId]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(() => localStorage.getItem("vc_suggestions_enabled") !== "false");
  const suggestionsEnabledRef = useRef(suggestionsEnabled);
  useEffect(() => { suggestionsEnabledRef.current = suggestionsEnabled; localStorage.setItem("vc_suggestions_enabled", String(suggestionsEnabled)); }, [suggestionsEnabled]);
  const [talkModeActive, setTalkModeActive] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [chatDragOver, setChatDragOver] = useState(false);
  const chatDropRef = useRef<HTMLDivElement>(null);

  const { data: conv, isLoading } = useQuery<Conversation & { messages: Message[] }>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
  });

  const { data: modelsData } = useQuery<{ models: ModelInfo[] }>({
    queryKey: ["/api/models"],
  });
  const availableModels = modelsData?.models || [];

  const { data: settings } = useQuery<{ agentName: string; defaultModel: string; thinkingEnabled: boolean }>({
    queryKey: ["/api/settings"],
  });

  const { data: personasList } = useQuery<Persona[]>({
    queryKey: ["/api/personas"],
  });

  const { data: voiceWakeData } = useQuery<{ triggers: string[] }>({
    queryKey: ["/api/voice/wake"],
  });

  const activePersona = personasList?.find((p) => p.isActive);

  const [contextDismissed, setContextDismissed] = useState(false);

  const activatePersonaMutation = useMutation({
    mutationFn: (personaId: number) => apiRequest("POST", `/api/personas/${personaId}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
  });

  const agentName = activePersona?.name || settings?.agentName || "VisionClaw";
  const messages: Message[] = conv?.messages || [];

  interface ContextSummary {
    greeting: string;
    lastConversations: { title: string; updatedAt: string }[];
    activePersona: { name: string; role: string } | null;
    recentMemories: { fact: string; category: string }[];
    todayNotes: string | null;
  }
  const { data: contextSummary } = useQuery<ContextSummary>({
    queryKey: ["/api/context/summary"],
    enabled: !!conversationId && messages.length === 0,
  });

  const updateConvMutation = useMutation({
    mutationFn: (data: Partial<Conversation>) => apiRequest("PATCH", `/api/conversations/${conversationId}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] }),
  });

  useEffect(() => {
    return () => {
      balloonTimersRef.current.forEach((t) => clearTimeout(t));
      balloonTimersRef.current.clear();
    };
  }, []);

  const syncStreamRef = useRef<string>("");

  useEffect(() => {
    if (!conversationId) return;
    const es = new EventSource(`/api/conversations/${conversationId}/sync`, { withCredentials: true });
    let remoteSyncContent = "";

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "new_message") {
          queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
          queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
          if (!streaming) {
            remoteSyncContent = "";
            syncStreamRef.current = "";
            setStreamingContent("");
            setStreaming(false);
          }
        } else if (data.type === "stream" && !streaming) {
          remoteSyncContent += data.content;
          syncStreamRef.current = remoteSyncContent;
          setStreamingContent(remoteSyncContent);
          setStreaming(true);
        } else if (data.type === "title_update") {
          queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
          queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        } else if (data.type === "delivery_ready" && data.delivery) {
          const d = data.delivery;
          setDeliveryBanner({ id: 0, presenterToken: d.presenterToken, presenterUrl: d.presenterUrl, editUrl: d.editUrl, slideCount: d.slideCount, personaName: d.personaName, toolName: d.toolName });
        }
      } catch {}
    };

    return () => {
      es.close();
      remoteSyncContent = "";
      syncStreamRef.current = "";
    };
  }, [conversationId, streaming]);

  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    isNearBottomRef.current = true;
    setShowScrollDown(false);
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, streamingContent, streamThinking, toolCalls.length]);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 150;
    setShowScrollDown(distanceFromBottom > 150);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const stopGenerating = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    stopAllAutoTts();
  }, []);

  const regenerateLastResponse = useCallback(async () => {
    if (streaming || !messages.length) return;
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (!lastUserMsg) return;
    const { attachments: parsedAttachments, cleanContent } = parseAttachmentsMeta(lastUserMsg.content);
    if (cleanContent.trim() || parsedAttachments.length > 0) {
      sendMessage(cleanContent.trim(), parsedAttachments.length > 0 ? parsedAttachments : undefined);
    }
  }, [streaming, messages]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isModKey = e.metaKey || e.ctrlKey;
      if (isModKey && e.key === "n") {
        e.preventDefault();
        navigate("/chat/new");
      }
      if (e.key === "Escape") {
        if (streaming) {
          stopGenerating();
        } else if (input) {
          setInput("");
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [streaming, input, navigate, stopGenerating]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const data = await uploadFile(file);
          const isImage = file.type.startsWith("image/");
          const preview = isImage ? URL.createObjectURL(file) : undefined;
          setPendingAttachments((prev) => [...prev, { url: data.url, name: data.filename, type: file.type, preview }]);
        } catch (err: any) {
          toast({ description: `Failed to upload ${file.name}: ${err.message}`, variant: "destructive" });
        }
      }
    } catch (uploadErr: any) {
      console.error("[upload] Error:", uploadErr);
      toast({ description: `Upload failed: ${uploadErr?.message || "Unknown error"}`, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [toast]);

  const handleChatDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setChatDragOver(true);
  }, []);

  const handleChatDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (chatDropRef.current && !chatDropRef.current.contains(e.relatedTarget as Node)) {
      setChatDragOver(false);
    }
  }, []);

  const handleChatDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setChatDragOver(false);
    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;
    const MAX_SIZE = 50 * 1024 * 1024;
    setUploading(true);
    try {
      for (const file of Array.from(droppedFiles)) {
        if (file.size > MAX_SIZE) {
          toast({ description: `${file.name} exceeds 50 MB limit`, variant: "destructive" });
          continue;
        }
        try {
          const data = await uploadFile(file);
          const isImage = file.type.startsWith("image/");
          const preview = isImage ? URL.createObjectURL(file) : undefined;
          setPendingAttachments((prev) => [...prev, { url: data.url, name: data.filename, type: file.type, preview }]);
        } catch (err: any) {
          toast({ description: `Failed to upload ${file.name}: ${err.message}`, variant: "destructive" });
        }
      }
    } finally {
      setUploading(false);
    }
  }, [toast]);

  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef(false);

  const processAudioQueue = useCallback(async () => {
    if (audioPlayingRef.current) return;
    audioPlayingRef.current = true;
    while (audioQueueRef.current.length > 0) {
      const b64 = audioQueueRef.current.shift();
      if (!b64) continue;
      if (autoTtsAbortRef.current?.signal.aborted) break;
      try {
        await playMp3Base64(b64);
      } catch (e) {
        console.error("[TTS] Queue playback error:", e);
      }
    }
    audioPlayingRef.current = false;
  }, []);

  const autoSpeakText = useCallback(async (text: string) => {
    stopAllAutoTts();
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
    const abort = new AbortController();
    autoTtsAbortRef.current = abort;

    autoTtsState.active = true;
    autoTtsState.paused = false;
    notifyAutoTtsListeners();

    try {
      let audioCtx: AudioContext | null = null;
      let worklet: AudioWorkletNode | null = null;

      const res = await authFetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, streamed: true }),
        signal: abort.signal,
      });

      if (!res.ok) return;
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        if (abort.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (abort.signal.aborted) break;
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === "audio_mp3" && d.data) {
              audioQueueRef.current.push(d.data);
              processAudioQueue();
            }
            if (d.type === "audio" && d.data) {
              if (!audioCtx) {
                audioCtx = new AudioContext({ sampleRate: 24000 });
                await audioCtx.audioWorklet.addModule("/audio-playback-worklet.js");
                worklet = new AudioWorkletNode(audioCtx, "audio-playback-processor");
                worklet.connect(audioCtx.destination);
                autoTtsState.audioCtx = audioCtx;
              }
              const raw = atob(d.data);
              const int16 = new Int16Array(raw.length / 2);
              for (let i = 0; i < int16.length; i++) int16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
              const float32 = new Float32Array(int16.length);
              for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
              worklet?.port.postMessage({ type: "audio", samples: float32 });
            }
            if (d.type === "done" && worklet) worklet.port.postMessage({ type: "streamComplete" });
          } catch (playErr) {
            console.error("TTS playback error:", playErr);
          }
        }
      }
      if (audioCtx) setTimeout(() => audioCtx!.close(), 3000);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("Auto-speak error:", err);
    } finally {
      if (autoTtsAbortRef.current === abort) autoTtsAbortRef.current = null;
      autoTtsState.active = false;
      autoTtsState.paused = false;
    
      autoTtsState.audioCtx = null;
      notifyAutoTtsListeners();
    }
  }, [processAudioQueue]);

  const warmAudioRef = useRef<AudioContext | null>(null);

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("vc_tts_enabled", String(next));
      if (!next) {
        stopAllAutoTts();
      } else {
        warmAudioContext();
      }
      return next;
    });
  }, []);

  const speechRecognitionRef = useRef<any>(null);
  const voiceTranscriptRef = useRef("");
  const voiceActiveRef = useRef(false);
  const voiceFinalizedRef = useRef("");
  const SpeechRecognitionClass = useRef<any>(null);

  useEffect(() => {
    SpeechRecognitionClass.current = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
  }, []);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const useFallbackSTT = !SpeechRecognitionClass.current;

  const startVoiceRecording = useCallback(async () => {
    const SR = SpeechRecognitionClass.current;

    if (!SR) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "audio/mp4";
        const recorder = new MediaRecorder(stream, { mimeType });
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mediaRecorderRef.current = recorder;
        voiceActiveRef.current = true;
        setVoiceRecording(true);
        setVoiceTranscript("Listening...");
        recorder.start(250);
      } catch (err: any) {
        console.error("Mic access error:", err);
        toast({ description: "Microphone permission denied or not available.", variant: "destructive" });
      }
      return;
    }

    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.abort(); } catch {}
      speechRecognitionRef.current = null;
    }

    voiceActiveRef.current = true;
    voiceTranscriptRef.current = "";
    voiceFinalizedRef.current = "";
    setVoiceTranscript("");
    setVoiceRecording(true);

    function createRecognition() {
      const recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let finalText = "";
        let interim = "";
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalText += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
        if (finalText) {
          voiceFinalizedRef.current = (voiceFinalizedRef.current + " " + finalText).trim();
        }
        const display = (voiceFinalizedRef.current + (interim ? " " + interim : "")).trim();
        voiceTranscriptRef.current = display;
        setVoiceTranscript(display || "Listening...");
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        console.error("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          toast({ description: "Microphone permission denied. Allow mic access in browser settings.", variant: "destructive" });
          voiceActiveRef.current = false;
          setVoiceRecording(false);
        }
      };

      recognition.onend = () => {
        if (voiceActiveRef.current) {
          try {
            const newRecog = createRecognition();
            speechRecognitionRef.current = newRecog;
            newRecog.start();
          } catch {
            if (!voiceTranscriptRef.current.trim() && !voiceFinalizedRef.current.trim()) {
              voiceActiveRef.current = false;
              setVoiceRecording(false);
            }
          }
        }
      };

      return recognition;
    }

    try {
      const recognition = createRecognition();
      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error("Failed to start recognition:", err);
      toast({ description: "Could not start voice input.", variant: "destructive" });
      voiceActiveRef.current = false;
      setVoiceRecording(false);
    }
  }, [toast]);

  const stopVoiceRecording = useCallback(async () => {
    voiceActiveRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      const recorder = mediaRecorderRef.current;
      if (ttsEnabledRef.current) warmAudioContext();
      setVoiceTranscript("Transcribing...");

      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });

      recorder.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;

      const blob = new Blob(audioChunksRef.current, { type: audioChunksRef.current[0]?.type || "audio/webm" });
      audioChunksRef.current = [];

      if (blob.size < 1000) {
        toast({ description: "No speech detected. Tap the mic, speak, then tap again to send.", variant: "destructive" });
        setVoiceRecording(false);
        setVoiceTranscript("");
        return;
      }

      try {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1] || "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        const res = await authFetch("/api/voice/stt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: base64 }),
        });

        if (!res.ok) throw new Error("STT failed");
        const data = await res.json();
        const transcript = data.text?.trim();

        if (!transcript) {
          toast({ description: "Could not understand audio. Try speaking more clearly.", variant: "destructive" });
          setVoiceRecording(false);
          setVoiceTranscript("");
          return;
        }

        setInput(transcript);
        setVoiceRecording(false);
        setVoiceTranscript("");
        setTimeout(() => sendMessage(transcript), 100);
      } catch (err) {
        console.error("Server STT error:", err);
        toast({ description: "Voice transcription failed.", variant: "destructive" });
        setVoiceRecording(false);
        setVoiceTranscript("");
      }
      return;
    }

    const recognition = speechRecognitionRef.current;
    if (recognition) {
      try { recognition.abort(); } catch {}
      speechRecognitionRef.current = null;
    }

    setVoiceRecording(false);

    const transcript = voiceTranscriptRef.current.trim();
    voiceTranscriptRef.current = "";
    voiceFinalizedRef.current = "";

    if (!transcript) {
      toast({ description: "No speech detected. Tap the mic, speak, then tap again to send.", variant: "destructive" });
      setVoiceTranscript("");
      return;
    }

    if (ttsEnabledRef.current) warmAudioContext();
    setInput(transcript);
    setVoiceTranscript("");
    setTimeout(() => sendMessage(transcript), 100);
  }, [toast, sendMessage]);

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => {
      const removed = prev[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const hasAutoSent = useRef(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const promptParam = urlParams.get("prompt");
    if (promptParam && !hasAutoSent.current && conv && conv.messages.length === 0) {
      hasAutoSent.current = true;
      setInput(promptParam);
      window.history.replaceState({}, "", window.location.pathname);
      const timer = setTimeout(() => sendMessage(promptParam), 300);
      return () => clearTimeout(timer);
    }
  }, [conv]);

  async function sendMessage(overrideContent?: string, overrideAttachments?: Attachment[]) {
    const content = overrideContent || input.trim();
    const effectiveAttachments = overrideAttachments || pendingAttachments;
    if ((!content && effectiveAttachments.length === 0) || !conversationId || streaming) return;
    if (ttsEnabledRef.current) warmAudioContext();
    const attachments = [...effectiveAttachments];
    setInput("");
    for (const att of pendingAttachments) {
      if (att.preview) {
        try { URL.revokeObjectURL(att.preview); } catch {}
      }
    }
    setPendingAttachments([]);
    setStreaming(true);
    setStreamingContent("");
    setStreamThinking("");
    setStreamThinkingDone(false);
    setToolCalls([]);
    setProjectBanner(null);
    setOrchestrationPlan(null);
    setSuggestedQuestions([]);

    abortRef.current = new AbortController();
    let accumulatedResponse = "";
    let streamTtsBuffer = "";
    if (ttsEnabledRef.current) {
      stopStreamTts();
      streamTtsQueueRef.abort = new AbortController();
    }

    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    let staleCriticalTimer: ReturnType<typeof setTimeout> | null = null;
    let staleWarned = false;
    let errorShown = false;
    let hadError = false;
    let receivedMeaningfulData = false;

    try {
      const body: any = { content: content || "" };
      if (suggestionsEnabledRef.current) body.suggestQuestions = true;
      if (attachments.length > 0) {
        body.attachments = attachments.map((a) => ({ url: a.url, name: a.name, type: a.type }));
      }
      const res = await authFetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error("Failed to send");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";
      const STALE_TIMEOUT_MS = 45000;
      const STALE_CRITICAL_MS = 120000;

      const resetStaleTimer = () => {
        if (staleTimer) clearTimeout(staleTimer);
        if (staleCriticalTimer) clearTimeout(staleCriticalTimer);
        if (staleWarned) return;
        staleTimer = setTimeout(() => {
          if (!staleWarned) {
            staleWarned = true;
            toast({ description: "Working on a complex task — this may take a minute or two.", variant: "default" });
            setToolCalls((prev) => [...prev, {
              id: `stale_${Date.now()}`,
              name: "⏳ Long Processing",
              input: { elapsed: "45+ seconds without new data" },
              output: { status: "The agent is still working. Complex orchestration tasks can take 2-3 minutes." },
              done: true,
            }]);
          }
        }, STALE_TIMEOUT_MS);
        staleCriticalTimer = setTimeout(() => {
          toast({ description: "This is taking unusually long. If nothing appears soon, the connection may have dropped — try resending.", variant: "destructive" });
          setToolCalls((prev) => [...prev, {
            id: `stale_critical_${Date.now()}`,
            name: "⚠️ Extended Wait",
            input: { elapsed: "2+ minutes without new data" },
            output: { status: "If the agent doesn't respond soon, try stopping and resending your message." },
            done: true,
          }]);
        }, STALE_CRITICAL_MS);
      };

      const optimisticContent = attachments.length > 0
        ? `<!-- attachments:${JSON.stringify(attachments.map(a => ({ url: a.url, name: a.name, type: a.type })))} -->\n${content || ""}`
        : content;
      queryClient.setQueryData(
        ["/api/conversations", conversationId],
        (old: any) => old ? { ...old, messages: [...old.messages, { id: Date.now(), conversationId, role: "user", content: optimisticContent, createdAt: new Date().toISOString() }] } : old
      );

      resetStaleTimer();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetStaleTimer();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.thinking) {
              setStreamThinking((prev) => prev + data.thinking);
            }
            if (data.thinkEnd) {
              setStreamThinkingDone(true);
            }
            if (data.type === "orchestration_progress") {
              setOrchestrationPlan({
                planId: data.planId || "",
                objective: data.objective || "",
                status: data.status || "executing",
                steps: (data.steps || []).map((s: any) => ({
                  taskId: s.taskId,
                  description: s.description,
                  persona: s.persona,
                  status: s.status,
                  error: s.error || null,
                  retried: s.retried || false,
                  startedAt: s.startedAt || null,
                  completedAt: s.completedAt || null,
                })),
                failedCount: data.failed || 0,
                elapsedMs: data.elapsedMs || null,
                event: data.event || null,
              });
            }
            if (data.type === "thinking_progress") {
              const balloonId = `thinking_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              setActionBalloons((prev) => {
                const filtered = prev.filter((b) => !b.id.startsWith("thinking_"));
                return [...filtered.slice(-5), { id: balloonId, label: data.message || "Working...", timestamp: Date.now() }];
              });
              const timer = setTimeout(() => {
                setActionBalloons((prev) => prev.filter((b) => b.id !== balloonId));
                balloonTimersRef.current.delete(timer);
              }, 4000);
              balloonTimersRef.current.add(timer);
            }
            if (data.tool_call) {
              setToolCalls((prev) => [...prev, { id: data.tool_call.id, name: data.tool_call.name, input: data.tool_call.input || {}, done: false }]);
              const balloonId = `balloon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const label = friendlyToolLabel(data.tool_call.name);
              setActionBalloons((prev) => [...prev.slice(-5), { id: balloonId, label, timestamp: Date.now() }]);
              const timer = setTimeout(() => {
                setActionBalloons((prev) => prev.filter((b) => b.id !== balloonId));
                balloonTimersRef.current.delete(timer);
              }, 5000);
              balloonTimersRef.current.add(timer);
            }
            if (data.tool_result) {
              receivedMeaningfulData = true;
              setToolCalls((prev) => {
                const matchingCall = prev.find(tc => tc.id === data.tool_result.id && !tc.done);
                if (matchingCall?.name === "orchestrate" && data.tool_result.output) {
                  const out = typeof data.tool_result.output === "string"
                    ? (() => { try { return JSON.parse(data.tool_result.output); } catch { return null; } })()
                    : data.tool_result.output;
                  if (out?.planId) {
                    const stepsData = (out.steps || []).map((s: any) => ({
                      taskId: s.taskId,
                      description: s.description,
                      persona: s.persona || s.assignedPersona,
                      status: s.status,
                      error: s.error || null,
                      retried: !!(s as any)._retryCount || s.retried || false,
                      startedAt: s.startedAt || null,
                      completedAt: s.completedAt || null,
                    }));
                    setOrchestrationPlan({
                      planId: out.planId,
                      objective: out.objective || "",
                      status: out.status || "complete",
                      steps: stepsData,
                      failedCount: stepsData.filter((s: any) => s.status === "failed").length,
                      elapsedMs: out.elapsedMs || null,
                      event: null,
                    });
                  }
                }
                return prev.map((tc) =>
                  tc.id === data.tool_result.id && !tc.done
                    ? { ...tc, output: data.tool_result.output, done: true }
                    : tc
                );
              });
            }
            if (data.type === "tool_confirmation_required") {
              setToolCalls((prev) => [...prev, {
                id: `confirm_${data.confirmationId}`,
                name: `🛡️ Approval Required: ${data.toolName}`,
                input: data.args || {},
                done: false,
                confirmationId: data.confirmationId,
                riskLevel: data.riskLevel,
                toolDescription: data.description,
                awaitingApproval: true,
              }]);
            }
            if (data.type === "tool_confirmation_result") {
              if (data.approved) {
                setToolCalls((prev) => prev.filter((tc) => tc.confirmationId !== data.confirmationId));
              } else {
                setToolCalls((prev) => prev.map((tc) =>
                  tc.confirmationId === data.confirmationId
                    ? { ...tc, awaitingApproval: false, output: { status: "Denied — action blocked" }, done: true }
                    : tc
                ));
              }
            }
            if (data.browser_live) {
              if (browserLiveTimerRef.current) {
                clearTimeout(browserLiveTimerRef.current);
                browserLiveTimerRef.current = null;
              }
              setBrowserLive((prev) => ({
                visible: true,
                screenshotUrl: data.browser_live.screenshotBase64 || data.browser_live.screenshotUrl || prev.screenshotUrl,
                statusText: data.browser_live.statusText || prev.statusText,
                pageTitle: data.browser_live.pageTitle || prev.pageTitle,
                pageUrl: data.browser_live.pageUrl || prev.pageUrl,
                type: data.browser_live.type || prev.type,
                stepCount: prev.stepCount + 1,
                minimized: prev.minimized,
                visionNarration: data.browser_live.visionNarration || (data.browser_live.type === "analyzing" ? prev.visionNarration : undefined),
              }));
            }
            if (data.type === "tool_loop_detected") {
              setToolCalls((prev) => [...prev, {
                id: `loop_${Date.now()}`,
                name: `⚠️ Loop Detected (${data.detector})`,
                input: { level: data.level, message: data.message },
                output: { action: data.level === "critical" ? "Breaking loop" : "Warning issued" },
                done: true,
              }]);
            }
            if (data.type === "link_understanding") {
              const links = data.links?.filter((l: any) => !l.error) || [];
              if (links.length > 0) {
                setToolCalls((prev) => [...prev, {
                  id: `link_${Date.now()}`,
                  name: "🔗 Auto-fetched Links",
                  input: { urls: links.map((l: any) => l.url) },
                  output: { fetched: links.length, titles: links.map((l: any) => l.title).filter(Boolean) },
                  done: true,
                }]);
              }
            }
            if (data.type === "context_guard") {
              setToolCalls((prev) => [...prev, {
                id: `ctx_${Date.now()}`,
                name: data.action === "truncate" ? "⚠️ Context Truncated" : "📊 Context Warning",
                input: { usage: `${data.usage}%` },
                output: { message: data.message },
                done: true,
              }]);
            }
            if (data.type === "intake_interview") {
              setToolCalls((prev) => [...prev, {
                id: `intake_${Date.now()}`,
                name: data.phase === "offer" ? "📋 Intake Interview" : "📋 Interview In Progress",
                input: { phase: data.phase },
                output: { status: data.phase === "offer" ? "Offering questionnaire" : "Gathering requirements" },
                done: true,
              }]);
            }
            if (data.type === "tool_routing") {
              setToolCalls((prev) => [...prev, {
                id: `routing_${Date.now()}`,
                name: "🎯 Smart Tool Selection",
                input: { categories: data.categories?.join(", ") },
                output: { selected: `${data.selected}/${data.total} tools` },
                done: true,
              }]);
            }
            if (data.type === "auto_project") {
              setProjectBanner({ projectId: data.projectId, projectName: data.projectName, trigger: data.trigger || "project_keywords" });
              setToolCalls((prev) => [...prev, {
                id: `proj_${Date.now()}`,
                name: "📁 Project Created",
                input: { action: "Auto-created project for this work" },
                output: { projectId: data.projectId, name: data.projectName },
                done: true,
              }]);
            }
            if (data.type === "auto_route") {
              setToolCalls((prev) => [...prev, {
                id: `route_${Date.now()}`,
                name: "🧭 Auto-Routed",
                input: { category: data.category, reason: data.reason },
                output: { model: data.label },
                done: true,
              }]);
            }
            if (data.type === "self_heal") {
              setToolCalls((prev) => [...prev, {
                id: `heal_${Date.now()}`,
                name: `🔧 Self-Healing (attempt ${data.attempt})`,
                input: { tool: data.tool, error: data.error },
                output: { action: "Retrying with corrected parameters" },
                done: true,
              }]);
            }
            if (data.type === "failover") {
              setToolCalls((prev) => [...prev, {
                id: `failover_${Date.now()}`,
                name: "🔄 Model Failover",
                input: { from: data.from, reason: data.reason },
                output: { switchedTo: data.to, status: "Retrying with alternate model" },
                done: true,
              }]);
            }
            if (data.type === "adaptive_heal") {
              setToolCalls((prev) => [...prev, {
                id: `aheal_${Date.now()}`,
                name: `🩹 Adaptive Recovery`,
                input: { tool: data.tool, error: data.error },
                output: { attempt: data.attempt, hasLessons: data.hasLessons },
                done: true,
              }]);
            }
            if (data.type === "adaptive_escalation") {
              setToolCalls((prev) => [...prev, {
                id: `aesc_${Date.now()}`,
                name: `⚡ Escalation`,
                input: { tool: data.tool, reason: data.reason },
                output: { error: data.error, attempt: data.attempt },
                done: true,
              }]);
            }
            if (data.type === "fatal_error") {
              errorShown = true;
              hadError = true;
              const errMsg = typeof data.error === "string" ? data.error : "Something went wrong";
              const errDetail = data.errorDetail || "";
              setToolCalls((prev) => [...prev, {
                id: `err_fatal_${Date.now()}`,
                name: "❌ Operation Failed",
                input: { error: errMsg, ...(errDetail ? { detail: errDetail } : {}) },
                output: { status: errMsg },
                done: true,
              }]);
              toast({ description: errMsg, variant: "destructive" });
            }
            if (data.error && !data.content && !data.done && !errorShown && data.type !== "fatal_error") {
              errorShown = true;
              hadError = true;
              const errMsg = typeof data.error === "string" ? data.error : "Something went wrong";
              setToolCalls((prev) => [...prev, {
                id: `err_${Date.now()}`,
                name: "❌ System Error",
                input: { error: errMsg },
                output: { status: "The system encountered an issue. Your message may need to be resent." },
                done: true,
              }]);
              toast({ description: errMsg, variant: "destructive" });
            }
            if (data.type === "reflection") {
              if (data.status === "evaluating") {
                setToolCalls((prev) => [...prev, {
                  id: `reflect_${Date.now()}`,
                  name: "🪞 Self-Reflecting",
                  input: { action: "Evaluating response quality" },
                  output: { status: "evaluating..." },
                  done: false,
                }]);
              } else if (data.status === "complete") {
                setToolCalls((prev) => {
                  const updated = [...prev];
                  const reflIdx = updated.findIndex(t => t.name === "🪞 Self-Reflecting");
                  if (reflIdx >= 0) {
                    updated[reflIdx] = {
                      ...updated[reflIdx],
                      output: { scores: data.scores, verdict: data.shouldRefine ? "Refining..." : "Quality OK" },
                      done: !data.shouldRefine,
                    };
                  }
                  return updated;
                });
              } else if (data.status === "refined" && data.content) {
                setStreamingContent(data.content);
                setToolCalls((prev) => {
                  const updated = [...prev];
                  const reflIdx = updated.findIndex(t => t.name === "🪞 Self-Reflecting");
                  if (reflIdx >= 0) {
                    updated[reflIdx] = {
                      ...updated[reflIdx],
                      name: "🪞 Self-Reflected & Refined",
                      output: { ...updated[reflIdx].output, status: "Response improved" },
                      done: true,
                    };
                  }
                  return updated;
                });
              } else if (data.status === "refining") {
                setToolCalls((prev) => {
                  const updated = [...prev];
                  const reflIdx = updated.findIndex(t => t.name === "🪞 Self-Reflecting");
                  if (reflIdx >= 0) {
                    updated[reflIdx] = {
                      ...updated[reflIdx],
                      output: { ...updated[reflIdx].output, status: "Refining response..." },
                    };
                  }
                  return updated;
                });
              }
            }
            if (data.content && data.type !== "reflection") {
              receivedMeaningfulData = true;
              accumulatedResponse += data.content;
              setStreamingContent((prev) => prev + data.content);
              if (ttsEnabledRef.current) {
                streamTtsBuffer += data.content;
                const boundary = findSentenceBoundary(streamTtsBuffer);
                if (boundary > 0) {
                  const raw = streamTtsBuffer.slice(0, boundary).trim();
                  streamTtsBuffer = streamTtsBuffer.slice(boundary);
                  const chunk = cleanTextForSpeech(raw);
                  if (chunk) {
                    streamTtsQueueRef.current.push(chunk);
                    processStreamTtsQueue(authFetch);
                  }
                }
              }
            }
            if (data.suggestedQuestions && Array.isArray(data.suggestedQuestions)) {
              setSuggestedQuestions(data.suggestedQuestions);
            }
            if (data.titleUpdate) {
              queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
            }
            if (data.done) {
              receivedMeaningfulData = true;
              await queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
              await queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
              if (ttsEnabledRef.current && streamTtsBuffer.trim()) {
                const remaining = cleanTextForSpeech(streamTtsBuffer.trim());
                if (remaining) streamTtsQueueRef.current.push(remaining);
                processStreamTtsQueue(authFetch);
                streamTtsBuffer = "";
              } else if (ttsEnabledRef.current && accumulatedResponse.trim() && streamTtsQueueRef.current.length === 0 && !streamTtsQueueRef.processing) {
                autoSpeakText(cleanTextForSpeech(accumulatedResponse));
              }
              setStreamingContent("");
              setStreamThinking("");
              setStreamThinkingDone(false);
              if (!hadError) {
                setToolCalls([]);
              }
              setBrowserLive((prev) => prev.visible ? { ...prev, visible: false, statusText: "Done", stepCount: 0 } : prev);
            }
          } catch (streamErr) {
            console.error("[TTS] Stream parse error:", streamErr);
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        hadError = true;
        const errorDetail = err?.message?.includes("Failed to fetch")
          ? "Connection lost — please check your internet and try again."
          : err?.message?.includes("Failed to send")
          ? "The server couldn't process your message. Please try again."
          : err?.message || "Something went wrong. Please try again.";
        toast({ description: errorDetail, variant: "destructive" });
        setToolCalls((prev) => [...prev, {
          id: `err_${Date.now()}`,
          name: "❌ Connection Error",
          input: { error: errorDetail },
          output: { status: "Your message may not have been processed. Try resending." },
          done: true,
        }]);
      }
    } finally {
      if (staleTimer) clearTimeout(staleTimer);
      if (staleCriticalTimer) clearTimeout(staleCriticalTimer);
      setStreaming(false);
      setStreamThinking("");
      setStreamThinkingDone(false);

      if (!hadError && receivedMeaningfulData && !accumulatedResponse.trim()) {
        console.log("[stream-recovery] Stream ended after tool execution but no text response received — refetching conversation + checking deliveries");
        try {
          await new Promise(r => setTimeout(r, 1500));
          await queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
          await queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
          toast({ description: "Response recovered — scroll down to see the result.", variant: "default" });
        } catch {}
        try {
          const delResp = await authFetch(`/api/conversations/${conversationId}/pending-deliveries`);
          if (delResp.ok) {
            const delData = await delResp.json();
            if (delData.deliveries?.length > 0) {
              const d = delData.deliveries[0];
              const p = d.payload || {};
              setDeliveryBanner({ id: d.id, presenterToken: p.presenterToken, presenterUrl: p.presenterUrl, editUrl: p.editUrl, slideCount: p.slideCount, personaName: p.personaName, toolName: p.toolName });
            }
          }
        } catch {}
      } else if (!hadError && !receivedMeaningfulData) {
        hadError = true;
        const streamEndMsg = "The response stream ended without producing output. This usually means the agent timed out or the connection dropped during orchestration. Try sending your message again.";
        toast({ description: streamEndMsg, variant: "destructive" });
        setToolCalls((prev) => [...prev, {
          id: `err_stream_${Date.now()}`,
          name: "❌ Stream Ended Unexpectedly",
          input: { error: "No response received" },
          output: { status: streamEndMsg },
          done: true,
        }]);
      }

      if (!hadError) {
        setToolCalls([]);
        setStreamingContent("");
      } else {
        setStreamingContent("");
      }
      if (browserLiveTimerRef.current) clearTimeout(browserLiveTimerRef.current);
      browserLiveTimerRef.current = setTimeout(() => {
        setBrowserLive({ visible: false, statusText: "", type: "", stepCount: 0, minimized: false, visionNarration: undefined });
        browserLiveTimerRef.current = null;
      }, 8000);
    }
  }

  if (!conversationId) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-center px-6" data-testid="chat-welcome">
        <div className="max-w-md space-y-4">
          <h2 className="text-2xl font-semibold" data-testid="text-welcome-heading">Welcome to VisionClaw</h2>
          <p className="text-muted-foreground">Select a conversation from the sidebar or start a new chat to begin.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chatDropRef}
      className={`flex flex-col h-full bg-background relative ${chatDragOver ? "ring-2 ring-inset ring-primary" : ""}`}
      onDragOver={handleChatDragOver}
      onDragLeave={handleChatDragLeave}
      onDrop={handleChatDrop}
    >
      {chatDragOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
          <Upload className="w-12 h-12 text-primary mb-3 animate-bounce" />
          <p className="text-primary font-semibold text-xl">Drop files to attach</p>
          <p className="text-primary/60 text-sm mt-1">Images, PDFs, documents, spreadsheets — up to 50 MB each</p>
        </div>
      )}
      {/* Chat header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {isLoading ? (
            <Skeleton className="h-5 w-40" />
          ) : (
            <h2 className="text-sm font-medium truncate" data-testid="text-conversation-title">{conv?.title || "New Chat"}</h2>
          )}
          {conv?.thinking && (
            <Badge variant="secondary" className="gap-1 text-xs shrink-0">
              <Brain className="w-3 h-3" /> Thinking
            </Badge>
          )}
          {(conv as any)?.linkedProject && (
            <Badge
              variant="outline"
              className="gap-1 text-xs shrink-0 cursor-pointer border-primary/40 text-primary hover:bg-primary/10"
              onClick={() => navigate("/projects")}
              data-testid="badge-linked-project"
            >
              <FolderOpen className="w-3 h-3" /> {(conv as any).linkedProject.name}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {personasList && personasList.length > 0 && (
            <Select
              value={activePersona ? String(activePersona.id) : "none"}
              onValueChange={(v) => {
                if (v !== "none") {
                  activatePersonaMutation.mutate(parseInt(v));
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs w-auto max-w-[160px] gap-1" data-testid="select-persona">
                <Users className="w-3 h-3 shrink-0" />
                <SelectValue placeholder="Persona" />
              </SelectTrigger>
              <SelectContent>
                {personasList.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)} className="text-xs" data-testid={`select-persona-option-${p.id}`}>
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{p.name}</span>
                      {p.isActive && <Check className="w-3 h-3 text-green-500 shrink-0" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    size="icon"
                    variant={conv?.thinkingLevel && conv.thinkingLevel !== "off" ? "default" : "ghost"}
                    data-testid="button-toggle-thinking"
                  >
                    <Brain className="w-3.5 h-3.5" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Thinking: {conv?.thinkingLevel === "auto" ? "Auto (smart)" : conv?.thinkingLevel || "off"}</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-44 p-1.5" align="start">
              <div className="text-[11px] font-medium text-muted-foreground px-2 py-1">Thinking Level</div>
              {[
                { value: "auto", label: "Auto", desc: "Smart detect" },
                { value: "off", label: "Off", desc: "No reasoning" },
                { value: "low", label: "Low", desc: "Brief reasoning" },
                { value: "medium", label: "Medium", desc: "Step-by-step" },
                { value: "high", label: "High", desc: "Deep analysis" },
              ].map((level) => (
                <Button
                  key={level.value}
                  variant={conv?.thinkingLevel === level.value || (!(conv?.thinkingLevel) && level.value === "off") ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start h-7 text-xs"
                  data-testid={`button-thinking-${level.value}`}
                  onClick={() => updateConvMutation.mutate({ thinkingLevel: level.value })}
                >
                  <span className="font-medium">{level.label}</span>
                  <span className="text-muted-foreground ml-1">— {level.desc}</span>
                </Button>
              ))}
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                data-testid="button-toggle-model-select"
                onClick={() => setShowModelSelect((v) => !v)}
              >
                <Settings2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Change model</TooltipContent>
          </Tooltip>
          {showModelSelect && (
            <Select
              value={conv?.model || "gpt-5.1"}
              onValueChange={(v) => { updateConvMutation.mutate({ model: v }); setShowModelSelect(false); }}
            >
              <SelectTrigger className="h-7 text-xs w-32" data-testid="select-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    <span className="flex items-center gap-1.5">
                      {m.id === "auto" && <Sparkles className="w-3 h-3 text-amber-500" />}
                      {m.label}
                      {m.id !== "auto" && (
                        <span className={cn(
                          "text-[10px] px-1 rounded",
                          m.tier === "fast" && "bg-green-500/15 text-green-600 dark:text-green-400",
                          m.tier === "balanced" && "bg-blue-500/15 text-blue-600 dark:text-blue-400",
                          m.tier === "powerful" && "bg-purple-500/15 text-purple-600 dark:text-purple-400",
                          m.tier === "reasoning" && "bg-orange-500/15 text-orange-600 dark:text-orange-400",
                        )}>
                          {m.tier === "fast" ? "$" : m.tier === "balanced" ? "$$" : m.tier === "reasoning" ? "$$$" : "$$$"}
                        </span>
                      )}
                      {m.id === "auto" && (
                        <span className="text-[10px] px-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                          SMART
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative" data-testid="messages-container">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-7 h-7 rounded-full shrink-0" />
                <Skeleton className="h-16 flex-1 rounded-xl" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-16">
            {contextSummary && !contextDismissed && (
              <div className="w-full max-w-md mx-auto mb-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-left relative" data-testid="context-card">
                <button
                  onClick={() => setContextDismissed(true)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                  data-testid="button-dismiss-context"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <div className="text-sm font-medium text-foreground mb-1">{contextSummary.greeting}</div>
                {contextSummary.activePersona && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                    <Users className="w-3 h-3" /> Active: {contextSummary.activePersona.name} — {contextSummary.activePersona.role}
                  </div>
                )}
                {contextSummary.lastConversations.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    <span className="font-medium">Recent:</span> {contextSummary.lastConversations.map(c => c.title).join(", ")}
                  </div>
                )}
                {contextSummary.recentMemories.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    <span className="font-medium">Remembered:</span> {contextSummary.recentMemories.slice(0, 2).map(m => m.fact).join("; ")}
                  </div>
                )}
              </div>
            )}
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-4xl">🦞</div>
            <div>
              <h3 className="text-lg font-semibold">{agentName}</h3>
              <p className="text-muted-foreground text-sm mt-1">How can I help you today?</p>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 max-w-sm w-full">
              {["Draft an email for me", "Research a topic", "Help me brainstorm ideas", "Create a plan"].map((s) => (
                <button
                  key={s}
                  className="text-sm text-left px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, msgIdx) => {
              const isLastAssistant = !streaming && msg.role === "assistant" && !messages.slice(msgIdx + 1).some(m => m.role === "assistant");
              return <MessageBubble key={msg.id} msg={msg} agentName={agentName} isLastAssistant={isLastAssistant} />;
            })}
            {streaming && streamingContent === "" && !streamThinking && toolCalls.length === 0 && <ThinkingIndicator name={agentName} />}
            {orchestrationPlan && (streaming || orchestrationPlan.failedCount > 0) && (
              <div className="mb-2 max-w-3xl">
                <OrchestrationPlanCard plan={orchestrationPlan} />
              </div>
            )}
            {streaming && (streamingContent !== "" || streamThinking !== "" || toolCalls.length > 0) && (
              <MessageBubble
                msg={{ id: -1, conversationId: conversationId!, role: "assistant", content: streamingContent, createdAt: new Date().toISOString() } as any}
                agentName={agentName}
                streamThinking={streamThinking || undefined}
                streamThinkingDone={streamThinkingDone}
                toolCalls={toolCalls.length > 0 ? toolCalls : undefined}
                isLastAssistant={true}
              />
            )}
            {!streaming && suggestedQuestions.length > 0 && (
              <div className="flex flex-wrap gap-2 max-w-3xl mb-3 animate-in fade-in slide-in-from-bottom-2 duration-300" data-testid="suggested-questions">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    className="text-sm px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5 hover:bg-primary/10 dark:bg-primary/10 dark:hover:bg-primary/20 text-foreground/80 hover:text-foreground transition-colors"
                    data-testid={`button-suggested-question-${i}`}
                    onClick={() => {
                      setInput(q);
                      setSuggestedQuestions([]);
                      textareaRef.current?.focus();
                    }}
                  >
                    <Sparkles className="w-3 h-3 inline mr-1.5 text-primary/60" />
                    {q}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {projectBanner && !streaming && (
          <div className="mx-auto max-w-2xl w-full px-4 mb-4" data-testid="project-banner">
            <div className="rounded-lg border border-primary/30 bg-primary/5 dark:bg-primary/10 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-primary/10 p-2 shrink-0">
                  <FolderOpen className="w-5 h-5 text-primary" />
                </div>
                <div className="space-y-1 min-w-0 flex-1">
                  <p className="font-semibold text-sm" data-testid="text-project-banner-title">
                    This conversation is now a project
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {projectBanner.trigger === "extended_conversation"
                      ? "Your conversation has grown into an extended discussion, so it has been organized into a project to keep everything together."
                      : "Project-level work was detected, so this has been organized into a project to track your progress."}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All files, notes, and progress are saved. To continue this work later, open the project from the <strong>Projects</strong> page and start a new chat there.
                  </p>
                </div>
                <button
                  onClick={() => setProjectBanner(null)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  data-testid="button-dismiss-project-banner"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 pl-11">
                <button
                  onClick={() => navigate(`/projects?id=${projectBanner.projectId}`)}
                  className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-colors"
                  data-testid="button-view-project"
                >
                  View Project
                </button>
                <span className="text-xs text-muted-foreground">
                  {projectBanner.projectName}
                </span>
              </div>
            </div>
          </div>
        )}
        {deliveryBanner && !streaming && (
          <div className="mx-auto max-w-2xl w-full px-4 mb-4" data-testid="delivery-recovery-banner">
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 dark:bg-green-500/10 p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-green-500/10 p-2 shrink-0">
                  <Sparkles className="w-5 h-5 text-green-500" />
                </div>
                <div className="space-y-1 min-w-0 flex-1">
                  <p className="font-semibold text-sm" data-testid="text-delivery-title">
                    Presentation Ready
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {deliveryBanner.personaName || "The agent"} finished building your {deliveryBanner.slideCount ? `${deliveryBanner.slideCount}-slide ` : ""}presentation. Here are your links:
                  </p>
                </div>
                <button
                  onClick={() => {
                    setDeliveryBanner(null);
                    if (deliveryBanner.id && conversationId) {
                      authFetch(`/api/conversations/${conversationId}/acknowledge-delivery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deliveryId: deliveryBanner.id }) }).catch(() => {});
                    }
                  }}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  data-testid="button-dismiss-delivery"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-11">
                {deliveryBanner.presenterToken && (
                  <a
                    href={deliveryBanner.presenterUrl || `/present/${deliveryBanner.presenterToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 font-medium transition-colors inline-flex items-center gap-1.5"
                    data-testid="link-presenter"
                  >
                    <Play className="w-3 h-3" /> Narrated Presentation
                  </a>
                )}
                {deliveryBanner.editUrl && (
                  <a
                    href={deliveryBanner.editUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 font-medium transition-colors inline-flex items-center gap-1.5"
                    data-testid="link-edit-slides"
                  >
                    <FileText className="w-3 h-3" /> Edit in Google Slides
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom + Stop generating + Regenerate */}
      <div className="flex justify-center gap-2 px-4 -mt-2 mb-1 shrink-0">
        {showScrollDown && (
          <button
            onClick={scrollToBottom}
            data-testid="button-scroll-bottom"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/80 hover:bg-muted border border-border text-xs text-muted-foreground hover:text-foreground transition-all shadow-sm backdrop-blur-sm"
          >
            <ArrowDown className="w-3 h-3" />
            <span>Scroll to bottom</span>
          </button>
        )}
        {streaming && (
          <button
            onClick={stopGenerating}
            data-testid="button-stop-generating"
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-destructive hover:bg-destructive/90 border-2 border-destructive/50 text-sm font-semibold text-destructive-foreground transition-all shadow-lg hover:shadow-xl active:scale-95 animate-pulse"
          >
            <Square className="w-4 h-4 fill-current" />
            <span>Stop generating</span>
          </button>
        )}
        {!streaming && messages.length >= 2 && messages[messages.length - 1]?.role === "assistant" && (
          <button
            onClick={regenerateLastResponse}
            data-testid="button-regenerate"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/80 hover:bg-muted border border-border text-xs text-muted-foreground hover:text-foreground transition-all shadow-sm"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Regenerate</span>
          </button>
        )}
      </div>

      {/* Floating TTS toggle */}
      <div className="flex justify-end px-4 pb-1 shrink-0">
        <button
          onClick={toggleTts}
          data-testid="button-tts-float"
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg transition-all duration-200 text-sm font-medium",
            ttsEnabled
              ? "bg-primary text-primary-foreground ring-2 ring-primary/30 animate-pulse-slow"
              : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
          )}
        >
          {ttsEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          <span>{ttsEnabled ? "Speaker On" : "Speaker Off"}</span>
        </button>
        <button
          onClick={() => setSuggestionsEnabled(p => { if (p) setSuggestedQuestions([]); return !p; })}
          data-testid="button-suggestions-toggle"
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg transition-all duration-200 text-sm font-medium",
            suggestionsEnabled
              ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
              : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
          )}
        >
          <Sparkles className="w-5 h-5" />
          <span>{suggestionsEnabled ? "Suggestions On" : "Suggestions Off"}</span>
        </button>
      </div>

      {/* Activity Pulse */}
      <ActivityPulse />

      {/* Delegation Live Feed */}
      <DelegationLiveFeed
        conversationId={conversationId}
        enabled={true}
        position="bottom-right"
        maxVisible={4}
      />

      {/* Input */}
      <div className="px-4 py-3 border-t border-border bg-background/95 backdrop-blur-sm shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,.txt,.md,.csv,.json,.pdf,.doc,.docx,.gdoc,.xlsx,.xls,.yaml,.yml,.xml,.html"
          onChange={handleFileSelect}
          data-testid="input-file-upload"
        />
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2" data-testid="pending-attachments">
            {pendingAttachments.map((att, idx) => (
              <div key={idx} className="relative group/att" data-testid={`attachment-preview-${idx}`}>
                {att.type.startsWith("image/") && att.preview ? (
                  <img
                    src={att.preview}
                    alt={att.name}
                    className="w-16 h-16 object-cover rounded-lg border border-border"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg border border-border bg-muted flex flex-col items-center justify-center gap-1">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                    <span className="text-[9px] text-muted-foreground truncate max-w-[56px] px-1">{att.name}</span>
                  </div>
                )}
                <button
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                  onClick={() => removeAttachment(idx)}
                  data-testid={`button-remove-attachment-${idx}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button
            size="icon"
            variant="ghost"
            data-testid="button-attach-file"
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || uploading}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                data-testid="button-camera-capture"
                onClick={() => setCameraOpen(true)}
                disabled={streaming}
              >
                <Camera className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Take a photo</TooltipContent>
          </Tooltip>
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={`Message ${agentName}...`}
              className="resize-none min-h-[44px] max-h-[200px] pr-10 text-sm"
              rows={1}
              data-testid="input-message"
              disabled={streaming}
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={voiceRecording ? "destructive" : "ghost"}
                data-testid="button-voice-record"
                onClick={voiceRecording ? stopVoiceRecording : startVoiceRecording}
                disabled={streaming || voiceProcessing}
                className={cn(voiceRecording && "animate-pulse")}
              >
                {voiceProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : voiceRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{voiceRecording ? "Stop recording" : voiceProcessing ? "Processing..." : "Voice message"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                data-testid="button-talk-mode"
                onClick={() => setTalkModeActive(true)}
                disabled={streaming || voiceRecording || voiceProcessing}
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Talk Mode — continuous voice conversation</TooltipContent>
          </Tooltip>
          <Button
            size="icon"
            data-testid="button-send-message"
            onClick={() => sendMessage()}
            disabled={(!input.trim() && pendingAttachments.length === 0) || streaming || voiceProcessing}
          >
            {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        {(voiceRecording || voiceProcessing || voiceTranscript) && (
          <div className="flex items-center gap-2 mt-2 px-1" data-testid="voice-status">
            {voiceRecording && (
              <Badge variant="destructive" className="text-xs gap-1 py-0.5 animate-pulse">
                <Mic className="w-3 h-3" /> Recording...
              </Badge>
            )}
            {voiceProcessing && (
              <Badge variant="secondary" className="text-xs gap-1 py-0.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Processing voice...
              </Badge>
            )}
            {voiceTranscript && (
              <span className="text-xs text-muted-foreground italic truncate max-w-[300px]">"{voiceTranscript}"</span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground/60">
              {activePersona ? `${activePersona.name} • ` : ""}{conv?.thinkingLevel && conv.thinkingLevel !== "off" ? `Think:${conv.thinkingLevel === "auto" ? "auto" : conv.thinkingLevel} • ${conv?.model || "gpt-5.1"}` : `${conv?.model || "gpt-5.1"}`}
            </span>
            {streaming && (
              <Badge variant="secondary" className="text-xs gap-1 py-0 h-4">
                <Sparkles className="w-2.5 h-2.5 animate-pulse" /> Streaming
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/40">Shift+Enter newline</span>
            <span className="text-xs text-muted-foreground/30">|</span>
            <span className="text-xs text-muted-foreground/40">{navigator.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+N new chat</span>
            <span className="text-xs text-muted-foreground/30">|</span>
            <span className="text-xs text-muted-foreground/40">Esc {streaming ? "stop" : "clear"}</span>
          </div>
        </div>
      </div>

      {talkModeActive && conversationId && (
        <TalkMode
          conversationId={conversationId}
          agentName={agentName}
          onClose={() => {
            setTalkModeActive(false);
            queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
          }}
          wakeTriggers={voiceWakeData?.triggers}
        />
      )}

      {cameraOpen && (
        <CameraCapture
          onCapture={(attachment) => {
            setPendingAttachments((prev) => [...prev, attachment]);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      <ActionBalloons balloons={actionBalloons} />

      {browserLive.visible && (
        <div
          className={`fixed z-50 transition-all duration-300 ease-in-out ${
            browserLive.minimized
              ? "bottom-20 sm:bottom-4 right-2 sm:right-4 w-56 h-10"
              : "bottom-20 sm:bottom-4 right-2 sm:right-4 left-2 sm:left-auto w-auto sm:w-96"
          }`}
          data-testid="browser-live-preview"
        >
          <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-muted/80 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative flex items-center">
                  <Monitor className="w-3.5 h-3.5 text-primary" />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                </div>
                <span className="text-[11px] font-semibold text-foreground truncate">Agent Browser</span>
                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-mono">
                  Step {browserLive.stepCount}
                </Badge>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setBrowserLive((prev) => ({ ...prev, minimized: !prev.minimized }))}
                  className="p-1 hover:bg-muted rounded transition-colors"
                  data-testid="button-browser-minimize"
                >
                  {browserLive.minimized ? <Maximize2 className="w-3 h-3 text-muted-foreground" /> : <Minimize2 className="w-3 h-3 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => setBrowserLive({ visible: false, statusText: "", type: "", stepCount: 0, minimized: false, visionNarration: undefined })}
                  className="p-1 hover:bg-destructive/20 rounded transition-colors"
                  data-testid="button-browser-close"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            </div>

            {!browserLive.minimized && (
              <>
                <div className="relative bg-black/90 aspect-video flex items-center justify-center overflow-hidden">
                  {browserLive.screenshotUrl ? (
                    <img
                      src={browserLive.screenshotUrl}
                      alt="Live browser view"
                      className="w-full h-full object-contain transition-opacity duration-500"
                      data-testid="img-browser-screenshot"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Monitor className="w-8 h-8 animate-pulse" />
                      <span className="text-xs">Connecting to browser...</span>
                    </div>
                  )}
                  <div className="absolute top-2 left-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    <span className="text-[9px] text-white/70 font-medium uppercase tracking-wider">Live</span>
                  </div>
                </div>

                <div className="px-3 py-2 space-y-1">
                  <div className="flex items-center gap-2">
                    {browserLive.type === "navigating" && <Globe className="w-3 h-3 text-blue-500 shrink-0" />}
                    {browserLive.type === "clicking" && <MousePointer className="w-3 h-3 text-orange-500 shrink-0" />}
                    {browserLive.type === "typing" && <Type className="w-3 h-3 text-green-500 shrink-0" />}
                    {browserLive.type === "screenshot" && <Camera className="w-3 h-3 text-purple-500 shrink-0" />}
                    {browserLive.type === "browsing" && <Globe className="w-3 h-3 text-blue-500 shrink-0 animate-spin" />}
                    {browserLive.type === "analyzing" && <Eye className="w-3 h-3 text-amber-500 shrink-0" />}
                    {browserLive.type === "scrolling" && <ArrowDown className="w-3 h-3 text-cyan-500 shrink-0" />}
                    <p className="text-xs font-medium truncate" data-testid="text-browser-status">{browserLive.statusText}</p>
                  </div>
                  {browserLive.pageTitle && (
                    <p className="text-[10px] text-muted-foreground truncate" data-testid="text-browser-page-title">
                      {browserLive.pageTitle}
                    </p>
                  )}
                  {browserLive.pageUrl && (
                    <p className="text-[10px] text-muted-foreground/60 truncate font-mono" data-testid="text-browser-url">
                      {browserLive.pageUrl}
                    </p>
                  )}
                  {browserLive.visionNarration && (
                    <div className="flex items-start gap-1.5 mt-1 pt-1 border-t border-border/50" data-testid="text-browser-vision">
                      <Eye className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-500/90 leading-relaxed">
                        {browserLive.visionNarration}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            {browserLive.minimized && (
              <div className="px-3 py-0.5 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                <p className="text-[10px] truncate text-muted-foreground">{browserLive.statusText}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
