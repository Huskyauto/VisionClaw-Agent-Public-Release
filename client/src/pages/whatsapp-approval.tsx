import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Phone, QrCode, Wifi, WifiOff, RefreshCw, Loader2, MessageSquare, Shield, Bell, CheckCircle, Send } from "lucide-react";

interface WhatsAppStatus {
  state: "disconnected" | "connecting" | "qr" | "connected";
  phone: string | null;
  qr: string | null;
  autoReply: boolean;
  error: string | null;
  allowedContacts: string[] | null;
}

export default function WhatsAppApprovalPage() {
  const { toast } = useToast();
  const [approvalPhone, setApprovalPhone] = useState("");

  const { data: status, isLoading } = useQuery<WhatsAppStatus>({
    queryKey: ["/api/whatsapp/my/status"],
    refetchInterval: (query) => {
      const st = query.state.data?.state;
      if (st === "connecting" || st === "qr") return 2000;
      if (st === "connected") return 10000;
      return 5000;
    },
  });

  const { data: qrData, refetch: refetchQR } = useQuery<{ qr: string }>({
    queryKey: ["/api/whatsapp/my/qr"],
    enabled: status?.state === "qr",
    refetchInterval: status?.state === "qr" ? 3000 : false,
  });

  const connectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/my/connect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/my/status"] });
      toast({ title: "Connecting to WhatsApp...", description: "Scan the QR code with your phone" });
    },
    onError: (err: any) => {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/my/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/my/status"] });
      toast({ title: "Disconnected from WhatsApp" });
    },
  });

  const { data: approvalData } = useQuery<{ phone: string | null }>({
    queryKey: ["/api/whatsapp/my/approval-phone"],
  });

  useEffect(() => {
    setApprovalPhone(approvalData?.phone || "");
  }, [approvalData]);

  const approvalPhoneMutation = useMutation({
    mutationFn: (phone: string | null) => apiRequest("POST", "/api/whatsapp/my/approval-phone", { phone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/my/approval-phone"] });
      toast({ title: "Approval phone updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const testApprovalMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/my/test-approval"),
    onSuccess: () => {
      toast({ title: "Test sent!", description: "Check your WhatsApp for a test approval request" });
    },
    onError: (err: any) => {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    },
  });

  const stateColor: Record<string, string> = {
    disconnected: "bg-red-500/20 text-red-400 border-red-500/30",
    connecting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    qr: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    connected: "bg-green-500/20 text-green-400 border-green-500/30",
  };

  const stateLabel: Record<string, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting...",
    qr: "Scan QR Code",
    connected: "Connected",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="whatsapp-approval-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-4 sm:p-6 max-w-4xl space-y-6 pb-20" data-testid="whatsapp-approval-page">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" data-testid="text-whatsapp-approval-title">
              <Phone className="w-5 h-5 sm:w-6 sm:h-6 text-green-500" />
              WhatsApp Approvals
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Connect your WhatsApp to approve or reject AI agent actions from your phone
            </p>
          </div>
          <Badge className={stateColor[status?.state || "disconnected"]} data-testid="badge-whatsapp-my-state">
            {status?.state === "connected" ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
            {stateLabel[status?.state || "disconnected"]}
          </Badge>
        </div>

        {status?.error && (
          <Card className="border-red-500/30 bg-red-500/5" data-testid="card-whatsapp-my-error">
            <CardContent className="p-4 text-red-400 text-sm">
              {status.error}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card data-testid="card-my-connection">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="w-5 h-5" />
                Connection
              </CardTitle>
              <CardDescription>
                {status?.state === "connected"
                  ? `Connected as ${status.phone || "unknown"}`
                  : "Connect your personal WhatsApp by scanning a QR code"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {status?.state === "qr" && qrData?.qr && (
                <div className="flex flex-col items-center space-y-3" data-testid="qr-my-container">
                  <div className="bg-white p-3 rounded-lg">
                    <img
                      src={qrData.qr}
                      alt="WhatsApp QR Code"
                      className="w-48 h-48 sm:w-64 sm:h-64"
                      data-testid="img-my-qr-code"
                    />
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Open WhatsApp on your phone &rarr; Settings &rarr; Linked Devices &rarr; Link a Device &rarr; Scan this QR code
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchQR()}
                    data-testid="button-my-refresh-qr"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh QR
                  </Button>
                </div>
              )}

              {status?.state === "connecting" && (
                <div className="flex items-center justify-center py-8" data-testid="my-connecting-spinner">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                  <span className="ml-3 text-muted-foreground">Establishing connection...</span>
                </div>
              )}

              {status?.state === "connected" && (
                <div className="text-center py-4 space-y-2" data-testid="my-connected-info">
                  <div className="inline-flex items-center gap-2 text-green-400 font-medium">
                    <Wifi className="w-5 h-5" />
                    WhatsApp Connected
                  </div>
                  {status.phone && (
                    <p className="text-sm text-muted-foreground" data-testid="text-my-connected-phone">
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
                    data-testid="button-my-connect"
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
                    data-testid="button-my-disconnect"
                  >
                    <WifiOff className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-how-it-works">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                How It Works
              </CardTitle>
              <CardDescription>Your AI agents ask before taking risky actions</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-3">
                  <Bell className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                  <span>When an AI agent tries a high-risk action (send email, delegate task, execute command), it <strong className="text-foreground">pauses and asks you first</strong></span>
                </li>
                <li className="flex items-start gap-3">
                  <Phone className="w-4 h-4 mt-0.5 shrink-0 text-green-400" />
                  <span>You get a WhatsApp message with the action details and a short task ID</span>
                </li>
                <li className="flex items-start gap-3">
                  <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-blue-400" />
                  <span>Reply <strong className="text-foreground">YES [ID]</strong> to approve or <strong className="text-foreground">NO [ID]</strong> to reject</span>
                </li>
                <li className="flex items-start gap-3">
                  <Shield className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
                  <span>Unanswered requests auto-deny after 10 minutes for safety</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card data-testid="card-my-approval-gate">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Approval Phone Number
            </CardTitle>
            <CardDescription>
              Set the WhatsApp number where approval requests will be sent
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
                  data-testid="input-my-approval-phone"
                />
                <Button
                  className="shrink-0"
                  onClick={() => approvalPhoneMutation.mutate(approvalPhone || null)}
                  disabled={approvalPhoneMutation.isPending}
                  data-testid="button-my-save-approval-phone"
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
                data-testid="button-my-test-approval"
              >
                {testApprovalMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                {status?.state === "connected" ? "Send Test Approval" : "Connect WhatsApp First to Test"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
