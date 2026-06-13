import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Activity, AlertTriangle, AlertCircle, Info, RefreshCw, FileCode } from "lucide-react";
import { useState } from "react";

interface Finding {
  severity: "critical" | "warning" | "info";
  pattern: string;
  category: string;
  file_path: string;
  line_number: number;
  snippet: string;
}

interface ScanRow {
  scan_id: string;
  files_scanned: number;
  total_findings: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  duration_ms: number;
  created_at: string;
}

export default function CodeHealthPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "critical" | "warning" | "info">("critical");
  const { data, isLoading } = useQuery<{ scan: ScanRow | null; findings: Finding[] }>({
    queryKey: ["/api/code-health/latest"],
  });

  const scan = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/code-health/scan", {}).then(r => r.json()),
    onSuccess: (r: any) => {
      toast({ title: "Scan complete", description: `${r.filesScanned} files, ${r.totalFindings} findings in ${r.durationMs}ms` });
      queryClient.invalidateQueries({ queryKey: ["/api/code-health/latest"] });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
  });

  const findings = (data?.findings ?? []).filter(f => filter === "all" || f.severity === filter);
  const grouped = findings.reduce<Record<string, Finding[]>>((acc, f) => {
    (acc[f.category] ||= []).push(f);
    return acc;
  }, {});

  const sevIcon = (s: string) =>
    s === "critical" ? <AlertCircle className="w-4 h-4 text-red-500" />
    : s === "warning" ? <AlertTriangle className="w-4 h-4 text-yellow-500" />
    : <Info className="w-4 h-4 text-blue-400" />;

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-5xl space-y-4" data-testid="page-code-health">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold">Code Health</h1>
        </div>
        <Button onClick={() => scan.mutate()} disabled={scan.isPending} data-testid="button-rescan">
          <RefreshCw className={`w-4 h-4 mr-1 ${scan.isPending ? "animate-spin" : ""}`} />
          {scan.isPending ? "Scanning..." : "Re-scan"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !data?.scan ? (
        <Card className="p-6 text-center text-muted-foreground">
          No scans yet. Click <strong>Re-scan</strong> to run the BS Detector.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Files", value: data.scan.files_scanned, color: "text-foreground" },
              { label: "Critical", value: data.scan.critical_count, color: "text-red-500", filter: "critical" as const },
              { label: "Warnings", value: data.scan.warning_count, color: "text-yellow-500", filter: "warning" as const },
              { label: "Info", value: data.scan.info_count, color: "text-blue-400", filter: "info" as const },
            ].map((s) => (
              <button
                key={s.label}
                onClick={() => s.filter && setFilter(s.filter)}
                className={`p-3 rounded-lg bg-card border text-left transition-colors ${
                  s.filter && filter === s.filter ? "border-primary ring-1 ring-primary/40" : "border-border hover:border-primary/40"
                }`}
                data-testid={`stat-${s.label.toLowerCase()}`}
              >
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground" data-testid="text-scan-meta">
            Scan {data.scan.scan_id} · {new Date(data.scan.created_at).toLocaleString()} · {data.scan.duration_ms}ms
          </div>

          <div className="flex gap-2 flex-wrap">
            {(["critical", "warning", "info", "all"] as const).map(f => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
                data-testid={`filter-${f}`}
              >
                {f}
              </Button>
            ))}
          </div>

          {Object.keys(grouped).length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">No {filter} findings — clean.</Card>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <Card key={category} className="p-4" data-testid={`group-${category.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-2 mb-3">
                  {sevIcon(items[0].severity)}
                  <h3 className="font-semibold">{category}</h3>
                  <Badge variant="outline">{items.length}</Badge>
                </div>
                <ul className="space-y-1.5">
                  {items.slice(0, 50).map((f, i) => (
                    <li key={i} className="text-sm border-l-2 border-border pl-3 py-1" data-testid={`finding-${i}`}>
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <FileCode className="w-3 h-3 shrink-0 mt-0.5" />
                        <code className="break-all">{f.file_path}:{f.line_number}</code>
                      </div>
                      <code className="block text-xs bg-muted/50 p-1.5 mt-1 rounded font-mono break-all">{f.snippet}</code>
                    </li>
                  ))}
                  {items.length > 50 && (
                    <li className="text-xs text-muted-foreground italic">+ {items.length - 50} more…</li>
                  )}
                </ul>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}
