import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, MessageSquare, Settings, Zap, Trash2, Bot, Brain, Users, Heart, BookOpen, Search, X, CreditCard, BarChart3, Download, Loader2, Home, LogOut, LogIn, Mail, Inbox, FolderOpen, Library, Phone, KeyRound, CalendarClock, ChevronDown, Wrench, Shield, FlaskConical, Lightbulb, Radio, Rocket, Send, Activity, Key, Network, ArrowLeftRight, PenTool, ShoppingBag, Store, Package, TrendingUp, FileCode, FileCheck, Github, ShieldCheck, DollarSign, Clapperboard, Layers, Sparkles, Skull, Archive } from "lucide-react";
import { NotificationBell } from "@/components/notification-bell";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import type { Conversation } from "@shared/schema";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format, isToday, isYesterday, isThisWeek } from "date-fns";

function groupConversations(convs: Conversation[]) {
  const groups: Record<string, Conversation[]> = { Today: [], Yesterday: [], "This Week": [], Older: [] };
  for (const c of convs) {
    const d = new Date(c.updatedAt);
    if (isToday(d)) groups["Today"].push(c);
    else if (isYesterday(d)) groups["Yesterday"].push(c);
    else if (isThisWeek(d)) groups["This Week"].push(c);
    else groups["Older"].push(c);
  }
  return groups;
}

function useDebounce(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

type SearchResult = Conversation & { snippet?: string };

function NavSection({ title, icon: Icon, defaultOpen, children, accent, badge }: { title: string; icon: any; defaultOpen: boolean; children: React.ReactNode; accent?: boolean; badge?: string }) {
  const [userToggled, setUserToggled] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen && !userToggled) setOpen(true);
  }, [defaultOpen]);
  return (
    <div className="mt-1">
      <button
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 text-xs font-semibold transition-colors rounded-md",
          accent
            ? "text-primary hover:text-primary bg-primary/10 hover:bg-primary/15 ring-1 ring-primary/20"
            : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent font-medium"
        )}
        onClick={() => { setUserToggled(true); setOpen(!open); }}
        data-testid={`nav-section-${title.toLowerCase()}`}
      >
        <Icon className={cn("w-3.5 h-3.5", accent && "text-primary")} />
        <span className="flex-1 text-left tracking-wide">{title}</span>
        {badge && (
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-primary text-primary-foreground leading-none">
            {badge}
          </span>
        )}
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <SidebarMenu className="pl-2 mt-0.5">
          {children}
        </SidebarMenu>
      )}
    </div>
  );
}

