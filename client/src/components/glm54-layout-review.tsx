import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  GLM_LAYOUT_CONSENT, GLM_LAYOUT_CSS_CHARS, GLM_LAYOUT_IMAGE_BYTES, GLM_LAYOUT_REVIEW_PATH, type GlmLayoutReply,
} from "@shared/glm54-layout-contract";

const allowedImages = ["image/png", "image/jpeg", "image/webp"];

export default function Glm54LayoutReview() {
  const [available, setAvailable] = useState(false);
  const [css, setCss] = useState("");
  const [image, setImage] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GlmLayoutReply | null>(null);
  const selection = useRef(0);
  const running = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    authFetch(GLM_LAYOUT_REVIEW_PATH, { signal: controller.signal })
      .then(async response => { if (response.ok) setAvailable((await response.json()).available === true); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  function resetReview() { setConsent(false); setResult(null); setError(""); }

  async function choose(file?: File) {
    const current = ++selection.current;
    setImage(""); setReading(false); resetReview();
    if (!file) return;
    if (!allowedImages.includes(file.type) || file.size > GLM_LAYOUT_IMAGE_BYTES) {
      setError("Choose a PNG, JPEG or WebP screenshot up to 360 KB. Crop to the broken area if needed.");
      return;
    }
    setReading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read failed"));
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      if (current === selection.current) setImage(dataUrl);
    } catch {
      if (current === selection.current) setError("The file could not be read. Choose another screenshot.");
    } finally {
      if (current === selection.current) setReading(false);
    }
  }

  async function run() {
    if (!image || !css.trim() || !consent || reading || running.current) return;
    running.current = true;
    setBusy(true); resetReview();
    try {
      const response = await authFetch(GLM_LAYOUT_REVIEW_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshot: image.split(",")[1], css, submissionId: crypto.randomUUID(), consent: GLM_LAYOUT_CONSENT,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "The review was unavailable.");
        return;
      }
      setResult(body);
    } catch {
      setError("The review could not be confirmed. It was not retried automatically.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  if (!available) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>GLM 5.4 layout second opinion</CardTitle>
        <CardDescription>
          For stubborn clipping, scrolling, or positioning bugs. Get a suggested CSS fix to verify in your browser.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <details>
          <summary className="cursor-pointer py-2 text-sm font-semibold">Open the layout check</summary>
          <form className="mt-3 space-y-4" onSubmit={event => { event.preventDefault(); void run(); }}>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="glm-layout-screenshot">Cropped screenshot</label>
              <p className="text-sm text-muted-foreground" id="glm-layout-image-hint">PNG, JPEG or WebP, up to 360 KB. Example: a public menu with a clipped button.</p>
              <input id="glm-layout-screenshot" type="file" accept={allowedImages.join(",")} disabled={busy} aria-describedby="glm-layout-image-hint"
                className="block w-full min-w-0 text-sm" onChange={event => { void choose(event.target.files?.[0]); }} />
              {image && <img src={image} alt="Screenshot you are about to submit" className="mt-2 max-h-72 max-w-full rounded border object-contain" />}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="glm-layout-css">Relevant CSS</label>
              <p className="text-sm text-muted-foreground" id="glm-layout-css-hint">Paste only the rules that reproduce the bug. No URLs or private code.</p>
              <Textarea id="glm-layout-css" aria-describedby="glm-layout-css-hint" disabled={busy} value={css}
                className="min-h-24 font-mono" maxLength={GLM_LAYOUT_CSS_CHARS}
                placeholder="Example: .row { display: flex; overflow: hidden; }"
                onChange={event => { setCss(event.target.value); resetReview(); }} />
            </div>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" className="mt-1 shrink-0" checked={consent} disabled={busy || reading || !image || !css.trim()}
                onChange={event => setConsent(event.target.checked)} />
              <span>I checked the screenshot and CSS. Both are public or synthetic, with no private information, and I approve sending them to AIHubMix.</span>
            </label>
            <Button type="submit" disabled={busy || reading || !image || !css.trim() || !consent}>
              {busy ? "Checking layout…" : "Send to GLM 5.4"}
            </Button>
            <p className="text-xs text-muted-foreground">One paid request. Nothing is changed or sent automatically.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {result && (
              <div aria-live="polite" className="space-y-2 rounded-md border p-3 text-sm">
                <p className="font-semibold">Advisory suggestion from {result.model}</p>
                <p className="break-words whitespace-pre-wrap"><strong>Likely cause: </strong>{result.advice.diagnosis}</p>
                <p className="break-words whitespace-pre-wrap"><strong>Suggested change: </strong>{result.advice.suggestion}</p>
                <p className="break-words whitespace-pre-wrap"><strong>Verify in the browser: </strong>{result.advice.verification}</p>
              </div>
            )}
          </form>
        </details>
      </CardContent>
    </Card>
  );
}
