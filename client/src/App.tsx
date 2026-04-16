import { useEffect, Component, Suspense, lazy } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient, setAuthToken } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/lib/auth";

import HomePage from "@/pages/home";
import ChatPage from "@/pages/chat";
import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";

const SettingsPage = lazy(() => import("@/pages/settings"));
const SkillsPage = lazy(() => import("@/pages/skills"));
const PersonasPage = lazy(() => import("@/pages/personas"));
const MemoryPage = lazy(() => import("@/pages/memory"));
const HeartbeatPage = lazy(() => import("@/pages/heartbeat"));
const KnowledgePage = lazy(() => import("@/pages/knowledge"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const PaymentsPage = lazy(() => import("@/pages/payments"));
const AnalyticsPage = lazy(() => import("@/pages/analytics"));
const EmailPage = lazy(() => import("@/pages/email"));
const WhatsAppPage = lazy(() => import("@/pages/whatsapp"));
const WhatsAppApprovalPage = lazy(() => import("@/pages/whatsapp-approval"));
const VaultPage = lazy(() => import("@/pages/vault"));
const ScheduledTasksPage = lazy(() => import("@/pages/scheduled-tasks"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const FilesPage = lazy(() => import("@/pages/files"));
const ResearchPage = lazy(() => import("@/pages/research"));
const InsightsPage = lazy(() => import("@/pages/insights"));
const AgenticPage = lazy(() => import("@/pages/agentic"));
const AccountPage = lazy(() => import("@/pages/account"));
const UpdatesPage = lazy(() => import("@/pages/updates"));
const TelegramPage = lazy(() => import("@/pages/telegram"));
const McpPage = lazy(() => import("@/pages/mcp"));
const WebhookTriggersPage = lazy(() => import("@/pages/webhook-triggers"));
const ChannelRoutingPage = lazy(() => import("@/pages/channel-routing"));
const SkillsMarketplacePage = lazy(() => import("@/pages/skills-marketplace"));
const PersonalityFilesPage = lazy(() => import("@/pages/personality-files"));
const SignupPage = lazy(() => import("@/pages/signup"));
const TermsPage = lazy(() => import("@/pages/terms"));
const PrivacyPage = lazy(() => import("@/pages/privacy"));
const AboutPage = lazy(() => import("@/pages/about"));
const ContactPage = lazy(() => import("@/pages/contact"));
const RefundPage = lazy(() => import("@/pages/refund"));
const PublicChatPage = lazy(() => import("@/pages/public-chat"));
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password"));
const ResetPasswordPage = lazy(() => import("@/pages/reset-password"));
const PresenterPage = lazy(() => import("@/pages/presenter"));
const ArchitecturePage = lazy(() => import("@/pages/architecture"));
const InboxPage = lazy(() => import("@/pages/inbox"));
const ActivityPage = lazy(() => import("@/pages/activity"));
const AgentBoardPage = lazy(() => import("@/pages/agent-board"));
const TeamPage = lazy(() => import("@/pages/team"));
const ApiKeysPage = lazy(() => import("@/pages/api-keys"));
const ComparePage = lazy(() => import("@/pages/compare"));
const ContentWritingPage = lazy(() => import("@/pages/content-writing"));
const SetupPage = lazy(() => import("@/pages/setup"));

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, info);
    if (error?.message?.includes("Failed to fetch dynamically imported module") ||
        error?.message?.includes("Loading chunk") ||
        error?.message?.includes("Loading CSS chunk")) {
      const reloadKey = "vc_chunk_reload";
      const last = sessionStorage.getItem(reloadKey);
      if (!last || Date.now() - parseInt(last) > 30000) {
        sessionStorage.setItem(reloadKey, String(Date.now()));
        window.location.reload();
        return;
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md text-center space-y-4">
            <div className="text-5xl">🦞</div>
            <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. This has been logged and we'll look into it.
            </p>
            <p className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
              {this.state.error?.message || "Unknown error"}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                data-testid="button-error-retry"
              >
                Try Again
              </button>
              <button
                onClick={() => { window.location.href = "/"; }}
                className="px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80 transition-colors"
                data-testid="button-error-home"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function TrialBanner() {
  return null;
}

function PageLoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function PageRouter() {
  const { tenant } = useAuth();
  const isAdmin = tenant?.isAdmin ?? false;
  const isPaid = tenant ? tenant.plan !== "trial" : false;

  return (
    <Suspense fallback={<PageLoadingFallback />}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/chat/:id" component={ChatPage} />
        <Route path="/chat" component={ChatPage} />
        {isAdmin && <Route path="/settings" component={SettingsPage} />}
        <Route path="/skills" component={SkillsPage} />
        <Route path="/personas" component={PersonasPage} />
        <Route path="/projects" component={ProjectsPage} />
        <Route path="/memory" component={MemoryPage} />
        {isAdmin && <Route path="/heartbeat" component={HeartbeatPage} />}
        {isAdmin && <Route path="/agentic" component={AgenticPage} />}
        <Route path="/architecture" component={ArchitecturePage} />
        <Route path="/knowledge" component={KnowledgePage} />
        <Route path="/documents" component={DocumentsPage} />
        <Route path="/files" component={FilesPage} />
        {isAdmin && <Route path="/payments" component={PaymentsPage} />}
        <Route path="/analytics" component={AnalyticsPage} />
        <Route path="/email" component={EmailPage} />
        <Route path="/inbox" component={InboxPage} />
        {isAdmin && <Route path="/whatsapp" component={WhatsAppPage} />}
        <Route path="/whatsapp-approval" component={WhatsAppApprovalPage} />
        <Route path="/telegram" component={TelegramPage} />
        {isAdmin && <Route path="/mcp" component={McpPage} />}
        {isAdmin && <Route path="/webhook-triggers" component={WebhookTriggersPage} />}
        {isAdmin && <Route path="/channel-routing" component={ChannelRoutingPage} />}
        <Route path="/activity" component={ActivityPage} />
        <Route path="/agent-board" component={AgentBoardPage} />
        {isAdmin && <Route path="/team" component={TeamPage} />}
        {isAdmin && <Route path="/api-keys" component={ApiKeysPage} />}
        <Route path="/skills-marketplace" component={SkillsMarketplacePage} />
        <Route path="/personality-files" component={PersonalityFilesPage} />
        <Route path="/vault" component={VaultPage} />
        <Route path="/scheduled-tasks" component={ScheduledTasksPage} />
        <Route path="/research" component={ResearchPage} />
        <Route path="/insights" component={InsightsPage} />
        <Route path="/content-writing" component={ContentWritingPage} />
        <Route path="/account" component={AccountPage} />
        <Route path="/updates" component={UpdatesPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AuthGate() {
  const { token, authRequired, isChecking, tenant, isReplitAuth } = useAuth();
  const isAuthenticated = !!token || isReplitAuth;
  const [, navigate] = useLocation();

  const { data: setupStatus } = useQuery<{ needsSetup: boolean; isFreshDeploy: boolean }>({
    queryKey: ["/api/setup/status"],
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  useEffect(() => {
    const setupAllowedPaths = ["/setup", "/signup", "/login", "/terms", "/privacy"];
    if (setupStatus?.isFreshDeploy && !setupAllowedPaths.includes(window.location.pathname)) {
      navigate("/setup");
    }
  }, [setupStatus, navigate]);

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated && authRequired) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <Switch>
          <Route path="/login" component={LoginPage} />
          <Route path="/signup" component={SignupPage} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/setup" component={SetupPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/about" component={AboutPage} />
          <Route path="/contact" component={ContactPage} />
          <Route path="/refund" component={RefundPage} />
          <Route path="/present/:id" component={PresenterPage} />
          <Route path="/architecture" component={ArchitecturePage} />
          <Route path="/compare" component={ComparePage} />
          <Route component={LandingPage} />
        </Switch>
      </Suspense>
    );
  }

  if (!isAuthenticated && !authRequired) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <Switch>
          <Route path="/signup" component={SignupPage} />
          <Route path="/login" component={LoginPage} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/landing" component={LandingPage} />
          <Route path="/setup" component={SetupPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/about" component={AboutPage} />
          <Route path="/contact" component={ContactPage} />
          <Route path="/refund" component={RefundPage} />
          <Route path="/present/:id" component={PresenterPage} />
          <Route path="/architecture" component={ArchitecturePage} />
          <Route path="/compare" component={ComparePage} />
        <Route>
          {() => (
            <SidebarProvider>
              <div className="flex h-screen w-full bg-background overflow-hidden">
                <AppSidebar />
                <div className="flex flex-col flex-1 min-w-0">
                  <header className="flex items-center justify-between px-4 py-2 border-b border-border h-12 shrink-0 bg-background/95 backdrop-blur-sm sticky top-0 z-50">
                    <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground" />
                    <div className="flex items-center gap-2">
                      <ThemeToggle />
                    </div>
                  </header>
                  <main className="flex-1 overflow-hidden">
                    <PageRouter />
                  </main>
                </div>
              </div>
            </SidebarProvider>
          )}
        </Route>
      </Switch>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageLoadingFallback />}>
      <Switch>
        <Route path="/landing" component={LandingPage} />
        <Route path="/setup" component={SetupPage} />
        <Route path="/signup" component={SignupPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/about" component={AboutPage} />
        <Route path="/contact" component={ContactPage} />
        <Route path="/refund" component={RefundPage} />
        <Route path="/present/:id" component={PresenterPage} />
        <Route path="/architecture" component={ArchitecturePage} />
        <Route path="/compare" component={ComparePage} />
        <Route path="/login">
          <Redirect to="/" />
        </Route>
      <Route>
        {() => (
          <SidebarProvider>
            <div className="flex h-screen w-full bg-background overflow-hidden">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between px-4 py-2 border-b border-border h-12 shrink-0 bg-background/95 backdrop-blur-sm sticky top-0 z-50">
                  <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <ThemeToggle />
                  </div>
                </header>
                <TrialBanner />
                <main className="flex-1 overflow-hidden">
                  <PageRouter />
                </main>
              </div>
            </div>
          </SidebarProvider>
        )}
      </Route>
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeProvider>
            <Suspense fallback={<PageLoadingFallback />}>
            <Switch>
              <Route path="/public-chat/:token" component={PublicChatPage} />
              <Route path="/c/:slug">
                {() => <PublicChatPage mode="slug" />}
              </Route>
              <Route>
                {() => (
                  <AuthProvider>
                    <AuthGate />
                  </AuthProvider>
                )}
              </Route>
            </Switch>
            </Suspense>
            <Toaster />
          </ThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
