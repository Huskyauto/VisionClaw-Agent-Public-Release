import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Brain, CloudUpload, Download, Loader2, Shield, User,
  Database, Clock, CheckCircle2, HardDrive,
} from "lucide-react";

export default function AccountPage() {
  const { toast } = useToast();
  const [backingUp, setBackingUp] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadingData, setDownloadingData] = useState(false);

  const tenantQuery = useQuery<any>({ queryKey: ["/api/tenants/me"] });
  const tenant = tenantQuery.data;

  const memoryQuery = useQuery<any>({
    queryKey: ["/api/memory/export"],
    select: (data: any) => data?.stats,
  });
  const stats = memoryQuery.data;

  const handleDriveBackup = async () => {
    setBackingUp(true);
    try {
      const resp = await apiRequest("POST", "/api/memory/backup-to-drive");
      const data = await resp.json();
      toast({
        title: "Memories saved to Google Drive",
        description: `${data.stats?.totalMemories || 0} memories and ${data.stats?.compactionArchives || 0} conversation archives backed up.`,
      });
    } catch (err: any) {
      toast({ title: "Backup failed", description: err.message, variant: "destructive" });
    } finally {
      setBackingUp(false);
    }
  };

  const handleDownloadMemories = async () => {
    setExporting(true);
    try {
      const resp = await authFetch("/api/memory/export");
      const data = await resp.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `memory-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Memory backup downloaded", description: `${data.stats?.totalMemories || 0} memories exported.` });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadAllData = async () => {
    setDownloadingData(true);
    try {
      const resp = await authFetch("/api/export");
      const data = await resp.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `visionclaw-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Data export downloaded" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingData(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-account-title">My Account</h1>
            <p className="text-sm text-muted-foreground">
              Manage your data, memories, and backups
            </p>
          </div>
        </div>

        {tenant && (
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium" data-testid="text-account-name">{tenant.name || "User"}</p>
                    <p className="text-sm text-muted-foreground">{tenant.email || ""}</p>
                  </div>
                </div>
                <Badge variant="outline" className="gap-1">
                  <Shield className="w-3 h-3" />
                  {tenant.plan || "trial"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" /> Memory Backup
            </CardTitle>
            <CardDescription className="text-xs">
              Your AI remembers your preferences, facts, and conversation history. Everything is safely stored and can be backed up anytime.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-xl font-bold text-primary" data-testid="text-memory-active">{stats.active || 0}</div>
                  <div className="text-[11px] text-muted-foreground">Active Memories</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-xl font-bold text-amber-500" data-testid="text-memory-archived">{stats.archived || 0}</div>
                  <div className="text-[11px] text-muted-foreground">Archived</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-xl font-bold text-muted-foreground" data-testid="text-memory-superseded">{stats.superseded || 0}</div>
                  <div className="text-[11px] text-muted-foreground">Superseded</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-xl font-bold text-blue-500" data-testid="text-memory-archives">{stats.compactionArchives || 0}</div>
                  <div className="text-[11px] text-muted-foreground">Chat Archives</div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleDriveBackup}
                disabled={backingUp}
                className="flex-1"
                data-testid="button-memory-drive-backup"
              >
                {backingUp ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CloudUpload className="w-4 h-4 mr-2" />}
                {backingUp ? "Saving..." : "Save to Google Drive"}
              </Button>
              <Button
                variant="outline"
                onClick={handleDownloadMemories}
                disabled={exporting}
                className="flex-1"
                data-testid="button-memory-download"
              >
                {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                {exporting ? "Downloading..." : "Download Backup"}
              </Button>
            </div>

            <div className="rounded-lg bg-muted/30 border p-3 space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium">Your memories are always safe</p>
                  <p className="text-[11px] text-muted-foreground">
                    Active memories, archived memories, and old conversation context are all preserved. 
                    When conversations get long, the AI extracts key facts before compacting — nothing important is lost.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium">Automatic backups run daily</p>
                  <p className="text-[11px] text-muted-foreground">
                    The platform automatically backs up all data to Google Drive every day at 3 AM. 
                    Memory snapshots are saved every 12 hours. You can also back up manually anytime using the buttons above.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" /> Data Export
            </CardTitle>
            <CardDescription className="text-xs">
              Download all your data — conversations, messages, memories, knowledge entries, and more — as a JSON file.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={handleDownloadAllData}
              disabled={downloadingData}
              className="w-full"
              data-testid="button-export-all-data"
            >
              {downloadingData ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <HardDrive className="w-4 h-4 mr-2" />}
              {downloadingData ? "Preparing export..." : "Download All My Data"}
            </Button>
            <p className="text-[11px] text-muted-foreground/60 mt-2">
              Includes conversations, messages, personas, memories, knowledge base, and skills. API keys are redacted for security.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
