import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, X, Clock, Bot, Users, Zap, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";

interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  category: string;
  isRead: boolean;
  actionUrl: string | null;
  createdAt: string;
}

const TYPE_ICONS: Record<string, any> = {
  info: Info,
  success: Check,
  warning: AlertTriangle,
  error: X,
  agent: Bot,
  team: Users,
  task: Zap,
};

const TYPE_COLORS: Record<string, string> = {
  info: "text-blue-500",
  success: "text-emerald-500",
  warning: "text-amber-500",
  error: "text-red-500",
  agent: "text-violet-500",
  team: "text-cyan-500",
  task: "text-orange-500",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);

  const { data: countData } = useQuery<{ unread: number }>({
    queryKey: ["/api/notifications/count"],
    refetchInterval: 30000,
  });

  const { data: notifs = [] } = useQuery<NotificationItem[]>({
    queryKey: ["/api/notifications"],
    enabled: open,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/count"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/notifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/count"] });
    },
  });

  const unreadCount = countData?.unread ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" data-testid="button-notification-bell">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold bg-red-500 text-white rounded-full px-1" data-testid="text-unread-count">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0" sideOffset={8}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markAllReadMutation.mutate()}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-3 h-3 mr-1" /> Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[400px]">
          {notifs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div>
              {notifs.map((notif) => {
                const IconComp = TYPE_ICONS[notif.type] || Info;
                const colorClass = TYPE_COLORS[notif.type] || "text-muted-foreground";
                return (
                  <div
                    key={notif.id}
                    className={`flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-colors cursor-pointer hover:bg-accent/50 ${
                      !notif.isRead ? "bg-primary/5" : ""
                    }`}
                    onClick={() => {
                      if (!notif.isRead) markReadMutation.mutate(notif.id);
                      if (notif.actionUrl) window.location.href = notif.actionUrl;
                    }}
                    data-testid={`notif-item-${notif.id}`}
                  >
                    <div className={`mt-0.5 ${colorClass}`}>
                      <IconComp className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${!notif.isRead ? "font-semibold" : "font-medium"}`}>
                          {notif.title}
                        </span>
                        {!notif.isRead && (
                          <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                        )}
                      </div>
                      {notif.message && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                      )}
                      <div className="flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:opacity-100 flex-shrink-0"
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(notif.id); }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}