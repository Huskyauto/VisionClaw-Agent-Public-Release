import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, CircleAlert,
  ExternalLink, Eye, Loader2, LockKeyhole, Monitor, MousePointer2, Plus,
  RefreshCw, RotateCcw, Send, ShieldCheck, Smartphone, Sparkles, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { authFetch, getAuthIdentityVersion } from "@/lib/queryClient";
import { WorkspaceRequestLane, workspaceReadFailureBlocksControls, readWorkspaceJson } from "@/lib/browser-workspace-requests";
import type { Persona } from "@shared/schema";

type WorkspaceState = {
  mode: "agent" | "human";
  revision: number;
  snapshotToken?: string | null;
  target?: { personaId: number; tabId: string; userIdSuffix?: string };
  lastOutcome?: string | null;
  lastOperationId?: string | null;
  activity?: { action: string; at: string }[];
};
type TabInfo = { tabId: string; title: string; url: string };
type WorkspacePayload = { configured: boolean; tabs: TabInfo[]; state: WorkspaceState; connectionError?: string; targetMissing?: boolean };
type PageElement = { ref: string; role: string; label: string };
type ViewPayload = {
  screenshotBase64: string;
  capturedAt: string;
  title?: string;
  url?: string;
  elements: PageElement[];
  state: WorkspaceState;
};
type ActionResponse = {
  state: WorkspaceState;
  ok?: boolean;
  tabId?: string;
  replayed?: boolean;
  error?: string;
};
type BoundElement = PageElement & { binding: string };
type DialogRequest = { kind: "click" | "close"; binding: string; element?: BoundElement } | null;
type MutationInput = { body: Record<string, unknown>; identity: number };
type ApiError = Error & { ambiguous?: boolean };

