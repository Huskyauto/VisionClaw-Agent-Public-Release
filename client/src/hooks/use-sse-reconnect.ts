// ─────────────────────────────────────────────────────────────────────────────
// R87 — SSE auto-reconnect hook (browser side)
// ─────────────────────────────────────────────────────────────────────────────
// Pairs with the server-side FIRST_COMPLETED teardown. Detects three failure
// modes that EventSource alone does not cover:
//   1. Network drop / proxy timeout — exponential backoff reconnect
//   2. Tab backgrounded then refocused — visibilitychange listener forces
//      a re-check rather than waiting for a TCP keepalive failure
//   3. Laptop sleep/wake — a periodic timer that detects clock-drift > 15s
//      (sleeping pauses setTimeout); on drift detected, reconnect immediately
// Built on EventSource so it stays passive when the connection is healthy.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";

export type SseStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface UseSseReconnectOpts {
  url: string | null;                  // null disables the hook (for unauthed pages)
  onMessage?: (data: any, ev: MessageEvent) => void;
  onError?: (err: any) => void;
  onOpen?: () => void;
  withCredentials?: boolean;
  maxAttempts?: number;                // 0 = unlimited
  baseDelayMs?: number;                // 1000 default
  maxDelayMs?: number;                 // 30000 default
  driftCheckMs?: number;               // 5000 default
  driftThresholdMs?: number;           // 15000 default
  enabled?: boolean;
}

export function useSseReconnect(opts: UseSseReconnectOpts) {
  const {
    url,
    onMessage,
    onError,
    onOpen,
    withCredentials = true,
    maxAttempts = 0,
    baseDelayMs = 1_000,
    maxDelayMs = 30_000,
    driftCheckMs = 5_000,
    driftThresholdMs = 15_000,
    enabled = true,
  } = opts;

  const [status, setStatus] = useState<SseStatus>("idle");
  const esRef = useRef<EventSource | null>(null);
  const attemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const driftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled || !url) {
      setStatus("idle");
      return;
    }

    let mounted = true;

    const teardown = () => {
      if (esRef.current) {
        try { esRef.current.close(); } catch { /* ignore */ }
        esRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (!mounted) return;
      attemptsRef.current += 1;
      if (maxAttempts > 0 && attemptsRef.current > maxAttempts) {
        setStatus("closed");
        return;
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attemptsRef.current - 1));
      const jitter = Math.random() * 250;
      setStatus("reconnecting");
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, delay + jitter);
    };

    const connect = () => {
      teardown();
      if (!mounted) return;
      setStatus("connecting");
      try {
        const es = new EventSource(url, { withCredentials } as any);
        esRef.current = es;

        es.onopen = () => {
          if (!mounted) return;
          attemptsRef.current = 0;
          setStatus("open");
          onOpen?.();
        };

        es.onmessage = (ev) => {
          if (!mounted) return;
          let parsed: any = ev.data;
          try { parsed = JSON.parse(ev.data); } catch { /* leave as string */ }
          onMessage?.(parsed, ev);
        };

        es.onerror = (err) => {
          if (!mounted) return;
          onError?.(err);
          // Most browsers auto-retry, but for our SSE-with-POST patterns we
          // own the lifecycle: tear down and back off ourselves.
          teardown();
          scheduleReconnect();
        };
      } catch (e) {
        onError?.(e);
        scheduleReconnect();
      }
    };

    // visibility change → if hidden then visible, re-verify connection
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!esRef.current || esRef.current.readyState === EventSource.CLOSED) {
        attemptsRef.current = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // sleep/wake detection via clock drift
    lastTickRef.current = Date.now();
    driftTimerRef.current = setInterval(() => {
      const now = Date.now();
      const drift = now - lastTickRef.current - driftCheckMs;
      lastTickRef.current = now;
      if (drift > driftThresholdMs) {
        attemptsRef.current = 0;
        connect();
      }
    }, driftCheckMs);

    connect();

    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (driftTimerRef.current) clearInterval(driftTimerRef.current);
      teardown();
      setStatus("closed");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled]);

  return {
    status,
    close: () => {
      if (esRef.current) { try { esRef.current.close(); } catch { /* ignore */ } }
      setStatus("closed");
    },
  };
}
