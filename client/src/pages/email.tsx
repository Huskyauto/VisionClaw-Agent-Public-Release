import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Mail, Send, RefreshCw, ChevronRight, ArrowLeft, Reply, Plus, Clock, Copy, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ErrorState } from "@/components/error-state";

interface EmailStatus {
  configured: boolean;
  inbox: string | null;
  inboxId: string | null;
}

interface EmailMessage {
  messageId?: string;
  message_id?: string;
  id?: string;
  from?: string | string[];
  to?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  preview?: string;
  extractedText?: string;
  extracted_text?: string;
  createdAt?: string;
  created_at?: string;
  threadId?: string;
  thread_id?: string;
}

function getFromDisplay(from: string | string[] | undefined): string {
  if (!from) return "Unknown";
  if (Array.isArray(from)) return from.join(", ");
  return from;
}

function getMsgId(msg: EmailMessage): string {
  return msg.messageId || msg.message_id || msg.id || "";
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      data-testid="button-copy-email"
      onClick={() => {
        navigator.clipboard.writeText(email);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : "Copy address"}
    </button>
  );
}

function ComposeDialog({ onSent }: { onSent: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");

  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email/send", { to, subject, text }),
    onSuccess: () => {
      toast({ description: `Email sent to ${to}` });
      setTo("");
      setSubject("");
      setText("");
      setOpen(false);
      onSent();
    },
    onError: (err: any) => toast({ description: err.message || "Failed to send", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-compose-email" className="gap-2">
          <Plus className="w-4 h-4" />
          Compose
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-4 h-4" />
            New Email
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              data-testid="input-email-to"
              placeholder="recipient@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              data-testid="input-email-subject"
              placeholder="Email subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              data-testid="input-email-body"
              placeholder="Write your message..."
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <Button
            data-testid="button-send-email"
            onClick={() => sendMutation.mutate()}
            disabled={!to || !subject || !text || sendMutation.isPending}
            className="w-full gap-2"
          >
            <Send className="w-4 h-4" />
            {sendMutation.isPending ? "Sending..." : "Send Email"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageView({ message, onBack }: { message: EmailMessage; onBack: () => void }) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const [showReply, setShowReply] = useState(false);

  const msgId = getMsgId(message);

  const fullMessageQuery = useQuery<EmailMessage>({
    queryKey: ["/api/email/messages", msgId],
    enabled: !!msgId,
  });

  const fullMsg = fullMessageQuery.data || message;

  const replyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/email/reply", { messageId: msgId, text: replyText }),
    onSuccess: () => {
      toast({ description: "Reply sent" });
      setReplyText("");
      setShowReply(false);
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] });
    },
    onError: (err: any) => toast({ description: err.message || "Failed to reply", variant: "destructive" }),
  });

  const displayText = fullMsg.extractedText || fullMsg.extracted_text || fullMsg.text || "";
  const date = fullMsg.createdAt || fullMsg.created_at || "";

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1" data-testid="button-back-to-inbox">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setShowReply(!showReply)}
            data-testid="button-reply"
          >
            <Reply className="w-4 h-4" />
            Reply
          </Button>
        </div>
        <div>
          <h2 className="text-lg font-semibold">{fullMsg.subject || "(No Subject)"}</h2>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>From: {getFromDisplay(fullMsg.from)}</span>
            {date && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(date)}</span>
              </>
            )}
          </div>
        </div>
        <div className="bg-muted/30 rounded-lg p-4 text-sm whitespace-pre-wrap">
          {displayText || "(No content)"}
        </div>
        {showReply && (
          <div className="space-y-2 border-t pt-3">
            <Textarea
              data-testid="input-reply"
              placeholder="Write your reply..."
              rows={4}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowReply(false)}>Cancel</Button>
              <Button
                size="sm"
                className="gap-1"
                data-testid="button-send-reply"
                onClick={() => replyMutation.mutate()}
                disabled={!replyText || replyMutation.isPending}
              >
                <Send className="w-3 h-3" />
                {replyMutation.isPending ? "Sending..." : "Send Reply"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function EmailPage() {
  const { toast } = useToast();
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);

  const statusQuery = useQuery<EmailStatus>({
    queryKey: ["/api/email/status"],
  });

  const provisionMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email/inbox/provision"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/messages"] });
    },
    onError: (err: any) => toast({ description: err.message || "Failed to set up inbox", variant: "destructive" }),
  });

  useEffect(() => {
    if (statusQuery.data?.configured && !statusQuery.data?.inboxId && !provisionMutation.isPending) {
      provisionMutation.mutate();
    }
  }, [statusQuery.data?.configured, statusQuery.data?.inboxId]);

  const messagesQuery = useQuery<{ messages: EmailMessage[] }>({
    queryKey: ["/api/email/messages"],
    enabled: !!statusQuery.data?.inboxId,
  });

  const emailMessages = messagesQuery.data?.messages || [];
  const inboxEmail = statusQuery.data?.inbox;

  if (statusQuery.isError) {
    return <ErrorState title="Email Error" message="Failed to load email status." onRetry={() => statusQuery.refetch()} />;
  }

  if (!statusQuery.data?.configured) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-12 text-center">
              <Mail className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-40" />
              <h2 className="text-lg font-semibold mb-2">Email Coming Soon</h2>
              <p className="text-sm text-muted-foreground">
                The email service is being set up. Check back shortly.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (provisionMutation.isPending || (statusQuery.data?.configured && !statusQuery.data?.inboxId)) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-12 text-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">Setting Up Your Inbox</h2>
              <p className="text-sm text-muted-foreground">
                Creating your personal email address. This only takes a moment...
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (selectedMessage) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <MessageView
            message={selectedMessage}
            onBack={() => setSelectedMessage(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold" data-testid="text-email-title">Email</h1>
              {inboxEmail && (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground" data-testid="text-inbox-email">{inboxEmail}</p>
                  <CopyEmailButton email={inboxEmail} />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ComposeDialog onSent={() => messagesQuery.refetch()} />
            <Button
              variant="outline"
              size="sm"
              data-testid="button-refresh-email"
              onClick={() => messagesQuery.refetch()}
              className="gap-1"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        </div>

        {messagesQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
          </div>
        ) : emailMessages.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">Your inbox is empty</p>
              <p className="text-xs">
                Send an email using the Compose button, or share your address ({inboxEmail}) to receive messages.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="secondary">{emailMessages.length} messages</Badge>
            </div>
            {emailMessages.map((msg, i) => {
              const date = msg.createdAt || msg.created_at || "";
              const preview = msg.preview || msg.extractedText || msg.extracted_text || msg.text || "";
              return (
                <Card
                  key={i}
                  data-testid={`card-message-${i}`}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setSelectedMessage(msg)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{msg.subject || "(No Subject)"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {getFromDisplay(msg.from)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {preview.slice(0, 120)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[11px] text-muted-foreground">{formatDate(date)}</span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