const preferenceKey = "visionclaw-browser-workspace";
function readPreferences(): { personaId?: number; userIdSuffix?: string; tabId?: string } {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
    return {
      personaId: Number.isInteger(value.personaId) ? value.personaId : undefined,
      userIdSuffix: typeof value.userIdSuffix === "string" ? value.userIdSuffix : "",
      tabId: typeof value.tabId === "string" ? value.tabId : undefined,
    };
  } catch {
    return {};
  }
}
function queryString(personaId: number, suffix: string, tabId?: string) {
  const params = new URLSearchParams({ personaId: String(personaId) });
  if (suffix.trim()) params.set("userIdSuffix", suffix.trim());
  if (tabId) params.set("tabId", tabId);
  return params.toString();
}
async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const identity = getAuthIdentityVersion();
  return readWorkspaceJson<T>(() => authFetch(url, { signal, cache: "no-store" }),
    () => getAuthIdentityVersion() === identity, signal);
}
async function sendJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await authFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const ambiguous = new Error("Connection interrupted. The action may have reached the browser. Check the page before doing anything again.") as ApiError;
    ambiguous.ambiguous = true;
    throw ambiguous;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`) as ApiError;
    error.ambiguous = response.status >= 500;
    throw error;
  }
  if (payload?.ok === false || payload?.error) {
    const error = new Error(payload.error || "The browser action was not confirmed.") as ApiError;
    error.ambiguous = payload.replayed === true;
    throw error;
  }
  return payload as T;
}
function safeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : "";
  } catch {
    return "";
  }
}
function formatTime(value?: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Not recorded" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function BrowserWorkspacePage() {
  const { token, isReplitAuth, isChecking, tenant } = useAuth();
  const signedInRoleReady = !isChecking && !!tenant && (!!token || isReplitAuth);
  const initialPrefs = useMemo(readPreferences, []);
  const [personaId, setPersonaId] = useState<number | undefined>(initialPrefs.personaId);
  const [suffix, setSuffix] = useState(initialPrefs.userIdSuffix || "");
  const [tabId, setTabId] = useState(initialPrefs.tabId || "");
  const [address, setAddress] = useState("");
  const [typeDraft, setTypeDraft] = useState("");
  const [selectedElement, setSelectedElement] = useState<BoundElement | null>(null);
  const [confirming, setConfirming] = useState<DialogRequest>(null);
  const [localError, setLocalError] = useState("");
  const operationInFlight = useRef(false);
  const requestLane = useRef<WorkspaceRequestLane>();
  if (!requestLane.current) requestLane.current = new WorkspaceRequestLane(getAuthIdentityVersion);
  const authGeneration = getAuthIdentityVersion();
  function serialRequest<T>(fn: () => Promise<T>, identity: number, signal?: AbortSignal): Promise<T> {
    return requestLane.current!.enqueue(fn, identity, signal);
  }
  useEffect(() => {
    requestLane.current!.activate();
    return () => requestLane.current!.dispose();
  }, []);
  useEffect(() => {
    setAddress(""); setTypeDraft(""); setSelectedElement(null); setConfirming(null);
    setLocalError(""); operationInFlight.current = false;
  }, [authGeneration]);
  const latestState = useRef<WorkspaceState | null>(null);
  const [knownState, setKnownState] = useState<WorkspaceState | null>(null);
  const [knownStateScope, setKnownStateScope] = useState("");
  const identityKey = `${tenant?.id ?? "none"}:${personaId ?? "none"}:${suffix.trim()}`;
  const lastIdentityKey = useRef(identityKey);
  const latestStateScope = useRef(identityKey);
  const suffixValue = suffix.trim();
  const personaQuery = useQuery<Persona[]>({
    queryKey: ["/api/personas", tenant?.id],
    queryFn: () => readJson<Persona[]>("/api/personas"),
    enabled: signedInRoleReady,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const personas = personaQuery.data || [];
  const effectivePersonaId = personaId && personas.some((item) => item.id === personaId)
    ? personaId
    : personas[0]?.id || personaId;

  useEffect(() => {
    if (effectivePersonaId && personaId !== effectivePersonaId) setPersonaId(effectivePersonaId);
  }, [effectivePersonaId, personaId]);
  useEffect(() => {
    if (lastIdentityKey.current !== identityKey) {
      latestState.current = null;
      latestStateScope.current = identityKey;
      setKnownState(null);
      setKnownStateScope("");
      lastIdentityKey.current = identityKey;
    }
  }, [identityKey]);
  const absorbState = (incoming?: WorkspaceState) => {
    if (!incoming) return;
    if (latestStateScope.current !== identityKey) {
      latestState.current = null;
      latestStateScope.current = identityKey;
    }
    if (!latestState.current || incoming.revision >= latestState.current.revision) {
      latestState.current = incoming;
      setKnownState(incoming);
      setKnownStateScope(identityKey);
    }
  };
  useEffect(() => {
    if (effectivePersonaId) {
      try {
        localStorage.setItem(preferenceKey, JSON.stringify({
          personaId: effectivePersonaId,
          userIdSuffix: suffixValue,
          ...(tabId ? { tabId } : {}),
        }));
      } catch { /* Storage is optional. */ }
    }
  }, [effectivePersonaId, suffixValue, tabId]);

  const workspaceQuery = useQuery<WorkspacePayload>({
    queryKey: ["/api/browser/workspace", tenant?.id, effectivePersonaId, suffixValue],
    queryFn: ({ signal }) => serialRequest(() => readJson<WorkspacePayload>(`/api/browser/workspace?${queryString(effectivePersonaId!, suffixValue)}`, signal), authGeneration, signal),
    enabled: signedInRoleReady && !!effectivePersonaId,
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (query) => document.visibilityState === "visible" && !operationInFlight.current
      ? (query.state.error || query.state.data?.connectionError ? 60000 : 8000) : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => absorbState(workspaceQuery.data?.state), [workspaceQuery.data?.state]);
  const tabs = workspaceQuery.data?.tabs || [];
  const currentTabId = tabs.some((tab) => tab.tabId === tabId) ? tabId : tabs[0]?.tabId || "";
  useEffect(() => {
    if (currentTabId && currentTabId !== tabId) setTabId(currentTabId);
  }, [currentTabId, tabId]);
  const viewQuery = useQuery<ViewPayload>({
    queryKey: ["/api/browser/workspace/view", tenant?.id, effectivePersonaId, suffixValue, currentTabId],
    queryFn: ({ signal }) => serialRequest(() => readJson<ViewPayload>(`/api/browser/workspace/view?${queryString(effectivePersonaId!, suffixValue, currentTabId)}`, signal), authGeneration, signal),
    enabled: signedInRoleReady && !!effectivePersonaId && !!currentTabId && workspaceQuery.data?.configured === true,
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (query) => document.visibilityState === "visible" && !operationInFlight.current
      ? (query.state.error ? 60000 : 8000) : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => absorbState(viewQuery.data?.state), [viewQuery.data?.state]);
  const serverState = (knownStateScope === identityKey ? knownState : null)
    || workspaceQuery.data?.state || viewQuery.data?.state;
  const newestRevision = Math.max(
    serverState?.revision ?? 0,
    latestStateScope.current === identityKey ? latestState.current?.revision ?? 0 : 0,
  );
  const isHuman = serverState?.mode === "human";
  const busy = workspaceQuery.isFetching || viewQuery.isFetching;
  const hasFreshView = !!viewQuery.data && !viewQuery.isError && !viewQuery.isFetching;
  const viewTargetMatches = serverState?.target?.personaId === effectivePersonaId
    && serverState?.target?.tabId === currentTabId
    && (serverState?.target?.userIdSuffix || "") === suffixValue;
  const snapshotToken = hasFreshView && isHuman && viewTargetMatches
    ? (viewQuery.data?.state.snapshotToken || serverState?.snapshotToken || undefined)
    : undefined;
  const mutation = useMutation<ActionResponse, Error, MutationInput>({
    mutationFn: (input) => serialRequest(() => sendJson<ActionResponse>("/api/browser/workspace/action", input.body), input.identity),
    retry: false,
    onMutate: (variables) => { if (requestLane.current!.isCurrent(variables.identity)) operationInFlight.current = true; },
    onSuccess: async (result, variables) => {
      if (!requestLane.current!.isCurrent(variables.identity)) return;
      absorbState(result.state);
      setLocalError(result.error || "");
      await Promise.all([workspaceQuery.refetch(),
        ...(variables.body.action !== "open" && currentTabId ? [viewQuery.refetch()] : [])]);
      // Wait for discovery before selecting, or the old cached list selects the old tab again.
      if (requestLane.current!.isCurrent(variables.identity) && variables.body.action === "open" && result.tabId)
        setTabId(result.tabId);
    },
    onError: async (error, variables) => {
      if (!requestLane.current!.isCurrent(variables.identity)) return;
      const apiError = error as ApiError;
      setLocalError(`${error.message}${apiError.ambiguous ? " Check the page before trying again; the action was not repeated." : ""}`);
      if (apiError.ambiguous) await Promise.all([workspaceQuery.refetch(), viewQuery.refetch()]);
    },
    onSettled: (_data, _error, variables) => { if (requestLane.current!.isCurrent(variables.identity)) operationInFlight.current = false; },
  });
  const controlMutation = useMutation<ActionResponse, Error, MutationInput>({
    mutationFn: (input) => serialRequest(() => sendJson<ActionResponse>("/api/browser/workspace/control", input.body), input.identity),
    retry: false,
    onMutate: (variables) => { if (requestLane.current!.isCurrent(variables.identity)) operationInFlight.current = true; },
    onSuccess: async (result, variables) => {
      if (!requestLane.current!.isCurrent(variables.identity)) return;
      absorbState(result.state);
      setLocalError("");
      await Promise.all([workspaceQuery.refetch(),
        ...(currentTabId && !(variables.body.action === "return" && !result.state.target) ? [viewQuery.refetch()] : [])]);
    },
    onError: async (error, variables) => {
      if (!requestLane.current!.isCurrent(variables.identity)) return;
      const ambiguous = (error as ApiError).ambiguous;
      setLocalError(`${error.message}${ambiguous ? " Check the page before trying again; the control request was not repeated." : ""}`);
      if (ambiguous) await Promise.all([workspaceQuery.refetch(), viewQuery.refetch()]);
    },
    onSettled: (_data, _error, variables) => { if (requestLane.current!.isCurrent(variables.identity)) operationInFlight.current = false; },
  });
  const actionDisabled = !signedInRoleReady || !effectivePersonaId || !serverState || !isHuman
    || !snapshotToken || busy || mutation.isPending || controlMutation.isPending || workspaceQuery.data?.configured !== true;
  const target = effectivePersonaId && currentTabId ? {
    personaId: effectivePersonaId,
    tabId: currentTabId,
    ...(suffixValue ? { userIdSuffix: suffixValue } : {}),
  } : undefined;
  const approvalBinding = JSON.stringify([authGeneration, identityKey, currentTabId, viewQuery.data?.state.snapshotToken || ""]);
  useEffect(() => { setSelectedElement(null); setConfirming(null); }, [approvalBinding]);
  const runAction = (action: string, fields: Record<string, unknown> = {}, approvedBinding?: string) => {
    if (!effectivePersonaId || !serverState) return;
    setLocalError("");
    const body: Record<string, unknown> = {
      action,
      personaId: effectivePersonaId,
      ...(suffixValue ? { userIdSuffix: suffixValue } : {}),
      revision: newestRevision,
      operationId: crypto.randomUUID(),
      ...fields,
    };
    if (action !== "open") {
      if (approvedBinding && approvedBinding !== approvalBinding) {
        setLocalError("The page controls changed. Select the field or action again before continuing.");
        return;
      }
      if (!target || !snapshotToken) {
        setLocalError("Refresh the selected tab before using its controls.");
        return;
      }
      body.target = target;
      body.snapshotToken = snapshotToken;
    }
    mutation.mutate({ body, identity: authGeneration });
  };
  const submitAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = safeUrl(address.trim().includes("://") ? address.trim() : `https://${address.trim()}`);
    if (!url) {
      setLocalError("Enter a valid public website address using HTTP or HTTPS.");
      return;
    }
    runAction(currentTabId ? "navigate" : "open", currentTabId ? { url } : { url });
  };
  const openNewTab = () => {
    const url = safeUrl(address.trim().includes("://") ? address.trim() : `https://${address.trim()}`);
    if (!url) {
      setLocalError("Enter a valid public website address using HTTP or HTTPS.");
      return;
    }
    runAction("open", { url });
  };
  const submitTyping = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedElement || !typeDraft.trim()) return;
    runAction("type", { ref: selectedElement.ref, text: typeDraft }, selectedElement.binding);
  };
  const confirmAction = () => {
    if (!confirming) return;
    if (confirming.kind === "click" && confirming.element) {
      runAction("click", { ref: confirming.element.ref }, confirming.binding);
    } else if (confirming.kind === "close") {
      runAction("close_tab", {}, confirming.binding);
    }
    setConfirming(null);
  };
  const doControl = (action: "take" | "return") => {
    setLocalError("");
    controlMutation.mutate({ body: { action, revision: newestRevision, operationId: crypto.randomUUID() }, identity: authGeneration });
  };
  const activePersona = personas.find((item) => item.id === effectivePersonaId);
  const activeTab = tabs.find((tab) => tab.tabId === currentTabId);
  const staleImage = !!viewQuery.data && (viewQuery.isError || viewQuery.isFetching);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#f2f1e9] text-[#23332e]">
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-5 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.19em] text-[#647c70]">
              <Smartphone className="h-4 w-4" aria-hidden="true" /> VisionClaw / Browser workspace
            </div>
            <h1 className="font-semibold leading-none tracking-[-0.05em] text-[2.15rem] sm:text-5xl">A browser you can steer.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#5b6e65]">
              A phone-friendly view of your agent’s browser. Screenshots refresh periodically; this is not live video.
            </p>
          </div>
          <Link href="/chat" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-[#cbd5ca] bg-[#faf9f4] px-4 text-sm font-semibold text-[#41584c] transition hover:bg-white">
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Open chat
          </Link>
        </header>
        <p role="status" className="mb-4 text-sm text-[#68786c]">
          {signedInRoleReady && serverState ? `Last verified control: ${serverState.mode === "human" ? "Human mode" : "Agent mode"} · Revision ${serverState.revision}`
            : "Browser control status has not been verified. No change of control is confirmed."}
        </p>

        {!signedInRoleReady ? (
          <section className="rounded-2xl border border-[#d7ded4] bg-[#faf9f4] p-5" aria-live="polite">
            <div className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin text-[#567664]" /><span className="font-medium">Verifying your signed-in workspace…</span></div>
          </section>
        ) : (
          <>
            <section className="mb-4 grid gap-3 rounded-2xl border border-[#d3dbd1] bg-[#faf9f4] p-4 shadow-[0_7px_25px_rgba(51,74,61,0.05)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:p-5">
              <div className="min-w-0">
                <Label htmlFor="workspace-persona" className="mb-2 block text-xs font-bold uppercase tracking-[0.13em] text-[#708276]">Agent browser</Label>
                {personaQuery.isLoading ? <Skeleton className="h-11 w-full rounded-xl" /> : personaQuery.isError ? (
                  <div className="flex min-h-11 items-center justify-between rounded-xl border border-[#e6c6bd] bg-[#fff5f0] px-3 text-sm text-[#9a4f3d]">
                    Could not load your agent roster
                    <button className="min-h-11 px-2 font-semibold underline" onClick={() => personaQuery.refetch()}>Retry</button>
                  </div>
                ) : personas.length === 0 ? (
                  <div className="rounded-xl border border-[#d9dfd4] bg-[#f4f4ec] p-3 text-sm text-[#69766c]">No agents are available for this account.</div>
                ) : (
                  <div className="relative">
                    <select id="workspace-persona" value={effectivePersonaId || ""} onChange={(event) => { setPersonaId(Number(event.target.value)); setTabId(""); }} className="h-12 w-full appearance-none rounded-xl border border-[#cbd6cb] bg-white px-3 pr-10 text-base font-semibold text-[#2d4137] outline-none focus:ring-2 focus:ring-[#70917d]" aria-label="Choose agent browser">
                      {personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#62766a]" />
                  </div>
                )}
                {activePersona && <p className="mt-2 text-xs text-[#718075]">{activePersona.role || "Agent browser"} · tenant-scoped session</p>}
              </div>
              <div className="min-w-0">
                <Label htmlFor="workspace-suffix" className="mb-2 block text-xs font-bold uppercase tracking-[0.13em] text-[#708276]">Optional browser session</Label>
                <Input id="workspace-suffix" value={suffix} onChange={(event) => { setSuffix(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32)); setTabId(""); }} placeholder="Leave blank for the default session" autoCapitalize="off" autoCorrect="off" className="h-12 rounded-xl border-[#cbd6cb] bg-white text-base" />
                <p className="mt-2 text-xs leading-5 text-[#718075]">Use this only if your agent gave you a session name, for example <span className="font-mono text-[#425b4d]">research_2</span>. This is not a selector or script field.</p>
              </div>
            </section>

            {workspaceQuery.isLoading ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.75fr)]">
                <Skeleton className="aspect-[4/3] w-full rounded-2xl" /><Skeleton className="h-64 rounded-2xl" />
              </div>
            ) : workspaceReadFailureBlocksControls(workspaceQuery.isError, !!serverState) ? (
              <section className="rounded-2xl border border-[#e4c7bf] bg-[#fff6f1] p-5">
                <div className="flex gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#a55240]" /><div className="min-w-0"><h2 className="font-semibold">Workspace connection unavailable</h2><p className="mt-1 text-sm text-[#79594f]">{(workspaceQuery.error as Error).message}</p><Button className="mt-4 min-h-11 rounded-xl" onClick={() => workspaceQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" /> Retry connection</Button></div></div>
              </section>
            ) : workspaceQuery.data?.configured === false ? (
              <section className="rounded-2xl border border-[#d5dbcf] bg-[#faf9f4] p-6 sm:p-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e9eee5] text-[#587362]"><Monitor className="h-6 w-6" /></div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight">Browser service is not configured</h2>
                <p className="mt-2 max-w-lg text-sm leading-6 text-[#68786c]">This workspace is connected to your signed-in account, but a remote browser service is not available yet. No controls are enabled until it is configured.</p>
              </section>
            ) : (
              <>
                {workspaceQuery.isError && (
                  <div role="alert" className="mb-4 rounded-2xl border border-[#eed7ca] bg-[#fff5ed] p-4 text-sm text-[#79594f]">
                    Connection refresh failed. Showing your last confirmed control state.
                    Browser actions are never automatically repeated.
                    <Button variant="outline" className="mt-3 min-h-11 w-full rounded-xl" disabled={busy}
                      onClick={() => workspaceQuery.refetch()}>Retry connection</Button>
                  </div>
                )}
                {workspaceQuery.data?.connectionError && (
                  <div role="alert" className="mb-4 rounded-2xl border border-[#eed7ca] bg-[#fff5ed] p-4 text-sm text-[#79594f]">
                    {workspaceQuery.data.connectionError} You can still take control to pause Camofox browser work.
                  </div>
                )}
                <section className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#cfd9ce] bg-[#e6ebe1] p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isHuman ? "bg-[#d9eadf] text-[#276247]" : "bg-[#f2e9d9] text-[#876b3a]"}`}>
                      {isHuman ? <ShieldCheck className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{workspaceQuery.isError ? "Last confirmed: " : ""}{!serverState ? "Control status unavailable" : isHuman ? "You have browser control" : "Agent is in control"}</h2>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${isHuman ? "bg-[#d6e9dc] text-[#376849]" : "bg-[#efe6d3] text-[#79643d]"}`}>{!serverState ? "Unknown mode" : isHuman ? "Human mode" : "Agent mode"}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-[#68766a]">Revision {serverState?.revision ?? "—"} · Last outcome: {serverState?.lastOutcome || "none recorded"}</p>
                    </div>
                  </div>
                  {isHuman ? (
                    <Button variant="outline" className="min-h-11 w-full shrink-0 rounded-xl border-[#aebdaf] bg-[#f8f8f0] sm:w-auto" disabled={controlMutation.isPending || busy} onClick={() => doControl("return")}>
                      {controlMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />} Return control to agent
                    </Button>
                  ) : (
                    <Button className="min-h-11 w-full shrink-0 rounded-xl bg-[#385c49] text-white hover:bg-[#2c4e3b] sm:w-auto" disabled={controlMutation.isPending || busy || !serverState} onClick={() => doControl("take")}>
                      {controlMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LockKeyhole className="mr-2 h-4 w-4" />} Take browser control
                    </Button>
                  )}
                </section>
                {isHuman && <div className="mb-4 flex gap-2 rounded-xl border border-[#d5c8a9] bg-[#f7f0df] px-3 py-3 text-xs leading-5 text-[#705e3e]"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Exclusive control:</strong> while you have control, all agent actions in this browser stop. Returning control restores access; it does not restart an ended chat or job.</p></div>}
                {localError && <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-[#e5c2b7] bg-[#fff4ef] p-3 text-sm text-[#884b3d]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{localError}</span></div>}
                {workspaceQuery.isFetching && workspaceQuery.data && <p className="mb-2 text-xs text-[#6b7a6e]" aria-live="polite">Refreshing browser status…</p>}
                {tabs.length === 0 ? (
                  <section className="rounded-2xl border border-[#d3dbd1] bg-[#faf9f4] p-5 sm:p-7">
                    <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8ede4] text-[#607966]"><Monitor className="h-5 w-5" /></div><div><h2 className="text-lg font-semibold">No open browser tabs</h2><p className="text-sm text-[#728075]">{workspaceQuery.data?.targetMissing
                      ? "The selected tab closed or expired. Human control is preserved. Open a new website, or return control after the server verifies the empty session."
                      : "Enter a site address to open a tab for this agent."}</p></div></div>
                    <AddressForm value={address} setValue={setAddress} submit={submitAddress} disabled={!effectivePersonaId || !serverState || busy || mutation.isPending} placeholder="example.com" buttonText="Open website" />
                  </section>
                ) : (
                  <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(290px,0.75fr)]">
                    <section className="min-w-0 overflow-hidden rounded-2xl border border-[#cbd6cc] bg-[#faf9f4] shadow-[0_12px_35px_rgba(52,74,59,0.08)]">
                      <div className="flex flex-wrap items-center gap-2 border-b border-[#e0e5db] px-3 py-3 sm:px-4">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Monitor className="h-4 w-4 shrink-0 text-[#687e6e]" />
                          <select aria-label="Choose browser tab" value={currentTabId} onChange={(event) => setTabId(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#d2dbd1] bg-white px-3 text-sm font-medium text-[#35483c]">
                            {tabs.map((tab) => <option key={tab.tabId} value={tab.tabId}>{tab.title || "Browser tab"}</option>)}
                          </select>
                        </div>
                        <button type="button" aria-label="Refresh screenshot and controls" title="Refresh screenshot and controls" onClick={() => { void workspaceQuery.refetch(); void viewQuery.refetch(); }} disabled={busy} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#d2dbd1] bg-white text-[#52695a] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /></button>
                        <button type="button" aria-label="Close selected tab" title="Close selected tab" onClick={() => setConfirming({ kind: "close", binding: approvalBinding })} disabled={actionDisabled} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#dfcec8] bg-white text-[#9b5446] disabled:opacity-40"><X className="h-4 w-4" /></button>
                      </div>
                      <AddressForm value={address} setValue={setAddress} submit={submitAddress} openNew={openNewTab} disabled={!serverState || busy || mutation.isPending || !isHuman} placeholder={activeTab?.url || "example.com"} buttonText="Go" compact />
                      <div className="relative min-h-[230px] overflow-hidden bg-[#dce2d8] sm:min-h-[360px]">
                        {viewQuery.isLoading && <div className="absolute inset-0 z-10 space-y-3 p-4"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-4/5" /><Skeleton className="h-40 w-full" /></div>}
                        {viewQuery.data?.screenshotBase64 && <img src={`data:image/png;base64,${viewQuery.data.screenshotBase64}`} alt={`Browser screenshot${viewQuery.data.title ? `: ${viewQuery.data.title}` : ""}`} className={`block h-auto max-h-[70vh] min-h-[230px] w-full object-contain object-top ${staleImage ? "opacity-45 grayscale" : ""}`} />}
                        {!viewQuery.data && !viewQuery.isLoading && (
                          <div className="flex min-h-[230px] flex-col items-center justify-center px-5 text-center text-[#708075]">
                            <Eye className="mb-3 h-7 w-7" /><p className="font-medium">{viewQuery.isError ? "Screenshot unavailable" : "Waiting for browser view"}</p>
                            {viewQuery.isError && <p className="mt-1 text-sm">{(viewQuery.error as Error).message}</p>}
                          </div>
                        )}
                        {staleImage && <div className="absolute inset-x-3 top-3 rounded-lg border border-[#bfc7b9] bg-[#f7f6ee]/95 px-3 py-2 text-xs font-semibold text-[#5e695d]">Showing the last screenshot — refresh failed or is in progress. Controls are paused.</div>}
                        {mutation.isPending && <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#e9ede5]/60 backdrop-blur-[1px]"><div className="flex items-center gap-2 rounded-xl border border-[#cbd6ca] bg-[#faf9f4] px-4 py-3 text-sm font-semibold shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /> Sending one browser action…</div></div>}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e0e5db] px-3 py-2.5 text-xs text-[#738074] sm:px-4">
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#79977f]" /> Screenshot · {formatTime(viewQuery.data?.capturedAt)}</span>
                        {safeUrl(viewQuery.data?.url || activeTab?.url || "") && <a href={safeUrl(viewQuery.data?.url || activeTab?.url || "")} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[#536f5c] underline underline-offset-2"><ExternalLink className="h-3.5 w-3.5" /> Open link</a>}
                      </div>
                    </section>

                    <aside className="min-w-0 space-y-4">
                      <section className="rounded-2xl border border-[#d1dacf] bg-[#faf9f4] p-4 shadow-[0_8px_26px_rgba(52,74,59,0.04)] sm:p-5">
                        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold tracking-tight">Page controls</h2><span className="text-[10px] font-bold uppercase tracking-wider text-[#839083]">Touch ready</span></div>
                        {!isHuman ? (
                          <div className="rounded-xl border border-[#e3ddcf] bg-[#f5f1e7] p-3 text-sm leading-5 text-[#746847]">You can view periodic screenshots in agent mode. Take control to use page controls.</div>
                        ) : !hasFreshView ? (
                          <div className="rounded-xl border border-[#e6c9be] bg-[#fff4ef] p-3 text-sm leading-5 text-[#8d5849]">Refresh the selected tab to get current page controls.</div>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <ControlButton icon={<ArrowUp />} label="Scroll up" onClick={() => runAction("scroll", { direction: "up" })} disabled={actionDisabled} />
                              <ControlButton icon={<ArrowDown />} label="Scroll down" onClick={() => runAction("scroll", { direction: "down" })} disabled={actionDisabled} />
                              <ControlButton icon={<ArrowLeft />} label="Scroll left" onClick={() => runAction("scroll", { direction: "left" })} disabled={actionDisabled} />
                              <ControlButton icon={<ArrowRight />} label="Scroll right" onClick={() => runAction("scroll", { direction: "right" })} disabled={actionDisabled} />
                            </div>
                            <p className="mt-3 text-xs leading-5 text-[#778276]">Scroll moves the remote page, not this panel. Controls use labeled page elements—not screenshot coordinates.</p>
                            <div className="mt-4 border-t border-[#e1e5dc] pt-4">
                              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><MousePointer2 className="h-4 w-4 text-[#67816d]" /> Page elements</h3>
                              {viewQuery.data?.elements?.length ? (
                                <div className="max-h-[310px] space-y-2 overflow-y-auto pr-1">
                                  {viewQuery.data.elements.map((element) => {
                                    const role = element.role.toLowerCase();
                                    const canType = ["textbox", "searchbox", "combobox", "spinbutton"].includes(role);
                                    const label = element.label?.trim() || `${role || "Page control"} control`;
                                    return (
                                      <div key={element.ref} className="flex min-w-0 items-center gap-2 rounded-xl border border-[#e0e5db] bg-[#f7f7f0] p-2">
                                        <div className="min-w-0 flex-1">
                                          <p className="break-words text-sm font-medium leading-5 text-[#394b3e]">{label}</p>
                                          <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[#899286]">{role}</p>
                                        </div>
                                        {canType ? (
                                          <button type="button" onClick={() => setSelectedElement({ ...element, binding: approvalBinding })} className={`min-h-11 min-w-[68px] rounded-lg px-3 text-xs font-semibold ${selectedElement?.ref === element.ref ? "bg-[#385c49] text-white" : "border border-[#cad5c9] bg-white text-[#4d6855]"}`}>{selectedElement?.ref === element.ref ? <Check className="mx-auto h-4 w-4" /> : "Type"}</button>
                                        ) : (
                                          <button type="button" disabled={actionDisabled} onClick={() => setConfirming({ kind: "click", element: { ...element, binding: approvalBinding }, binding: approvalBinding })} className="min-h-11 min-w-[68px] rounded-lg border border-[#cad5c9] bg-white px-3 text-xs font-semibold text-[#4d6855] disabled:opacity-40">Select</button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : <div className="rounded-xl bg-[#f2f3ec] px-3 py-4 text-center text-sm text-[#788176]">No labeled page controls are available in this snapshot.</div>}
                            </div>
                            {selectedElement && (
                              <form onSubmit={submitTyping} className="mt-4 space-y-2 border-t border-[#e1e5dc] pt-4">
                                <Label htmlFor="browser-type-draft" className="text-sm font-semibold">Type into: {selectedElement.label || selectedElement.role}</Label>
                                <Textarea id="browser-type-draft" value={typeDraft} onChange={(event) => setTypeDraft(event.target.value)} placeholder="Type a message or search…" rows={3} className="resize-y rounded-xl border-[#cad5c9] bg-white text-base" />
                                <div className="flex gap-2">
                                  <Button type="submit" className="min-h-11 flex-1 rounded-xl bg-[#385c49] hover:bg-[#2c4e3b]" disabled={actionDisabled || !typeDraft.trim()}><Send className="mr-2 h-4 w-4" /> Type into field</Button>
                                  <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={() => setSelectedElement(null)}>Cancel</Button>
                                </div>
                                <p className="text-xs leading-5 text-[#778276]">Text stays in this draft if an action fails. The phone keyboard opens when you tap the field.</p>
                              </form>
                            )}
                          </>
                        )}
                      </section>
                      <section className="rounded-2xl border border-[#d1dacf] bg-[#faf9f4] p-4 sm:p-5">
                        <h2 className="mb-3 text-sm font-semibold">Recent workspace activity</h2>
                        {serverState?.activity?.length ? (
                          <ul className="space-y-2.5">
                            {serverState.activity.slice(0, 5).map((item, index) => <li key={`${item.at}-${index}`} className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate font-medium text-[#526257]">{item.action.replace(/_/g, " ")}</span><time className="shrink-0 text-[#879185]">{formatTime(item.at)}</time></li>)}
                          </ul>
                        ) : <p className="text-xs leading-5 text-[#778276]">No browser actions recorded yet.</p>}
                      </section>
                    </aside>
                  </div>
                )}
              </>
            )}
          </>
        )}
        <footer className="mt-6 flex items-start gap-2 rounded-xl border border-[#d7ddd3] bg-[#e9ede5] px-3 py-3 text-xs leading-5 text-[#657466]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#62806a]" />
          <p>Browser access is supervised and scoped to your signed-in account and selected agent. This workspace does not expose raw selectors, scripts, or service keys.</p>
        </footer>
      </div>
      {confirming && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#1d2922]/45 p-3 sm:items-center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirming(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="workspace-confirm-title" className="w-full max-w-md rounded-2xl border border-[#d3dbd1] bg-[#faf9f4] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#f1e8d9] text-[#856a41]">{confirming.kind === "close" ? <X className="h-5 w-5" /> : <MousePointer2 className="h-5 w-5" />}</div><h2 id="workspace-confirm-title" className="text-lg font-semibold">{confirming.kind === "close" ? "Close this browser tab?" : "Activate this page control?"}</h2></div>
              <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#718075] hover:bg-[#ebeee6]" onClick={() => setConfirming(null)} aria-label="Cancel confirmation"><X className="h-5 w-5" /></button>
            </div>
            <p className="mt-3 break-words text-sm leading-6 text-[#637166]">{confirming.kind === "close"
              ? <>This will close <strong className="text-[#34483a]">{activeTab?.title || "the selected tab"}</strong> for {activePersona?.name || "this agent"}.</>
              : <>You are about to select <strong className="text-[#34483a]">{confirming.element?.label || confirming.element?.role || "this page control"}</strong> ({confirming.element?.role || "control"}) in <strong className="text-[#34483a]">{activeTab?.title || "the selected page"}</strong>.</>}</p>
            <p className="mt-2 text-xs leading-5 text-[#8a7a5e]">Only the labeled control shown here will be sent. If the page changed, refresh before continuing.</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button className="min-h-11 rounded-xl bg-[#385c49] hover:bg-[#2c4e3b]" disabled={actionDisabled || mutation.isPending} onClick={confirmAction}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{confirming.kind === "close" ? "Close tab" : "Confirm control"}</Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function AddressForm({ value, setValue, submit, openNew, disabled, placeholder, buttonText, compact = false }: {
  value: string;
  setValue: (value: string) => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  openNew?: () => void;
  disabled: boolean;
  placeholder: string;
  buttonText: string;
  compact?: boolean;
}) {
  return (
    <form onSubmit={submit} className={`flex gap-2 ${compact ? "border-b border-[#e0e5db] p-3 sm:px-4" : "mt-4"}`}>
      <Input value={value} onChange={(event) => setValue(event.target.value)} type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Website address" placeholder={placeholder} className="h-12 min-w-0 flex-1 rounded-xl border-[#cbd6cb] bg-white text-base" />
      <Button type="submit" disabled={disabled || !value.trim()} className="min-h-12 shrink-0 rounded-xl bg-[#385c49] px-4 text-white hover:bg-[#2c4e3b]">{compact ? <><ExternalLink className="mr-1.5 h-4 w-4" />{buttonText}</> : <><Plus className="mr-1.5 h-4 w-4" />{buttonText}</>}</Button>
      {openNew && <Button type="button" variant="outline" aria-label="Open address in a new tab" title="Open address in a new tab" disabled={disabled || !value.trim()} onClick={openNew} className="min-h-12 min-w-12 shrink-0 rounded-xl border-[#cbd6cb] bg-white px-3 text-[#4d6855]"><Plus className="h-4 w-4" /><span className="sr-only">New tab</span></Button>}
    </form>
  );
}

function ControlButton({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#ccd6ca] bg-[#f7f7f0] px-2 text-sm font-semibold text-[#4d6654] transition-colors hover:bg-[#e9eee6] disabled:cursor-not-allowed disabled:opacity-45">{icon}<span>{label}</span></button>;
}