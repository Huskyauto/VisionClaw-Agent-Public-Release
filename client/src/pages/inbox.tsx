import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Mail, MailOpen, Star, StarOff, Trash2, ArrowLeft,
  Inbox as InboxIcon, CheckCheck, RefreshCw, Filter, ChevronLeft, ChevronRight,
  Send
} from "lucide-react";
import { cn } from "@/lib/utils";
import DOMPurify from "dompurify";

interface InboxMessage {
  id: number;
  message_id: string;
  from_address: string;
  to_address: string;
  subject: string;
  preview: string;
  body_text?: string;
  body_html?: string;
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  thread_id?: string;
  direction?: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const hours = diff / (1000 * 60 * 60);
  if (hours < 1) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  if (hours < 48) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatSender(from: string): string {
  const match = from.match(/^(.+?)\s*<.+>$/);
  if (match) return match[1].trim();
  return from.split("@")[0] || from;
}

function formatRecipient(to: string): string {
  const match = to.match(/<(.+?)>/);
  if (match) return match[1].trim();
  return to;
}

export default function InboxPage() {
  const [, navigate] = useLocation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "starred">("all");
  const [page, setPage] = useState(1);
  const [mailbox, setMailbox] = useState<"inbox" | "sent">("inbox");

  const direction = mailbox === "sent" ? "outbound" : "inbound";

  const { data: listData, isLoading: listLoading, refetch } = useQuery<{
    messages: InboxMessage[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: [`/api/inbox?filter=${filter}&page=${page}&limit=20&direction=${direction}`],
    refetchInterval: 30000,
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/inbox/unread-count"],
    refetchInterval: 30000,
  });

  const { data: inboxInfo } = useQuery<{ email: string; inboxId: string; provisioned: boolean }>({
    queryKey: ["/api/inbox/info"],
  });

  const { data: selectedMessage, isLoading: messageLoading } = useQuery<InboxMessage>({
    queryKey: [`/api/inbox/${selectedId}`],
    enabled: !!selectedId,
  });

  const toggleReadMutation = useMutation({
    mutationFn: async ({ id, is_read }: { id: number; is_read: boolean }) => {
      await apiRequest("PATCH", `/api/inbox/${id}/read`, { is_read });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/inbox") });
    },
  });

  const toggleStarMutation = useMutation({
    mutationFn: async ({ id, is_starred }: { id: number; is_starred: boolean }) => {
      await apiRequest("PATCH", `/api/inbox/${id}/star`, { is_starred });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/inbox") });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/inbox/${id}`);
    },
    onSuccess: () => {
      setSelectedId(null);
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/inbox") });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/inbox/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/inbox") });
    },
  });

  const messages = listData?.messages || [];
  const unreadCount = unreadData?.count || 0;
  const isSent = mailbox === "sent";

  if (selectedId && selectedMessage) {
    return (
      <div className="flex flex-col h-full" data-testid="inbox-message-view">
        <div className="flex items-center gap-3 p-4 border-b border-border bg-background/95">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedId(null)}
            data-testid="button-back-to-inbox"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleStarMutation.mutate({
              id: selectedMessage.id,
              is_starred: !selectedMessage.is_starred
            })}
            data-testid="button-star-message"
          >
            {selectedMessage.is_starred
              ? <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
              : <StarOff className="w-4 h-4 text-muted-foreground" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => deleteMutation.mutate(selectedMessage.id)}
            data-testid="button-delete-message"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <h1 className="text-xl font-bold mb-2" data-testid="text-message-subject">
            {selectedMessage.subject}
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-6">
            <span data-testid="text-message-from">From: {selectedMessage.from_address}</span>
            <span data-testid="text-message-to">To: {selectedMessage.to_address}</span>
            <span className="text-xs">
              {new Date(selectedMessage.received_at).toLocaleString()}
            </span>
          </div>
          {messageLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-4 bg-muted rounded w-1/2" />
              <div className="h-4 bg-muted rounded w-2/3" />
            </div>
          ) : (
            <Card>
              <CardContent className="p-6">
                {selectedMessage.body_html ? (
                  <div
                    className="prose dark:prose-invert max-w-none text-sm"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedMessage.body_html) }}
                    data-testid="text-message-body"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm font-sans" data-testid="text-message-body">
                    {selectedMessage.body_text || "(No content)"}
                  </pre>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="inbox-page">
      <div className="flex items-center gap-3 p-4 border-b border-border bg-background/95">
        <div className="flex items-center gap-2">
          {isSent ? (
            <Send className="w-5 h-5 text-primary" />
          ) : (
            <Mail className="w-5 h-5 text-primary" />
          )}
          <div className="flex flex-col">
            <h1 className="text-lg font-bold" data-testid="text-inbox-title">
              {isSent ? "Sent" : "Inbox"}
            </h1>
            {inboxInfo?.email && (
              <span className="text-xs text-muted-foreground font-mono" data-testid="text-inbox-email">{inboxInfo.email}</span>
            )}
          </div>
          {!isSent && unreadCount > 0 && (
            <Badge variant="default" className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full" data-testid="badge-unread-count">
              {unreadCount} new
            </Badge>
          )}
        </div>
        <div className="flex-1" />

        <div className="flex items-center gap-1 border border-border rounded-lg p-0.5" data-testid="mailbox-tabs">
          <Button
            variant={mailbox === "inbox" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => { setMailbox("inbox"); setFilter("all"); setPage(1); setSelectedId(null); }}
            data-testid="button-tab-inbox"
          >
            <InboxIcon className="w-3.5 h-3.5 mr-1" />
            Inbox
          </Button>
          <Button
            variant={mailbox === "sent" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => { setMailbox("sent"); setFilter("all"); setPage(1); setSelectedId(null); }}
            data-testid="button-tab-sent"
          >
            <Send className="w-3.5 h-3.5 mr-1" />
            Sent
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-background/80">
        <Button
          variant={filter === "all" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => { setFilter("all"); setPage(1); }}
          data-testid="button-filter-all"
        >
          <Filter className="w-3.5 h-3.5 mr-1" />
          All
        </Button>
        {!isSent && (
          <Button
            variant={filter === "unread" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => { setFilter("unread"); setPage(1); }}
            data-testid="button-filter-unread"
          >
            <Mail className="w-3.5 h-3.5 mr-1" />
            Unread
          </Button>
        )}
        <Button
          variant={filter === "starred" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => { setFilter("starred"); setPage(1); }}
          data-testid="button-filter-starred"
        >
          <Star className="w-3.5 h-3.5 mr-1" />
          Starred
        </Button>
        <div className="flex-1" />
        {!isSent && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllReadMutation.mutate()}
            disabled={unreadCount === 0}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="w-3.5 h-3.5 mr-1" />
            Mark all read
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          data-testid="button-refresh-inbox"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {listLoading ? (
          <div className="space-y-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-4 border-b border-border animate-pulse">
                <div className="w-8 h-8 bg-muted rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground" data-testid="inbox-empty">
            {isSent ? (
              <Send className="w-12 h-12 mb-3 opacity-40" />
            ) : (
              <InboxIcon className="w-12 h-12 mb-3 opacity-40" />
            )}
            <p className="text-lg font-medium">
              {isSent
                ? "No sent emails yet"
                : filter === "all" ? "No emails yet" : filter === "unread" ? "All caught up!" : "No starred messages"}
            </p>
            <p className="text-sm mt-1">
              {isSent
                ? "Emails sent by the agent will appear here"
                : filter === "all"
                  ? "Incoming emails will appear here automatically"
                  : "Try a different filter"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-muted/50",
                  !isSent && !msg.is_read && "bg-primary/5"
                )}
                onClick={() => setSelectedId(msg.id)}
                data-testid={`inbox-message-${msg.id}`}
              >
                <div className="mt-1">
                  {isSent ? (
                    <Send className="w-4 h-4 text-muted-foreground" />
                  ) : msg.is_read ? (
                    <MailOpen className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <Mail className="w-4 h-4 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn(
                      "text-sm truncate",
                      !isSent && !msg.is_read && "font-semibold"
                    )} data-testid={`text-sender-${msg.id}`}>
                      {isSent ? `To: ${formatRecipient(msg.to_address)}` : formatSender(msg.from_address)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto flex-shrink-0" data-testid={`text-date-${msg.id}`}>
                      {formatDate(msg.received_at)}
                    </span>
                  </div>
                  <p className={cn(
                    "text-sm truncate",
                    !isSent && !msg.is_read ? "text-foreground" : "text-muted-foreground"
                  )} data-testid={`text-subject-${msg.id}`}>
                    {msg.subject}
                  </p>
                  {msg.preview && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid={`text-preview-${msg.id}`}>
                      {msg.preview}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    className="p-1 rounded hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStarMutation.mutate({ id: msg.id, is_starred: !msg.is_starred });
                    }}
                    data-testid={`button-star-${msg.id}`}
                  >
                    {msg.is_starred
                      ? <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                      : <Star className="w-3.5 h-3.5 text-muted-foreground/40" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(listData?.totalPages || 0) > 1 && (
        <div className="flex items-center justify-between p-3 border-t border-border bg-background/95">
          <span className="text-xs text-muted-foreground" data-testid="text-inbox-pagination">
            Page {page} of {listData?.totalPages} ({listData?.total} total)
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= (listData?.totalPages || 1)}
              onClick={() => setPage(p => p + 1)}
              data-testid="button-next-page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
