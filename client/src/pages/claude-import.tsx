import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Github, Download, AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Sparkles, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface KnownCollection {
  label: string;
  url: string;
  description: string;
  stars: number | null;
  license: string;
}

interface PreviewAgent {
  slug: string;
  filename: string;
  proposedPersonaName: string;
  description: string;
  tier: "advisory" | "executor";
  tools: string[];
  hitlRecommendedTools: string[];
  warnings: string[];
  conflicts: boolean;
}

interface PreviewResponse {
  source: { url: string; owner: string; repo: string; ref: string; subpath: string; sourceSlug: string };
  counts: { fetched: number; parsed: number; errors: number; skippedNonAgentDocs: number; conflicts: number };
  agents: PreviewAgent[];
  errors: Array<{ path: string; error: string }>;
  skippedNonAgentDocs: string[];
}

interface ApplyResponse {
  source: { url: string; ref: string; sourceSlug: string; importedAt: string };
  counts: { created: number; skipped: number; errors: number };
  created: Array<{ id: number; name: string; tier: string }>;
  skipped: Array<{ name: string; reason: string }>;
  errors: Array<{ path: string; error: string }>;
}

export default function ClaudeImportPage() {
  const { toast } = useToast();
  const [url, setUrl] = useState("https://github.com/0xSteph/pentest-ai-agents/tree/main/.claude/agents");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: knownData } = useQuery<{ collections: KnownCollection[] }>({
    queryKey: ["/api/claude-import/known-collections"],
    staleTime: 5 * 60_000,
  });

  const previewMut = useMutation({
    mutationFn: async (githubUrl: string) => {
      const res = await apiRequest("POST", "/api/claude-import/preview", { githubUrl });
      return (await res.json()) as PreviewResponse;
    },
    onSuccess: (data) => {
      setPreview(data);
      setSelected(new Set(data.agents.filter((a) => !a.conflicts).map((a) => a.slug)));
    },
    onError: (e: any) => {
      toast({ title: "Preview failed", description: e.message || String(e), variant: "destructive" });
    },
  });

  const applyMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/claude-import/apply", {
        githubUrl: url,
        selectedSlugs: Array.from(selected),
      });
      return (await res.json()) as ApplyResponse;
    },
    onSuccess: (data) => {
      toast({
        title: "Import complete",
        description: `Created ${data.counts.created}, skipped ${data.counts.skipped}, errors ${data.counts.errors}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
      setPreview(null);
      setSelected(new Set());
    },
    onError: (e: any) => {
      toast({ title: "Import failed", description: e.message || String(e), variant: "destructive" });
    },
  });

  const allChecked = useMemo(
    () => preview?.agents.every((a) => a.conflicts || selected.has(a.slug)) ?? false,
    [preview, selected],
  );

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleAll() {
    if (!preview) return;
    const importable = preview.agents.filter((a) => !a.conflicts);
    if (selected.size === importable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(importable.map((a) => a.slug)));
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Github className="w-6 h-6" /> Import Claude Code Subagents
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          VisionClaw is the multi-tenant runtime for any Claude Code <code>.claude/agents/</code> collection.
          Drop in a GitHub URL and import every agent as a VisionClaw persona — with HITL gates, audit trail, billing, and scheduling already wired in.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source</CardTitle>
          <CardDescription>
            Paste a public GitHub URL. Bare repo URLs default to <code>.claude/agents</code>; tree URLs use the explicit path.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="github-url" className="text-sm">GitHub URL</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="github-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/tree/branch/.claude/agents"
                data-testid="input-github-url"
              />
              <Button
                onClick={() => previewMut.mutate(url)}
                disabled={!url.trim() || previewMut.isPending}
                data-testid="button-preview"
              >
                {previewMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Preview"}
              </Button>
            </div>
          </div>

          {knownData?.collections && knownData.collections.length > 0 && (
            <div>
              <Label className="text-sm">Curated collections</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                {knownData.collections.map((c) => (
                  <button
                    key={c.url}
                    type="button"
                    onClick={() => setUrl(c.url)}
                    className="text-left border rounded-md p-3 hover:border-primary/60 transition-colors"
                    data-testid={`button-curated-${c.url}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm">{c.label}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {c.stars != null && <span>★ {c.stars}</span>}
                        <Badge variant="outline" className="text-[10px]">{c.license}</Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> Preview — {preview.source.owner}/{preview.source.repo}@{preview.source.ref}
                </CardTitle>
                <CardDescription>
                  {preview.counts.parsed} agents · {preview.counts.errors} errors · {preview.counts.conflicts} conflicts · {preview.counts.skippedNonAgentDocs} non-agent docs skipped
                </CardDescription>
              </div>
              <Button
                onClick={() => applyMut.mutate()}
                disabled={selected.size === 0 || applyMut.isPending}
                data-testid="button-apply"
              >
                {applyMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                Import {selected.size} selected
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>{preview.errors.length} parse error{preview.errors.length === 1 ? "" : "s"}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5 text-xs mt-1">
                    {preview.errors.map((e) => (
                      <li key={e.path}><code>{e.path}</code>: {e.error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between border-b pb-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} data-testid="checkbox-toggle-all" />
                <span className="font-medium">Select all importable</span>
              </label>
              <span className="text-xs text-muted-foreground">{selected.size} / {preview.agents.filter((a) => !a.conflicts).length} selected</span>
            </div>

            <ScrollArea className="max-h-[60vh]">
              <ul className="space-y-2">
                {preview.agents.map((a) => (
                  <li
                    key={a.slug}
                    className={`border rounded-md p-3 ${a.conflicts ? "opacity-60 bg-muted/40" : ""}`}
                    data-testid={`agent-row-${a.slug}`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected.has(a.slug)}
                        onCheckedChange={() => toggle(a.slug)}
                        disabled={a.conflicts}
                        className="mt-0.5"
                        data-testid={`checkbox-agent-${a.slug}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-medium" data-testid={`text-agent-name-${a.slug}`}>{a.proposedPersonaName}</span>
                          <Badge variant={a.tier === "executor" ? "destructive" : "secondary"} className="text-[10px]">
                            {a.tier === "executor" ? <ShieldAlert className="w-3 h-3 mr-1" /> : null}
                            {a.tier}
                          </Badge>
                          {a.conflicts && (
                            <Badge variant="outline" className="text-[10px]">already imported</Badge>
                          )}
                          {a.warnings.length > 0 && (
                            <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400">
                              {a.warnings.length} warning{a.warnings.length === 1 ? "" : "s"}
                            </Badge>
                          )}
                        </div>
                        {a.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.description}</p>
                        )}
                        {a.tools.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {a.tools.map((t) => (
                              <Badge
                                key={t}
                                variant={a.hitlRecommendedTools.includes(t) ? "destructive" : "outline"}
                                className="text-[10px] font-mono"
                              >
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {applyMut.data && (
        <Alert>
          <CheckCircle2 className="w-4 h-4" />
          <AlertTitle>Import complete</AlertTitle>
          <AlertDescription>
            Created {applyMut.data.counts.created}, skipped {applyMut.data.counts.skipped}, errors {applyMut.data.counts.errors}.{" "}
            <a href="/personas" className="underline inline-flex items-center gap-1">
              View imported personas <ExternalLink className="w-3 h-3" />
            </a>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
