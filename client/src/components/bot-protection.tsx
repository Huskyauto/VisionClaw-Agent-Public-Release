import { useEffect, useRef } from "react";

// Client half of the bot-protection layer (see server/lib/bot-protection.ts).
//
// <Honeypot> renders a visually-hidden decoy field. Include its value in the
// request payload as `company_website`; the server silently drops any submit
// where it's non-empty.
//
// <TurnstileWidget> renders the Cloudflare Turnstile challenge ONLY when
// VITE_TURNSTILE_SITE_KEY is configured. When the key is absent it renders
// nothing and reports no token — the server fails open to match, so forms keep
// working until the keys are added. Pass the resulting token to the request as
// `turnstileToken`.

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
      reset: (id?: string) => void;
    };
  }
}

export function turnstileConfigured(): boolean {
  return !!SITE_KEY;
}

let scriptPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile script failed to load"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function Honeypot({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="text"
      name="company_website"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        position: "absolute",
        left: "-9999px",
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
      }}
      data-testid="input-honeypot"
    />
  );
}

export function TurnstileWidget({
  onToken,
}: {
  onToken: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile || !ref.current) return;
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: SITE_KEY,
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => {
        // Fail-open: server also fails open when it can't verify.
        onToken(null);
      });
    return () => {
      cancelled = true;
      try {
        if (widgetId.current && window.turnstile) {
          window.turnstile.remove(widgetId.current);
        }
      } catch {
        /* widget already gone */
      }
      widgetId.current = null;
    };
  }, [onToken]);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="my-2" data-testid="turnstile-widget" />;
}
