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
import { HaltToggle } from "@/components/halt-toggle";
import { AuthProvider, useAuth } from "@/lib/auth";

import HomePage from "@/pages/home";
import ChatPage from "@/pages/chat";
import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import PricingPage from "@/pages/pricing";

const SettingsPage = lazy(() => import("@/pages/settings"));
const SkillsPage = lazy(() => import("@/pages/skills"));
const PersonasPage = lazy(() => import("@/pages/personas"));
const ClaudeImportPage = lazy(() => import("@/pages/claude-import"));
const MemoryPage = lazy(() => import("@/pages/memory"));
const HeartbeatPage = lazy(() => import("@/pages/heartbeat"));
const CodeHealthPage = lazy(() => import("@/pages/code-health"));
const KnowledgePage = lazy(() => import("@/pages/knowledge"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const PaymentsPage = lazy(() => import("@/pages/payments"));
const AdminServiceOrdersPage = lazy(() => import("@/pages/admin-service-orders"));
const AdminToolsPage = lazy(() => import("@/pages/admin-tools"));
const ProposedSkillsPage = lazy(() => import("@/pages/proposed-skills"));
const AbRunsPage = lazy(() => import("@/pages/ab-runs"));
const AdminEcosystemHealthPage = lazy(() => import("@/pages/admin-ecosystem-health"));
const AdminGoalLedgerPage = lazy(() => import("@/pages/admin-goal-ledger"));
const AdminZombieDetectorPage = lazy(() => import("@/pages/admin-zombie-detector"));
const AdminWedgesPage = lazy(() => import("@/pages/admin-wedges"));
const GalleryPage = lazy(() => import("@/pages/gallery"));
const TrustPage = lazy(() => import("@/pages/trust"));
const SkillsCatalogPage = lazy(() => import("@/pages/skills-catalog"));
const AuditPage = lazy(() => import("@/pages/audit"));
const ArchiveRescuePage = lazy(() => import("@/pages/archive-rescue"));
const AdminArchiveRescuePage = lazy(() => import("@/pages/admin/archive-rescue"));
const AdminPersonaCostPage = lazy(() => import("@/pages/admin-persona-cost"));
const AdminRepairLedgerPage = lazy(() => import("@/pages/admin-repair-ledger"));
const OperatorPage = lazy(() => import("@/pages/operator"));
const AnalyticsPage = lazy(() => import("@/pages/analytics"));
const EmailPage = lazy(() => import("@/pages/email"));
const WhatsAppPage = lazy(() => import("@/pages/whatsapp"));
const WhatsAppApprovalPage = lazy(() => import("@/pages/whatsapp-approval"));
const VaultPage = lazy(() => import("@/pages/vault"));
const ScheduledTasksPage = lazy(() => import("@/pages/scheduled-tasks"));
const SocialCalendarPage = lazy(() => import("@/pages/social-calendar"));
const McpKeysPage = lazy(() => import("@/pages/mcp-keys"));
const ProcedureEditsPage = lazy(() => import("@/pages/procedure-edits"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const JobsPage = lazy(() => import("@/pages/jobs"));
const FilesPage = lazy(() => import("@/pages/files"));
const ResearchPage = lazy(() => import("@/pages/research"));
const CodeProposalsPage = lazy(() => import("@/pages/code-proposals"));
const TreasuryPage = lazy(() => import("@/pages/treasury"));
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
const GraphExplorerPage = lazy(() => import("@/pages/graph-explorer"));
const InboxPage = lazy(() => import("@/pages/inbox"));
const ActivityPage = lazy(() => import("@/pages/activity"));
const AgentBoardPage = lazy(() => import("@/pages/agent-board"));
const AgentDiagramPage = lazy(() => import("@/pages/agent-diagram"));
const TeamPage = lazy(() => import("@/pages/team"));
const ApiKeysPage = lazy(() => import("@/pages/api-keys"));
const ComparePage = lazy(() => import("@/pages/compare"));
const ContentWritingPage = lazy(() => import("@/pages/content-writing"));
const SetupPage = lazy(() => import("@/pages/setup"));
const StorePage = lazy(() => import("@/pages/store"));
const OrderPage = lazy(() => import("@/pages/order"));

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
        {isAdmin && <Route path="/claude-import" component={ClaudeImportPage} />}
        <Route path="/projects" component={ProjectsPage} />
        <Route path="/jobs" component={JobsPage} />
        <Route path="/jobs/:jobId" component={JobsPage} />
        <Route path="/memory" component={MemoryPage} />
        {isAdmin && <Route path="/heartbeat" component={HeartbeatPage} />}
        {isAdmin && <Route path="/code-health" component={CodeHealthPage} />}
        {isAdmin && <Route path="/agentic" component={AgenticPage} />}
        {isAdmin && <Route path="/admin/service-orders" component={AdminServiceOrdersPage} />}
        {isAdmin && <Route path="/admin/tools" component={AdminToolsPage} />}
        {isAdmin && <Route path="/admin/proposed-skills" component={ProposedSkillsPage} />}
        {isAdmin && <Route path="/admin/ab-runs" component={AbRunsPage} />}
        {isAdmin && <Route path="/admin/ecosystem-health" component={AdminEcosystemHealthPage} />}
        {isAdmin && <Route path="/admin/goal-ledger" component={AdminGoalLedgerPage} />}
        {isAdmin && <Route path="/admin/zombie-detector" component={AdminZombieDetectorPage} />}
        {isAdmin && <Route path="/admin/wedges" component={AdminWedgesPage} />}
        {isAdmin && <Route path="/admin/persona-cost" component={AdminPersonaCostPage} />}
        {isAdmin && <Route path="/admin/repair-ledger" component={AdminRepairLedgerPage} />}
        {isAdmin && <Route path="/operator" component={OperatorPage} />}
        {isAdmin && <Route path="/code-proposals" component={CodeProposalsPage} />}
        {isAdmin && <Route path="/procedure-edits" component={ProcedureEditsPage} />}
        {isAdmin && <Route path="/graph-explorer" component={GraphExplorerPage} />}
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
        <Route path="/agent-diagram" component={AgentDiagramPage} />
        {isAdmin && <Route path="/team" component={TeamPage} />}
        {isAdmin && <Route path="/api-keys" component={ApiKeysPage} />}
        <Route path="/skills-marketplace" component={SkillsMarketplacePage} />
        <Route path="/personality-files" component={PersonalityFilesPage} />
        <Route path="/vault" component={VaultPage} />
        <Route path="/scheduled-tasks" component={ScheduledTasksPage} />
        <Route path="/social-calendar" component={SocialCalendarPage} />
        <Route path="/mcp-keys" component={McpKeysPage} />
        <Route path="/research" component={ResearchPage} />
        <Route path="/treasury" component={TreasuryPage} />
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
          <Route path="/gallery" component={GalleryPage} />
          <Route path="/trust" component={TrustPage} />
          <Route path="/skills" component={SkillsCatalogPage} />
          <Route path="/audit" component={AuditPage} />
          <Route path="/archive-rescue" component={ArchiveRescuePage} />
          <Route path="/present/:id" component={PresenterPage} />
          <Route path="/architecture" component={ArchitecturePage} />
          <Route path="/compare" component={ComparePage} />
        <Route path="/pricing" component={PricingPage} />
          <Route path="/store/success" component={StorePage} />
          <Route path="/store" component={StorePage} />
          <Route path="/orders/:sessionId" component={OrderPage} />
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
          <Route path="/gallery" component={GalleryPage} />
          <Route path="/trust" component={TrustPage} />
          <Route path="/skills" component={SkillsCatalogPage} />
          <Route path="/audit" component={AuditPage} />
          <Route path="/archive-rescue" component={ArchiveRescuePage} />
          <Route path="/present/:id" component={PresenterPage} />
          <Route path="/architecture" component={ArchitecturePage} />
          <Route path="/compare" component={ComparePage} />
        <Route path="/pricing" component={PricingPage} />
          <Route path="/store/success" component={StorePage} />
          <Route path="/store" component={StorePage} />
          <Route path="/orders/:sessionId" component={OrderPage} />
        <Route>
          {() => (
            <SidebarProvider>
              <div className="flex h-screen w-full bg-background overflow-hidden">
                <AppSidebar />
                <div className="flex flex-col flex-1 min-w-0">
                  <header className="flex items-center justify-between px-4 py-2 border-b border-border h-12 shrink-0 bg-background/95 backdrop-blur-sm sticky top-0 z-50">
                    <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground" />
                    <div className="flex items-center gap-2">
                      <HaltToggle />
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
        <Route path="/gallery" component={GalleryPage} />
        <Route path="/trust" component={TrustPage} />
        <Route path="/skills" component={SkillsCatalogPage} />
        <Route path="/audit" component={AuditPage} />
        <Route path="/archive-rescue" component={ArchiveRescuePage} />
        <Route path="/admin/archive-rescue" component={AdminArchiveRescuePage} />
        <Route path="/present/:id" component={PresenterPage} />
        <Route path="/architecture" component={ArchitecturePage} />
        <Route path="/compare" component={ComparePage} />
        <Route path="/pricing" component={PricingPage} />
        <Route path="/store/success" component={StorePage} />
        <Route path="/store" component={StorePage} />
        <Route path="/orders/:sessionId" component={OrderPage} />
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
                    <HaltToggle />
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
              <Route path="/public-chat/:token" component={PublicChatPage as any} />
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
