import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Phone, QrCode, Wifi, WifiOff, Send, RefreshCw, Loader2, MessageSquare, Shield, Bell, CheckCircle } from "lucide-react";

interface WhatsAppStatus {
  state: "disconnected" | "connecting" | "qr" | "connected";
  phone: string | null;
  qr: string | null;
  autoReply: boolean;
  error: string | null;
  allowedContacts: string[] | null;
}

export default function WhatsAppPage() {
  const { toast } = useToast();
  const [sendTo, setSendTo] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [approvalPhone, setApprovalPhone] = useState("");

  const { data: status, isLoading } = useQuery<WhatsAppStatus>({
    queryKey: ["/api/whatsapp/status"],
    refetchInterval: (query) => {
      const st = query.state.data?.state;
      if (st === "connecting" || st === "qr") return 2000;
      if (st === "connected") return 10000;
      return 5000;
    },
  });

  const { data: qrData, refetch: refetchQR } = useQuery<{ qr: string }>({
    queryKey: ["/api/whatsapp/qr"],
    enabled: status?.state === "qr",
    refetchInterval: status?.state === "qr" ? 3000 : false,
  });

  const connectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/connect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
      toast({ title: "Connecting to WhatsApp...", description: "Scan the QR code with your phone" });
    },
    onError: (err: any) => {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
      toast({ title: "Disconnected from WhatsApp" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/send", { to: sendTo, message: sendMessage }),
    onSuccess: () => {
      toast({ title: "Message sent!" });
      setSendMessage("");
    },
    onError: (err: any) => {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (body: { autoReply?: boolean; allowedContacts?: string[] | null }) =>
      apiRequest("POST", "/api/whatsapp/settings", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
    },
  });

  const { data: approvalData } = useQuery<{ phone: string | null }>({
    queryKey: ["/api/whatsapp/approval-phone"],
  });

  useEffect(() => {
    setApprovalPhone(approvalData?.phone || "");
  }, [approvalData]);

  const approvalPhoneMutation = useMutation({
    mutationFn: (phone: string | null) => apiRequest("POST", "/api/whatsapp/approval-phone", { phone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/approval-phone"] });
      toast({ title: "Approval phone updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const testApprovalMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/test-approval"),
    onSuccess: () => {
      toast({ title: "Test sent!", description: "Check your WhatsApp for a test approval request" });
    },
    onError: (err: any) => {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    },
  });

  const stateColor = {
    disconnected: "bg-red-500/20 text-red-400 border-red-500/30",
    connecting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    qr: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    connected: "bg-green-500/20 text-green-400 border-green-500/30",
  };

  const stateLabel = {
    disconnected: "Disconnected",
    connecting: "Connecting...",
    qr: "Scan QR Code",
    connected: "Connected",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="whatsapp-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="container mx-auto p-4 sm:p-6 max-w-4xl space-y-6 pb-20" data-testid="whatsapp-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" data-testid="text-whatsapp-title">
            <Phone className="w-5 h-5 sm:w-6 sm:h-6 text-green-500" />
            WhatsApp
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Connect your WhatsApp to receive and respond with AI
          </p>
        </div>
        <Badge className={stateColor[status?.state || "disconnected"]} data-testid="badge-whatsapp-state">
          {status?.state === "connected" ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
          {stateLabel[status?.state || "disconnected"]}
        </Badge>
      </div>

      {status?.error && (
        <Card className="border-red-500/30 bg-red-500/5" data-testid="card-whatsapp-error">
          <CardContent className="p-4 text-red-400 text-sm">
            {status.error}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card data-testid="card-connection">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5" />
              Connection
            </CardTitle>
            <CardDescription>
              {status?.state === "connected"
                ? `Connected as ${status.phone || "unknown"}`
                : "Connect your WhatsApp by scanning a QR code"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.state === "qr" && qrData?.qr && (
              <div className="flex flex-col items-center space-y-3" data-testid="qr-container">
                <div className="bg-white p-3 rounded-lg">
                  <img
                    src={qrData.qr}
                    alt="WhatsApp QR Code"
                    className="w-48 h-48 sm:w-64 sm:h-64"
                    data-testid="img-qr-code"
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → Scan this QR code
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchQR()}
                  data-testid="button-refresh-qr"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh QR
                </Button>
              </div>
            )}

            {status?.state === "connecting" && (
              <div className="flex items-center justify-center py-8" data-testid="connecting-spinner">
                <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                <span className="ml-3 text-muted-foreground">Establishing connection...</span>
              </div>
            )}

            {status?.state === "connected" && (
              <div className="text-center py-4 space-y-2" data-testid="connected-info">
                <div className="inline-flex items-center gap-2 text-green-400 font-medium">
                  <Wifi className="w-5 h-5" />
                  WhatsApp Connected
                </div>
                {status.phone && (
                  <p className="text-sm text-muted-foreground" data-testid="text-connected-phone">
                    Phone: {status.phone}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {status?.state === "disconnected" && (
                <Button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                  className="w-full bg-green-600 hover:bg-green-700"
                  data-testid="button-connect"
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Phone className="w-4 h-4 mr-2" />
                  )}
                  Connect WhatsApp
                </Button>
              )}
              {(status?.state === "connected" || status?.state === "qr") && (
                <Button
                  variant="destructive"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className="w-full"
                  data-testid="button-disconnect"
                >
                  <WifiOff className="w-4 h-4 mr-2" />
                  Disconnect
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-settings">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Settings
            </CardTitle>
            <CardDescription>Configure auto-reply behavior and message filtering</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Auto-Reply</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically reply to incoming messages with AI
                </p>
              </div>
              <Switch
                checked={status?.autoReply ?? true}
                onCheckedChange={(checked) => settingsMutation.mutate({ autoReply: checked })}
                data-testid="switch-auto-reply"
              />
            </div>

            <div className="pt-2 border-t border-border">
              <Label className="text-sm">How it works</Label>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li className="flex items-start gap-2">
                  <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                  Messages from individual chats are processed by your active AI persona
                </li>
                <li className="flex items-start gap-2">
                  <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                  Group messages are ignored by default
                </li>
                <li className="flex items-start gap-2">
                  <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                  Each contact gets their own conversation thread
                </li>
                <li className="flex items-start gap-2">
                  <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                  All AI tools (web search, file ops, etc.) are available
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-approval-gate">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Approval Gate
          </CardTitle>
          <CardDescription>
            Get notified on WhatsApp when AI agents need your approval for high-risk actions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Your WhatsApp Number</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                className="flex-1"
                placeholder="14155551234"
                value={approvalPhone}
                onChange={(e) => setApprovalPhone(e.target.value)}
                data-testid="input-approval-phone"
              />
              <Button
                className="shrink-0"
                onClick={() => approvalPhoneMutation.mutate(approvalPhone || null)}
                disabled={approvalPhoneMutation.isPending}
                data-testid="button-save-approval-phone"
              >
                {approvalPhoneMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Country code + number, no spaces or symbols (e.g. 14155551234)
            </p>
          </div>

          {approvalData?.phone && (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-muted-foreground">
                Approval notifications active for +{approvalData.phone}
              </span>
            </div>
          )}

          {approvalData?.phone && (
            <Button
              variant="default"
              size="default"
              className="w-full"
              onClick={() => testApprovalMutation.mutate()}
              disabled={testApprovalMutation.isPending || status?.state !== "connected"}
              data-testid="button-test-approval"
            >
              {testApprovalMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              {status?.state === "connected" ? "Send Test Approval" : "Connect WhatsApp First to Test"}
            </Button>
          )}

          <div className="pt-2 border-t border-border space-y-2">
            <Label className="text-sm">How it works</Label>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <Bell className="w-3 h-3 mt-0.5 shrink-0" />
                When an AI agent tries a high-risk action (send email, delegate task, etc.), it pauses
              </li>
              <li className="flex items-start gap-2">
                <Phone className="w-3 h-3 mt-0.5 shrink-0" />
                You get a WhatsApp message with the action details and a short task ID
              </li>
              <li className="flex items-start gap-2">
                <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                Reply "YES [ID]" to approve or "NO [ID]" to reject — right from your phone
              </li>
              <li className="flex items-start gap-2">
                <Shield className="w-3 h-3 mt-0.5 shrink-0" />
                Unanswered requests auto-deny after 10 minutes for safety
              </li>
            </ul>
          </div>

        </CardContent>
      </Card>

      {status?.state === "connected" && (
        <Card data-testid="card-send-message">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              Send Message
            </CardTitle>
            <CardDescription>Send a message through WhatsApp to any number</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Phone Number</Label>
                <Input
                  placeholder="14155551234"
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                  data-testid="input-send-to"
                />
                <p className="text-xs text-muted-foreground">With country code, no + or spaces</p>
              </div>
              <div className="space-y-1">
                <Label>Message</Label>
                <Textarea
                  placeholder="Type your message..."
                  value={sendMessage}
                  onChange={(e) => setSendMessage(e.target.value)}
                  rows={2}
                  data-testid="input-send-message"
                />
              </div>
            </div>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending || !sendTo || !sendMessage}
              data-testid="button-send"
            >
              {sendMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send Message
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
    </div>
  );
}
