import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Send, Wifi, WifiOff, Loader2, Users, CheckCircle, XCircle, Clock, Shield } from "lucide-react";
import { SiTelegram } from "react-icons/si";

interface TelegramStatus {
  connected: boolean;
  username?: string;
  approvedUsers?: number;
}

interface PendingPairing {
  code: string;
  username: string;
  firstName: string;
  createdAt: number;
}

interface ApprovedUser {
  telegramUserId: number;
  username: string;
  firstName: string;
  approvedAt: string;
}

export default function TelegramPage() {
  const { toast } = useToast();
  const [botToken, setBotToken] = useState("");

  const { data: status, isLoading } = useQuery<TelegramStatus>({
    queryKey: ["/api/telegram/status"],
    refetchInterval: 10000,
  });

  const { data: pairings = [] } = useQuery<PendingPairing[]>({
    queryKey: ["/api/telegram/pairings"],
    enabled: status?.connected === true,
    refetchInterval: 5000,
  });

  const { data: approvedUsers = [] } = useQuery<ApprovedUser[]>({
    queryKey: ["/api/telegram/users"],
    enabled: status?.connected === true,
    refetchInterval: 15000,
  });

  const connectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/telegram/connect", { token: botToken }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] });
      toast({ title: "Telegram bot connected!", description: "Users can now send /start to your bot to pair." });
      setBotToken("");
    },
    onError: (err: any) => {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/telegram/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] });
      toast({ title: "Telegram bot disconnected" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (code: string) => apiRequest("POST", "/api/telegram/approve", { code }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/pairings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] });
      toast({ title: "User approved!", description: "They can now interact with VisionClaw via Telegram." });
    },
    onError: (err: any) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (telegramUserId: number) => apiRequest("POST", "/api/telegram/revoke", { telegramUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] });
      toast({ title: "User access revoked" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="telegram-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6" data-testid="telegram-page">
      <div className="flex items-center gap-3">
        <SiTelegram className="h-8 w-8 text-[#0088cc]" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Telegram Integration</h1>
          <p className="text-muted-foreground">Connect a Telegram bot to interact with VisionClaw agents via Telegram.</p>
        </div>
      </div>

      <Card data-testid="card-connection-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status?.connected ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-muted-foreground" />
            )}
            Connection Status
          </CardTitle>
          <CardDescription>
            {status?.connected
              ? `Bot active as ${status.username} — ${status.approvedUsers || 0} approved user(s)`
              : "No Telegram bot connected"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!status?.connected ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bot-token">Bot Token</Label>
                <Input
                  id="bot-token"
                  type="password"
                  placeholder="Paste your Telegram bot token from @BotFather"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  data-testid="input-bot-token"
                />
                <p className="text-xs text-muted-foreground">
                  Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary underline">@BotFather</a> on Telegram, then paste the token here.
                </p>
              </div>
              <Button
                onClick={() => connectMutation.mutate()}
                disabled={!botToken || botToken.length < 20 || connectMutation.isPending}
                data-testid="button-connect"
              >
                {connectMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting...</>
                ) : (
                  <><Send className="mr-2 h-4 w-4" /> Connect Bot</>
                )}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="badge-connected">
                <CheckCircle className="mr-1 h-3 w-3" /> Connected
              </Badge>
              <span className="text-sm text-muted-foreground" data-testid="text-bot-username">{status.username}</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="ml-auto"
                data-testid="button-disconnect"
              >
                {disconnectMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                Disconnect
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {status?.connected && (
        <>
          <Card data-testid="card-pending-pairings">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                Pending Pairings
                {pairings.length > 0 && (
                  <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    {pairings.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Users who sent /start to your bot and are waiting to be approved
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pairings.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-pairings">
                  No pending pairing requests. Users can send /start to your bot to request access.
                </p>
              ) : (
                <div className="space-y-3">
                  {pairings.map((p) => (
                    <div
                      key={p.code}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                      data-testid={`pairing-${p.code}`}
                    >
                      <div>
                        <div className="font-medium">{p.firstName}</div>
                        <div className="text-sm text-muted-foreground">
                          {p.username ? `@${p.username}` : "No username"} · Code: <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{p.code}</code>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate(p.code)}
                        disabled={approveMutation.isPending}
                        data-testid={`button-approve-${p.code}`}
                      >
                        {approveMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Shield className="mr-2 h-4 w-4" />
                        )}
                        Approve
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-approved-users">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Approved Users
                {approvedUsers.length > 0 && (
                  <Badge variant="secondary">{approvedUsers.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Users with permission to interact with VisionClaw via Telegram
              </CardDescription>
            </CardHeader>
            <CardContent>
              {approvedUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-users">
                  No approved users yet. Approve pending pairings above.
                </p>
              ) : (
                <div className="space-y-3">
                  {approvedUsers.map((u) => (
                    <div
                      key={u.telegramUserId}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                      data-testid={`user-${u.telegramUserId}`}
                    >
                      <div>
                        <div className="font-medium">{u.firstName}</div>
                        <div className="text-sm text-muted-foreground">
                          {u.username ? `@${u.username}` : "No username"} · Approved {new Date(u.approvedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => revokeMutation.mutate(u.telegramUserId)}
                        disabled={revokeMutation.isPending}
                        data-testid={`button-revoke-${u.telegramUserId}`}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-setup-guide">
            <CardHeader>
              <CardTitle>Setup Guide</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center p-0">1</Badge>
                <p>Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary underline">@BotFather</a> — send <code>/newbot</code>, choose a name, and copy the token.</p>
              </div>
              <div className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center p-0">2</Badge>
                <p>Paste the token above and click "Connect Bot" to bring it online.</p>
              </div>
              <div className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center p-0">3</Badge>
                <p>Users send <code>/start</code> to your bot to get a pairing code.</p>
              </div>
              <div className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center p-0">4</Badge>
                <p>Approve their pairing code here. Once approved, messages are routed to VisionClaw's AI agents.</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