function NavLink({ path, icon: Icon, label, badge, badgeClass }: { path: string; icon: any; label: string; badge?: string; badgeClass?: string }) {
  const [location] = useLocation();
  const { setOpenMobile } = useSidebar();
  const [, navigate] = useLocation();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={location === path}
        data-testid={`link-${path.slice(1)}`}
      >
        <a href={path} onClick={(e) => { e.preventDefault(); navigate(path); setOpenMobile(false); }}>
          <Icon className="w-4 h-4" />
          <span className="flex-1">{label}</span>
          {badge && (
            <span
              className={badgeClass ?? "ml-auto text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-primary/15 text-primary leading-none"}
              data-testid={`badge-nav-${path.slice(1)}`}
            >
              {badge}
            </span>
          )}
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const { setOpenMobile } = useSidebar();
  const { authRequired, logout, tenant, replitUser, isReplitAuth, refreshTenant, token } = useAuth();
  const isAdmin = tenant?.isAdmin ?? false;
  const isPaid = tenant ? tenant.plan !== "trial" : false;
  const [searchQuery, setSearchQuery] = useState("");
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const navigateTo = (path: string) => {
    navigate(path);
    setOpenMobile(false);
  };

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/inbox/unread-count"],
    refetchInterval: 30000,
    enabled: !!tenant,
  });
  const unreadCount = unreadData?.count || 0;

  const { data: setupStatus } = useQuery<{ checks: Record<string, boolean> }>({
    queryKey: ["/api/setup/status"],
    staleTime: 120_000,
  });
  const svcChecks = setupStatus?.checks || {};
  const hasEmail = svcChecks.email !== false;
  const hasTelegram = svcChecks.telegram !== false;
  const hasPayments = svcChecks.payments !== false;
  const hasVoice = svcChecks.voice !== false;

  const {
    data: convPages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/conversations", "infinite"],
    queryFn: async ({ pageParam = 0 }) => {
      const res = await apiRequest("GET", `/api/conversations?limit=50&offset=${pageParam}`);
      return res.json() as Promise<{ data: Conversation[]; total: number; hasMore: boolean }>;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage?.hasMore) return undefined;
      const loaded = allPages.reduce((sum, p) => sum + (p?.data?.length ?? 0), 0);
      return loaded;
    },
    initialPageParam: 0,
  });

  const conversations = useMemo(() => {
    if (!convPages?.pages) return [];
    return convPages.pages.flatMap(p => p?.data ?? []);
  }, [convPages]);

  const totalConversations = convPages?.pages[0]?.total ?? 0;

  const { data: searchResults } = useQuery<SearchResult[]>({
    queryKey: ["/api/search", debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch.trim()) return [];
      const res = await apiRequest("GET", `/api/search?q=${encodeURIComponent(debouncedSearch.trim())}`);
      return res.json();
    },
    enabled: debouncedSearch.trim().length >= 2,
  });

  const isSearching = debouncedSearch.trim().length >= 2;
  const displayedConversations = isSearching ? (searchResults || []) : conversations;

  const { data: settings } = useQuery<{ agentName: string }>({
    queryKey: ["/api/settings"],
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/conversations", { title: "New Chat" }),
    onSuccess: async (res) => {
      const conv = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      refreshTenant();
      navigateTo(`/chat/${conv.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/conversations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (location.startsWith("/chat/")) navigateTo("/");
      toast({ description: "Conversation deleted" });
    },
  });

  const groups = groupConversations(displayedConversations as Conversation[]);
  const activeId = location.startsWith("/chat/") ? location.split("/chat/")[1] : null;

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground text-base">🦞</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-sidebar-foreground truncate">
              {settings?.agentName || "VisionClaw Agent"}
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs text-muted-foreground">Online</span>
            </div>
          </div>
          <NotificationBell />
        </div>
        <Button
          size="sm"
          className="w-full"
          data-testid="button-new-chat"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          <Plus className="w-4 h-4 mr-1" />
          New Chat
        </Button>
        <div className="relative mt-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="h-8 pl-7 pr-7 text-xs"
            data-testid="input-search-conversations"
          />
          {searchQuery && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground"
              onClick={() => setSearchQuery("")}
              data-testid="button-clear-search"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {isSearching && searchResults && (
          <div className="text-xs text-muted-foreground mt-1 px-1" data-testid="text-search-count">
            {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isSearching && displayedConversations.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No results for "{debouncedSearch}"</p>
          </div>
        ) : !isSearching && conversations.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No conversations yet.</p>
            <p className="text-xs mt-1">Start a new chat above.</p>
          </div>
        ) : (
          <>
            {isSearching ? (
              <SidebarGroup>
                <SidebarGroupLabel className="text-xs text-muted-foreground px-3 py-1">
                  Search Results
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {(displayedConversations as SearchResult[]).map((conv) => (
                      <SidebarMenuItem key={conv.id}>
                        <div className="group flex items-center w-full">
                          <SidebarMenuButton
                            asChild
                            isActive={activeId === String(conv.id)}
                            data-testid={`link-conversation-${conv.id}`}
                          >
                            <a
                              href={`/chat/${conv.id}`}
                              onClick={(e) => { e.preventDefault(); navigateTo(`/chat/${conv.id}`); }}
                              className="flex-1 min-w-0"
                            >
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1">
                                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                                  <span className="truncate text-sm">{conv.title}</span>
                                </div>
                                {conv.snippet && (
                                  <span className="text-xs text-muted-foreground truncate mt-0.5 pl-4.5" data-testid={`text-snippet-${conv.id}`}>
                                    {conv.snippet}
                                  </span>
                                )}
                              </div>
                            </a>
                          </SidebarMenuButton>
                        </div>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : (
              Object.entries(groups).map(([label, convs]) =>
                convs.length > 0 ? (
                  <SidebarGroup key={label}>
                    <SidebarGroupLabel className="text-xs text-muted-foreground px-3 py-1">
                      {label}
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {convs.map((conv) => (
                          <SidebarMenuItem key={conv.id}>
                            <div className="group flex items-center w-full">
                              <SidebarMenuButton
                                asChild
                                isActive={activeId === String(conv.id)}
                                data-testid={`link-conversation-${conv.id}`}
                              >
                                <a
                                  href={`/chat/${conv.id}`}
                                  onClick={(e) => { e.preventDefault(); navigateTo(`/chat/${conv.id}`); }}
                                  className="flex-1 min-w-0"
                                >
                                  <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
                                  <span className="truncate text-sm">{conv.title}</span>
                                </a>
                              </SidebarMenuButton>
                              <button
                                className="ml-1 mr-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                                data-testid={`button-delete-conversation-${conv.id}`}
                                onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(conv.id); }}
                                aria-label={`Delete conversation ${conv.title}`}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                ) : null
              )
            )}
            {!isSearching && hasNextPage && (
              <div className="px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  data-testid="button-load-more-conversations"
                >
                  {isFetchingNextPage ? (
                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Loading...</>
                  ) : (
                    <>Load More ({conversations.length} of {totalConversations})</>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2 max-h-[40vh] overflow-y-auto">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/"}
              data-testid="link-home"
            >
              <a href="/" onClick={(e) => { e.preventDefault(); navigateTo("/"); }}>
                <Home className="w-4 h-4" />
                <span>Home</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/personas"}
              data-testid="link-personas"
            >
              <a href="/personas" onClick={(e) => { e.preventDefault(); navigateTo("/personas"); }}>
                <Users className="w-4 h-4" />
                <span>AI Team</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={location === "/claude-import"}
                data-testid="link-claude-import"
              >
                <a href="/claude-import" onClick={(e) => { e.preventDefault(); navigateTo("/claude-import"); }}>
                  <Github className="w-4 h-4" />
                  <span>Import Subagents</span>
                  <span className="ml-auto px-1.5 py-0.5 text-[9px] font-bold rounded-sm bg-primary text-primary-foreground leading-none shrink-0">R80</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/scheduled-tasks"}
              data-testid="link-scheduled-tasks"
            >
              <a href="/scheduled-tasks" onClick={(e) => { e.preventDefault(); navigateTo("/scheduled-tasks"); }}>
                <CalendarClock className="w-4 h-4" />
                <span>Automations</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/social-calendar"}
              data-testid="link-social-calendar"
            >
              <a href="/social-calendar" onClick={(e) => { e.preventDefault(); navigateTo("/social-calendar"); }}>
                <Send className="w-4 h-4" />
                <span>Social Calendar</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/mcp-keys"}
              data-testid="link-mcp-keys"
            >
              <a href="/mcp-keys" onClick={(e) => { e.preventDefault(); navigateTo("/mcp-keys"); }}>
                <Key className="w-4 h-4" />
                <span>MCP API Keys</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/procedure-edits"}
              data-testid="link-procedure-edits"
            >
              <a href="/procedure-edits" onClick={(e) => { e.preventDefault(); navigateTo("/procedure-edits"); }}>
                <FlaskConical className="w-4 h-4" />
                <span>Procedure Edits</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/research"}
              data-testid="link-research"
            >
              <a href="/research" onClick={(e) => { e.preventDefault(); navigateTo("/research"); }}>
                <FlaskConical className="w-4 h-4" />
                <span>Deep Research</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/treasury"}
              data-testid="link-treasury"
            >
              <a href="/treasury" onClick={(e) => { e.preventDefault(); navigateTo("/treasury"); }}>
                <TrendingUp className="w-4 h-4" />
                <span>Treasury</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/insights"}
              data-testid="link-insights"
            >
              <a href="/insights" onClick={(e) => { e.preventDefault(); navigateTo("/insights"); }}>
                <Lightbulb className="w-4 h-4" />
                <span>Agentic Intelligence</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/projects"}
              data-testid="link-projects"
            >
              <a href="/projects" onClick={(e) => { e.preventDefault(); navigateTo("/projects"); }}>
                <FolderOpen className="w-4 h-4" />
                <span>Projects</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/inbox"}
              data-testid="link-inbox"
            >
              <a href="/inbox" onClick={(e) => { e.preventDefault(); navigateTo("/inbox"); }}>
                <Inbox className="w-4 h-4" />
                <span>Inbox</span>
                {unreadCount > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold text-primary-foreground bg-primary rounded-full animate-pulse" data-testid="badge-sidebar-unread">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <NavSection title="Workspace" icon={Library} defaultOpen={["/memory", "/knowledge", "/documents", "/files", "/vault"].some(p => location === p)}>
          <NavLink path="/memory" icon={Brain} label="Memory" />
          <NavLink path="/knowledge" icon={BookOpen} label="Knowledge Base" />
          <NavLink path="/documents" icon={Library} label="Documents" />
          <NavLink path="/files" icon={FolderOpen} label="My Vault" />
          <NavLink path="/vault" icon={KeyRound} label="Saved Logins" />
          <NavLink path="/jobs" icon={Clapperboard} label="Video Jobs" />
        </NavSection>

        <NavSection title="Tools" icon={Wrench} defaultOpen={["/skills", "/skills-marketplace", "/personality-files", "/content-writing", "/analytics", "/email", "/whatsapp", "/whatsapp-approval", "/telegram", "/mcp", "/webhook-triggers", "/channel-routing"].some(p => location === p)}>
            <NavLink path="/skills" icon={Zap} label="Skills" />
            <NavLink path="/skills-marketplace" icon={Download} label="Skill Store" />
            <NavLink path="/content-writing" icon={PenTool} label="Content Writing" />
            <NavLink path="/personality-files" icon={Brain} label="Personality Files" />
            <NavLink path="/analytics" icon={BarChart3} label="Analytics" />
            {hasEmail && <NavLink path="/email" icon={Mail} label="Email" />}
            {isAdmin && hasEmail && <NavLink path="/whatsapp" icon={Phone} label="WhatsApp" />}
            {hasEmail && <NavLink path="/whatsapp-approval" icon={Phone} label="WhatsApp Approvals" />}
            {hasTelegram && <NavLink path="/telegram" icon={Send} label="Telegram" />}
            {isAdmin && <NavLink path="/mcp" icon={Radio} label="MCP Servers" />}
            {isAdmin && <NavLink path="/webhook-triggers" icon={Radio} label="Webhooks" />}
            {isAdmin && <NavLink path="/channel-routing" icon={Radio} label="Channel Routing" />}
          </NavSection>

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/updates"}
              data-testid="link-updates"
            >
              <a href="/updates" onClick={(e) => { e.preventDefault(); navigateTo("/updates"); }}>
                <Rocket className="w-4 h-4" />
                <span>What's New</span>
                <span className="ml-auto px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none" data-testid="badge-updates-new">
                  R125+65
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/account"}
              data-testid="link-account"
            >
              <a href="/account" onClick={(e) => { e.preventDefault(); navigateTo("/account"); }}>
                <Settings className="w-4 h-4" />
                <span>My Account</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <NavSection title="Shop" icon={ShoppingBag} defaultOpen={true} accent badge="NEW">
          <NavLink path="/store" icon={Store} label="Browse Products" />
          <NavLink path="/store?lookup=" icon={Inbox} label="My Orders" />
        </NavSection>

        <NavSection title="Organization" icon={Users} defaultOpen={["/team", "/api-keys", "/activity", "/agent-board"].some(p => location === p)}>
          <NavLink path="/agent-board" icon={Bot} label="Agent Board" />
          <NavLink path="/agent-diagram" icon={Network} label="Live Agent Diagram" />
          {isAdmin && <NavLink path="/team" icon={Users} label="Team" />}
          {isAdmin && <NavLink path="/api-keys" icon={Key} label="API Keys" />}
          <NavLink path="/activity" icon={Activity} label="Activity Log" />
        </NavSection>

        {isAdmin && (
          <NavSection title="Admin" icon={Shield} defaultOpen={["/heartbeat", "/agentic", "/payments", "/settings", "/compare", "/admin/service-orders", "/admin/tools", "/operator"].some(p => location === p)}>
            <NavLink path="/admin/service-orders" icon={Package} label="Service Orders" />
            <NavLink path="/admin/tools" icon={Wrench} label="Admin Tools" />
            <NavLink path="/operator" icon={Inbox} label="Operator Inbox" badge="New" />
            <NavLink path="/heartbeat" icon={Heart} label="Heartbeat Engine" />
            <NavLink path="/code-health" icon={Activity} label="Code Health" />
            <NavLink path="/code-proposals" icon={FileCode} label="Code Proposals" badge="New" />
            <NavLink path="/agentic" icon={Radio} label="Agentic Ops" />
            <NavLink path="/architecture" icon={Network} label="Architecture" />
            <NavLink path="/graph-explorer" icon={Network} label="GraphRAG Explorer" badge="R75" />
            <NavLink path="/admin/proposed-skills" icon={FileCheck} label="Proposed Skills" badge="R98.21" />
            <NavLink path="/admin/ab-runs" icon={BarChart3} label="A/B Runs" badge="R98.21" />
            <NavLink path="/admin/ecosystem-health" icon={Activity} label="Ecosystem Health" badge="R125+61" />
            <NavLink path="/admin/goal-ledger" icon={Activity} label="Goal Ledger" badge="R125+5" />
            <NavLink path="/admin/zombie-detector" icon={Skull} label="Zombie Detector" badge="R125+8.7" />
            <NavLink path="/admin/wedges" icon={Activity} label="Active Wedges" badge="NEW" />
            <NavLink path="/admin/archive-rescue" icon={Archive} label="Archive Rescue Queue" badge="NEW" />
            <NavLink path="/gallery" icon={FileCheck} label="Deliverable Gallery" badge="R125+6" />
            <NavLink path="/trust" icon={ShieldCheck} label="Trust Dashboard" badge="R125+6" />
            <NavLink path="/skills" icon={Sparkles} label="Skills Catalog" badge="R125+8.5" />
            <NavLink path="/admin/persona-cost" icon={DollarSign} label="Per-Agent Cost" badge="R98.26" />
            <NavLink path="/memory" icon={Layers} label="Unified Memory" badge="R122" />
            <NavLink path="/activity?filter=security" icon={ShieldCheck} label="Security Audit" badge="R125+65" badgeClass="ml-auto text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-rose-600 text-white leading-none" />
            <NavLink path="/compare" icon={ArrowLeftRight} label="Compare" />
            {hasPayments && <NavLink path="/payments" icon={CreditCard} label="Payments" />}
            <NavLink path="/settings" icon={Settings} label="Settings" />
          </NavSection>
        )}

        <SidebarMenu>
          {(replitUser || tenant) && (
            <SidebarMenuItem>
              <div className="flex items-center gap-2 px-2 py-1.5">
                {replitUser?.profileImageUrl ? (
                  <img
                    src={replitUser.profileImageUrl}
                    alt=""
                    className="w-6 h-6 rounded-full"
                    data-testid="img-user-avatar"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium">
                    {(replitUser?.firstName || tenant?.name || tenant?.email || "U")[0].toUpperCase()}
                  </div>
                )}
                <span className="text-sm truncate" data-testid="text-user-name">
                  {replitUser
                    ? [replitUser.firstName, replitUser.lastName].filter(Boolean).join(" ") || replitUser.email || "User"
                    : tenant?.name || tenant?.email || "User"}
                </span>
              </div>
            </SidebarMenuItem>
          )}
          {(tenant || replitUser || isReplitAuth || token) ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="button-logout"
                onClick={() => {
                  logout();
                  if (!isReplitAuth) navigate("/");
                }}
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="button-login"
                onClick={() => navigate("/login")}
              >
                <LogIn className="w-4 h-4" />
                <span>Log In</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {installPrompt && (
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="button-install-pwa"
                onClick={async () => {
                  installPrompt.prompt();
                  const result = await installPrompt.userChoice;
                  if (result.outcome === "accepted") setInstallPrompt(null);
                }}
              >
                <Download className="w-4 h-4" />
                <span>Install App</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
        <div className="px-2 pt-2">
          <a
            href="https://replit.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            data-testid="link-powered-by-replit"
          >
            <svg width="10" height="10" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 5.5C7 4.67157 7.67157 4 8.5 4H15.5C16.3284 4 17 4.67157 17 5.5V12H8.5C7.67157 12 7 11.3284 7 10.5V5.5Z" fill="currentColor" opacity="0.7"/>
              <path d="M17 12H25.5C26.3284 12 27 12.6716 27 13.5V18.5C27 19.3284 26.3284 20 25.5 20H17V12Z" fill="currentColor" opacity="0.85"/>
              <path d="M7 21.5C7 20.6716 7.67157 20 8.5 20H17V28H8.5C7.67157 28 7 27.3284 7 26.5V21.5Z" fill="currentColor"/>
            </svg>
            Built on Replit
          </a>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
