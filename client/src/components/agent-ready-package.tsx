import { useEffect, useRef, useState, type ReactNode } from "react";
import { authFetch } from "@/lib/queryClient";
import type { AgentReadyInput, AgentReadyObservation, AgentReadyPackage } from "../../../shared/agent-ready-package";
import { AlertTriangle, CheckCircle2, Download, Loader2, PackageCheck, ScanSearch, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Form = Omit<AgentReadyInput, "confirmed"> & { confirmed: boolean };
const initial: Form = { company: "", website: "", description: "", businessType: "Organization", services: [], serviceArea: "", phone: "", email: "", pageUrls: [], confirmed: false };

function parseLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function validate(form: Form): string | null {
  if (!form.company.trim()) return "Add the public business name.";
  try {
    const url = new URL(form.website.trim());
    if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash) return "Use an HTTPS website origin only, such as https://example.com.";
  } catch { return "Enter a valid HTTPS website origin, such as https://example.com."; }
  if (!form.description.trim()) return "Add a short, factual business description.";
  if (!form.services.length || form.services.length > 12) return "Enter 1–12 services, one per line.";
  if (form.pageUrls.length > 15) return "Enter no more than 15 page URLs.";
  try {
    const origin = new URL(form.website).origin;
    if (form.pageUrls.some((item) => new URL(item, origin).origin !== origin || !/^https:\/\//i.test(item))) return "Page URLs must be HTTPS links on the same website origin.";
  } catch { return "Check the page URLs; each must be an HTTPS link on the same website."; }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Enter a valid public business email or leave it blank.";
  if (!form.confirmed) return "Confirm these are approved public business facts before continuing.";
  return null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}<span className="block text-xs text-muted-foreground">{help}</span></label>;
}

export default function AgentReadyPackage() {
  const [form, setForm] = useState<Form>(initial);
  const [servicesText, setServicesText] = useState("");
  const [pageUrlsText, setPageUrlsText] = useState("");
  const [preview, setPreview] = useState<AgentReadyPackage | null>(null);
  const [previewInput, setPreviewInput] = useState<AgentReadyInput | null>(null);
  const [before, setBefore] = useState<AgentReadyObservation | null>(null);
  const [after, setAfter] = useState<AgentReadyObservation | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "download" | "before" | "after">("");
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function edit<K extends keyof Form>(key: K, value: Form[K]) {
    requestId.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy("");
    setError("");
    setPreview(null);
    setPreviewInput(null);
    setBefore(null);
    setAfter(null);
    setForm((old) => ({ ...old, [key]: value, confirmed: key === "confirmed" ? Boolean(value) : false }));
  }
  function input(): AgentReadyInput {
    return { ...form, company: form.company.trim(), website: form.website.trim().replace(/\/$/, ""), description: form.description.trim(), services: form.services, serviceArea: form.serviceArea?.trim() || undefined, phone: form.phone?.trim() || undefined, email: form.email?.trim() || undefined, pageUrls: form.pageUrls, confirmed: true };
  }
  async function request(kind: "preview" | "before" | "after") {
    if (controller.current) return;
    const problem = validate(form);
    if (problem) { setError(problem); return; }
    const payload = input();
    const id = ++requestId.current;
    const aborter = new AbortController();
    controller.current = aborter;
    setBusy(kind); setError("");
    try {
      const res = await authFetch(kind === "preview" ? "/api/admin/audit/agent-ready/preview" : "/api/admin/audit/agent-ready/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: aborter.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}).`);
      if (id !== requestId.current) return;
      if (kind === "preview") { setPreview(data as AgentReadyPackage); setPreviewInput(payload); }
      else if (kind === "before") setBefore(data as AgentReadyObservation);
      else setAfter(data as AgentReadyObservation);
    } catch (e) {
      if (id === requestId.current && (e as Error).name !== "AbortError") setError((e as Error).message || "Request failed.");
    } finally {
      if (id === requestId.current) { setBusy(""); controller.current = null; }
    }
  }
  async function download() {
    if (!previewInput || !preview || busy) return;
    const id = ++requestId.current;
    const aborter = new AbortController(); controller.current = aborter;
    setBusy("download"); setError("");
    try {
      const res = await authFetch("/api/admin/audit/agent-ready/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(previewInput), signal: aborter.signal });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `ZIP download failed (${res.status}).`);
      }
      if (res.headers.get("X-Agent-Ready-Package") !== preview.packageId ||
        !res.headers.get("content-type")?.startsWith("application/zip"))
        throw new Error("The download did not match the preview. Preview the package again.");
      const blob = await res.blob();
      if (!blob.size) throw new Error("The ZIP was empty. No download was saved.");
      if (id !== requestId.current) return;
      const filename = res.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)?.[1] || "visionclaw-agent-ready.zip";
      downloadBlob(blob, filename);
    } catch (e) {
      if (id === requestId.current && (e as Error).name !== "AbortError") setError((e as Error).message || "ZIP download failed.");
    } finally { if (id === requestId.current) { setBusy(""); controller.current = null; } }
  }
  function evidence(observation: AgentReadyObservation | null) {
    if (!observation) return;
    downloadBlob(new Blob([JSON.stringify(observation, null, 2)], { type: "application/json" }), `visionclaw-live-evidence-${observation.checkedAt.slice(0, 10)}.json`);
  }
  const problem = validate(form);
  return <Card className="border-primary/30" data-testid="card-agent-ready">
    <CardHeader><CardTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5" /> VisionClaw · Agent-ready website package</CardTitle>
      <CardDescription>A private owner-operated export for practical website improvements. Confirm facts, inspect generated files, then keep the ZIP locally.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Public business name" help="Use the name shown to customers. Example: Northstar Heating"><Input maxLength={120} value={form.company} onChange={(e) => edit("company", e.target.value)} /></Field>
        <Field label="Website origin" help="HTTPS origin only; no page path. Example: https://example.com"><Input maxLength={1500} type="url" placeholder="https://example.com" value={form.website} onChange={(e) => edit("website", e.target.value)} /></Field>
        <Field label="Business description" help="A plain factual sentence. Example: Residential heating and cooling service in Madison."><Textarea maxLength={1200} rows={2} value={form.description} onChange={(e) => edit("description", e.target.value)} /></Field>
        <Field label="Business type" help="Choose the closest accurate schema category. Example: Organization for a general company."><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.businessType} onChange={(e) => edit("businessType", e.target.value as Form["businessType"])}><option>Organization</option><option>LocalBusiness</option><option>HVACBusiness</option></select></Field>
        <Field label="Services" help="1–12 factual services, one per line. Example: Furnace repair"><Textarea maxLength={2000} rows={3} value={servicesText} onChange={(e) => { setServicesText(e.target.value); edit("services", parseLines(e.target.value)); }} /></Field>
        <Field label="Page URLs (optional)" help="Up to 15 existing same-site HTTPS pages, one per line. Example: https://example.com/services"><Textarea maxLength={22500} rows={3} value={pageUrlsText} onChange={(e) => { setPageUrlsText(e.target.value); edit("pageUrls", parseLines(e.target.value)); }} /></Field>
        <Field label="Service area (optional)" help="Only name a confirmed area. Example: Madison and nearby communities"><Input value={form.serviceArea} onChange={(e) => edit("serviceArea", e.target.value)} /></Field>
        <Field label="Public phone (optional)" help="Example: +1 608 555 0142"><Input type="tel" value={form.phone} onChange={(e) => edit("phone", e.target.value)} /></Field>
        <Field label="Public email (optional)" help="Example: hello@example.com"><Input type="email" value={form.email} onChange={(e) => edit("email", e.target.value)} /></Field>
      </div>
      <label className="flex items-start gap-3 rounded-md border p-3 text-sm"><input type="checkbox" className="mt-1" checked={form.confirmed} onChange={(e) => edit("confirmed", e.target.checked)} /><span>I confirm these are approved public business facts and authorize their use in this export. I have not included credentials or private information.</span></label>
      <div className="rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">Website-only Poppy discovery; no booking, purchasing, or authentication implementation. No ranking guarantees. File generation is free and makes no AI/API calls. Nothing is saved on the server: download before leaving. No automatic installation or customer delivery; installation requires separate authorization.</div>
      {problem && <p className="text-xs text-muted-foreground">Before continuing: {problem}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!preview && <p className="text-sm text-muted-foreground">No package preview yet. Your facts stay in this page until you leave.</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => request("preview")} disabled={!!busy || !!problem}>{busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}Preview files</Button>
        <Button variant="outline" onClick={() => request("before")} disabled={!!busy || !!problem}>{busy === "before" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}Check live before</Button>
        {preview && <Button variant="outline" onClick={download} disabled={!!busy || !previewInput}>{busy === "download" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download ZIP</Button>}
        {preview && <Button variant="outline" onClick={() => request("after")} disabled={!!busy || !!problem}>{busy === "after" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}Check live after installation</Button>}
      </div>
      {preview && <section className="min-w-0 space-y-3 rounded-md border p-4"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Generated files</h3><Badge variant="secondary" className="max-w-full break-all">Package {preview.packageId}</Badge></div>
        <p className="text-xs text-muted-foreground">Preview is local to this session. Download the ZIP to keep it; no installation is attempted.</p>
        {preview.files.map((file) => <details key={file.path} className="rounded border"><summary className="cursor-pointer px-3 py-2 font-mono text-sm">{file.path}</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t bg-muted/40 p-3 text-xs">{file.content}</pre></details>)}
        {preview.checks.map((check) => <p key={check.label} className="flex gap-2 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /><span><b>{check.label}</b> — {check.detail}</span></p>)}
        {preview.limitations.map((item, i) => <p key={i} className="flex gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4 shrink-0" />{item}</p>)}
      </section>}
      {[["Before check", before], ["After check", after]].map(([title, item]) => item && <section key={title as string} className="space-y-2 rounded-md border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{title as string} · {new Date((item as AgentReadyObservation).checkedAt).toLocaleString()}</h3><Button variant="outline" size="sm" onClick={() => evidence(item as AgentReadyObservation)}><Download className="mr-2 h-4 w-4" />Download evidence JSON</Button></div>
        <p className="break-words text-xs text-muted-foreground">Read-only public website observation; it does not install or certify anything. Package ID: <span className="break-all">{(item as AgentReadyObservation).packageId}</span></p>
        {(item as AgentReadyObservation).checks.map((check) => <p key={check.id} className="flex items-start gap-2 text-sm">{check.status === "pass" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : check.status === "fail" ? <XCircle className="h-4 w-4 shrink-0 text-destructive" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}<span><b>{check.label}</b> · {check.status} — {check.detail} <span className="block break-all text-xs text-muted-foreground">{check.url}</span></span></p>)}
        {(item as AgentReadyObservation).limitations.map((text, i) => <p key={i} className="text-xs text-muted-foreground">{text}</p>)}
      </section>)}
    </CardContent>
  </Card>;
}
