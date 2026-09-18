import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute } from "wouter";
import { Play, Pause, Square, SkipForward, SkipBack, Volume2, VolumeX, Maximize, Minimize, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SlideData {
  index: number;
  title: string;
  speakerNotes: string;
  thumbnailUrl?: string;
}

interface PresenterSession {
  id: number;
  token: string;
  title: string;
  presentationId: string;
  slides: SlideData[];
  embedUrl: string;
  presentUrl: string;
}

type PlaybackState = "idle" | "playing" | "paused" | "finished";

export default function PresenterPage() {
  const [, params] = useRoute("/present/:id");
  const sessionId = params?.id;

  const [session, setSession] = useState<PresenterSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ttsProgress, setTtsProgress] = useState("");
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [slideImageLoading, setSlideImageLoading] = useState(true);
  const [slideImageError, setSlideImageError] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [allSlidesReady, setAllSlidesReady] = useState(false);
  const preloadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const audioCtxRef = useRef<AudioContext | null>(null);
  const playingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentSlideRef = useRef(0);
  const mutedRef = useRef(false);
  const autoAdvanceRef = useRef(true);
  const audioCacheRef = useRef<Map<number, Promise<AudioBuffer | null>>>(new Map());

  useEffect(() => { currentSlideRef.current = currentSlide; }, [currentSlide]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { autoAdvanceRef.current = autoAdvance; }, [autoAdvance]);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/presenter/${sessionId}`)
      .then(r => { if (!r.ok) throw new Error("Session not found"); return r.json(); })
      .then(data => {
        if (data.slides) {
          data.slides = data.slides.map((s: SlideData, i: number) => ({
            ...s,
            thumbnailUrl: s.thumbnailUrl?.startsWith("/uploads/")
              ? `/api/presenter/${sessionId}/slide/${i}`
              : s.thumbnailUrl || `/api/presenter/${sessionId}/slide/${i}`,
          }));
        }
        setSession(data);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!session || session.slides.length === 0) return;
    let cancelled = false;
    setAllSlidesReady(false);
    setSlideImageLoading(true);
    preloadedImagesRef.current.clear();
    const slides = session.slides;
    const urls = slides.map(s => s.thumbnailUrl).filter(Boolean) as string[];
    if (urls.length === 0) { setAllSlidesReady(true); setSlideImageLoading(false); return; }
    setPreloadProgress({ loaded: 0, total: urls.length });
    let loaded = 0;
    const MIN_READY = Math.min(3, urls.length);
    const checkDone = () => {
      loaded++;
      if (cancelled) return;
      setPreloadProgress({ loaded, total: urls.length });
      if (loaded >= MIN_READY && !allSlidesReady) {
        setAllSlidesReady(true);
        setSlideImageLoading(false);
      }
      if (loaded >= urls.length) {
        setPreloadProgress(null);
      }
    };
    for (const url of urls) {
      const img = new Image();
      img.onload = () => { if (!cancelled) preloadedImagesRef.current.set(url, img); checkDone(); };
      img.onerror = () => { checkDone(); };
      img.src = url;
    }
    const safetyTimer = setTimeout(() => {
      if (!cancelled && !allSlidesReady) {
        setAllSlidesReady(true);
        setSlideImageLoading(false);
        setPreloadProgress(null);
      }
    }, 5000);
    return () => { cancelled = true; clearTimeout(safetyTimer); };
  }, [session]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        if (session && currentSlideRef.current < session.slides.length - 1) {
          goToSlide(currentSlideRef.current + 1);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentSlideRef.current > 0) {
          goToSlide(currentSlideRef.current - 1);
        }
      } else if (e.key === "Escape" && playingRef.current) {
        stopPlayback();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const goToSlide = useCallback((index: number) => {
    setCurrentSlide(index);
    setSlideImageError(false);
    setSlideImageLoading(!allSlidesReady);
  }, [allSlidesReady]);

  const fetchSlideAudio = useCallback(async (slideIndex: number, notes: string, signal: AbortSignal): Promise<AudioBuffer | null> => {
    if (!notes.trim() || !session) return null;

    try {
      const resp = await fetch(`/api/presenter/${session.token}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: notes, voice: "alloy" }),
        signal,
      });

      if (!resp.ok || !resp.body) return null;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      const audioChunks: Uint8Array[] = [];

      while (true) {
        if (signal.aborted) return null;
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          if (signal.aborted) return null;
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:") && !trimmed.startsWith("data: ")) continue;
          const payload = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
          if (!payload || payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === "audio_mp3" && parsed.data) {
              const raw = atob(parsed.data);
              const arr = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
              audioChunks.push(arr);
            } else if (parsed.type === "audio_complete" && parsed.audio) {
              const raw = atob(parsed.audio);
              const arr = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
              audioChunks.length = 0;
              audioChunks.push(arr);
            }
          } catch {}
        }
      }

      if (audioChunks.length === 0 || signal.aborted) return null;

      const totalLen = audioChunks.reduce((s, c) => s + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of audioChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const ctx = getAudioCtx();
      return await ctx.decodeAudioData(combined.buffer.slice(0));
    } catch (e: any) {
      if (e.name === "AbortError") return null;
      console.warn(`[presenter] TTS fetch error slide ${slideIndex + 1}:`, e.message);
      return null;
    }
  }, [getAudioCtx, session]);

  const fetchSlideAudioWithRetry = useCallback(async (slideIndex: number, notes: string, signal: AbortSignal): Promise<AudioBuffer | null> => {
    const result = await fetchSlideAudio(slideIndex, notes, signal);
    if (result || signal.aborted) return result;
    await new Promise(r => setTimeout(r, 1000));
    if (signal.aborted) return null;
    console.log(`[presenter] Retrying TTS for slide ${slideIndex + 1}`);
    return fetchSlideAudio(slideIndex, notes, signal);
  }, [fetchSlideAudio]);

  const prefetchAudio = useCallback((slideIndex: number, notes: string, signal: AbortSignal) => {
    const cache = audioCacheRef.current;
    if (cache.has(slideIndex)) return cache.get(slideIndex)!;
    const promise = fetchSlideAudioWithRetry(slideIndex, notes, signal);
    cache.set(slideIndex, promise);
    return promise;
  }, [fetchSlideAudioWithRetry]);

  const playSlideAudio = useCallback(async (slideIndex: number, notes: string, signal: AbortSignal): Promise<boolean> => {
    if (!notes.trim() || signal.aborted) return true;
    if (mutedRef.current) return true;
    if (!session) return true;

    setTtsProgress(`Loading audio for slide ${slideIndex + 1}...`);

    try {
      const audioBuf = await prefetchAudio(slideIndex, notes, signal);
      if (signal.aborted) return false;

      if (!audioBuf || mutedRef.current) {
        setTtsProgress("");
        return true;
      }

      setTtsProgress(`Speaking slide ${slideIndex + 1}...`);

      const ctx = getAudioCtx();
      await ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(ctx.destination);
      await new Promise<void>((resolve, reject) => {
        const maxDuration = (audioBuf.duration + 5) * 1000;
        const deadman = setTimeout(() => { try { source.stop(); } catch {} resolve(); }, maxDuration);
        source.onended = () => { clearTimeout(deadman); resolve(); };
        const onAbort = () => { clearTimeout(deadman); try { source.stop(); } catch {} reject(new Error("aborted")); };
        signal.addEventListener("abort", onAbort, { once: true });
        source.start();
      });
    } catch (e: any) {
      if (e.name === "AbortError" || e.message === "aborted") return false;
      console.warn(`[presenter] Audio error slide ${slideIndex + 1}:`, e.message);
      setTtsProgress(`Audio skipped for slide ${slideIndex + 1}`);
      await new Promise(r => setTimeout(r, 1500));
    }

    setTtsProgress("");
    return !signal.aborted;
  }, [getAudioCtx, session, prefetchAudio]);

  const startPlayback = useCallback(async (fromSlide?: number) => {
    if (!session) return;
    const startIdx = fromSlide ?? currentSlide;

    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    audioCacheRef.current.clear();

    playingRef.current = true;
    setPlaybackState("playing");

    for (let i = startIdx; i < session.slides.length; i++) {
      if (ac.signal.aborted) break;

      goToSlide(i);
      const slide = session.slides[i];
      const notes = slide.speakerNotes || "";

      if (i + 1 < session.slides.length) {
        const nextSlide = session.slides[i + 1];
        const nextNotes = nextSlide?.speakerNotes || "";
        if (nextNotes.trim() && !mutedRef.current) {
          prefetchAudio(i + 1, nextNotes, ac.signal);
        }
        const nextThumb = nextSlide?.thumbnailUrl;
        if (nextThumb) {
          const preload = new Image();
          preload.src = nextThumb;
        }
      }

      if (notes.trim()) {
        const completed = await playSlideAudio(i, notes, ac.signal);
        if (!completed) break;
      } else {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          ac.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); });
        });
        if (ac.signal.aborted) break;
      }

      if (i < session.slides.length - 1 && autoAdvanceRef.current && !ac.signal.aborted) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    audioCacheRef.current.clear();
    if (!ac.signal.aborted) {
      setPlaybackState("finished");
      setTtsProgress("");
    }
    playingRef.current = false;
  }, [session, currentSlide, goToSlide, playSlideAudio, prefetchAudio]);

  const pausePlayback = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    playingRef.current = false;
    setPlaybackState("paused");
    setTtsProgress("");
  }, []);

  const resumePlayback = useCallback(() => {
    startPlayback(currentSlide);
  }, [startPlayback, currentSlide]);

  const stopPlayback = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    audioCacheRef.current.clear();
    playingRef.current = false;
    setPlaybackState("idle");
    setTtsProgress("");
    setCurrentSlide(0);
    setSlideImageLoading(true);
    setSlideImageError(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-lg animate-pulse">Loading presentation...</div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-red-400 text-lg">{error || "Session not found"}</div>
          <Button variant="outline" onClick={() => window.history.back()} className="text-white border-white/20">
            <ChevronLeft className="w-4 h-4 mr-1" /> Go Back
          </Button>
        </div>
      </div>
    );
  }

  const totalSlides = session.slides.length;
  const slide = session.slides[currentSlide];
  const slideObjectId = `vc_slide_${currentSlide}`;
  const embedSrc = `https://docs.google.com/presentation/d/${session.presentationId}/embed?start=false&loop=false&delayms=0&rm=minimal&slide=id.${slideObjectId}`;
  const hasThumbnail = !!slide?.thumbnailUrl;

  return (
    <div ref={containerRef} className="min-h-screen bg-black flex flex-col" data-testid="presenter-page">
      <div className="flex-1 relative" data-testid="slide-viewport">
        {hasThumbnail && !slideImageError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            {slideImageLoading && !allSlidesReady && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-white/50 text-sm animate-pulse" data-testid="slide-loading">Loading slide {currentSlide + 1}...</div>
              </div>
            )}
            <img
              src={slide.thumbnailUrl}
              alt={`Slide ${currentSlide + 1}: ${slide?.title || ""}`}
              className={`max-w-full max-h-full object-contain transition-opacity duration-200 ${slideImageLoading && !allSlidesReady ? "opacity-0" : "opacity-100"}`}
              style={{ imageRendering: "auto", WebkitBackfaceVisibility: "hidden" }}
              data-testid="slide-thumbnail"
              loading="eager"
              decoding="sync"
              onLoad={() => setSlideImageLoading(false)}
              onError={() => { setSlideImageError(true); setSlideImageLoading(false); }}
            />
          </div>
        ) : (
          <iframe
            src={embedSrc}
            className="absolute inset-0 w-full h-full"
            style={{ border: "none" }}
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            allow="autoplay; fullscreen"
            data-testid="slide-iframe"
            title={`Slide ${currentSlide + 1}: ${slide?.title || ""}`}
          />
        )}

        {preloadProgress && !allSlidesReady && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-sm text-white/90 text-sm px-4 py-2 rounded-full" data-testid="preload-progress">
            <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse mr-2" />
            Loading slides... {preloadProgress.loaded}/{preloadProgress.total}
          </div>
        )}

        {ttsProgress && (
          <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-sm text-white/80 text-xs px-3 py-1.5 rounded-full" data-testid="tts-status">
            <span className="inline-block w-2 h-2 bg-emerald-400 rounded-full animate-pulse mr-2" />
            {ttsProgress}
          </div>
        )}
      </div>

      <div className="bg-zinc-900 border-t border-white/10 px-4 py-3" data-testid="presenter-controls">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {playbackState === "idle" || playbackState === "finished" ? (
              <Button size="sm" onClick={() => startPlayback(playbackState === "finished" ? 0 : currentSlide)} disabled={!allSlidesReady} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50" data-testid="button-play">
                <Play className="w-4 h-4" />
                {!allSlidesReady ? "Loading..." : playbackState === "finished" ? "Restart" : "Present"}
              </Button>
            ) : playbackState === "playing" ? (
              <Button size="sm" onClick={pausePlayback} variant="secondary" className="gap-1.5" data-testid="button-pause">
                <Pause className="w-4 h-4" /> Pause
              </Button>
            ) : (
              <Button size="sm" onClick={resumePlayback} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="button-resume">
                <Play className="w-4 h-4" /> Resume
              </Button>
            )}

            {playbackState !== "idle" && (
              <Button size="sm" variant="ghost" onClick={stopPlayback} className="text-white/60 hover:text-white" data-testid="button-stop">
                <Square className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={() => currentSlide > 0 && goToSlide(currentSlide - 1)} disabled={currentSlide === 0} className="text-white/60 hover:text-white disabled:opacity-30" data-testid="button-prev-slide">
              <SkipBack className="w-4 h-4" />
            </Button>

            <span className="text-white/80 text-sm font-mono min-w-[60px] text-center" data-testid="slide-counter">
              {currentSlide + 1} / {totalSlides}
            </span>

            <Button size="sm" variant="ghost" onClick={() => currentSlide < totalSlides - 1 && goToSlide(currentSlide + 1)} disabled={currentSlide >= totalSlides - 1} className="text-white/60 hover:text-white disabled:opacity-30" data-testid="button-next-slide">
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setIsMuted(!isMuted)} className="text-white/60 hover:text-white" data-testid="button-mute-toggle">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </Button>

            <Button size="sm" variant="ghost" onClick={toggleFullscreen} className="text-white/60 hover:text-white" data-testid="button-fullscreen">
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {slide?.title && (
          <div className="max-w-6xl mx-auto mt-2">
            <div className="text-white/50 text-xs truncate" data-testid="current-slide-title">
              {slide.title}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
