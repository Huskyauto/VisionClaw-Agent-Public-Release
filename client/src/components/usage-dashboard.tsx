import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Wrench, Users, ArrowUpRight, Zap, Crown, Key } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface UsageData {
  messagestoday: number;
  toolCallsToday: number;
  conversationsThisMonth: number;
  limits: {
    messagesPerDay: number;
    toolCallsPerDay: number;
    conversationsPerMonth: number;
    maxPersonas: number;
  };
  plan: string;
  byokActive?: boolean;
  effectivePlan?: string;
}

interface SubscriptionData {
  plan: string;
  effectivePlan?: string;
  byokActive?: boolean;
  limits: UsageData["limits"];
  trialMaxConversations: number;
  trialConversationsUsed: number;
}

const PLAN_COLORS: Record<string, string> = {
  trial: "bg-zinc-700 text-zinc-300",
  starter: "bg-blue-900/50 text-blue-300",
  pro: "bg-purple-900/50 text-purple-300",
  enterprise: "bg-amber-900/50 text-amber-300",
  admin: "bg-red-900/50 text-red-300",
};

const PLAN_PRICES: Record<string, string> = {
  trial: "Free",
  starter: "$29/mo",
  pro: "$99/mo",
  enterprise: "$299/mo",
  admin: "Admin",
};

function UsageBar({ label, icon: Icon, current, limit, color }: {
  label: string;
  icon: any;
  current: number;
  limit: number;
  color: string;
}) {
  const isUnlimited = limit === -1;
  const pct = isUnlimited ? 0 : Math.min((current / limit) * 100, 100);
  const isWarning = !isUnlimited && pct >= 80;
  const isDanger = !isUnlimited && pct >= 95;

  return (
    <div className="space-y-2" data-testid={`usage-bar-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </div>
        <span className={`font-mono text-xs ${isDanger ? "text-red-400" : isWarning ? "text-amber-400" : "text-foreground"}`}>
          {current.toLocaleString()} {isUnlimited ? "" : `/ ${limit.toLocaleString()}`}
          {isUnlimited && <span className="text-muted-foreground ml-1">unlimited</span>}
        </span>
      </div>
      {!isUnlimited && (
        <Progress
          value={pct}
          className={`h-2 ${isDanger ? "[&>div]:bg-red-500" : isWarning ? "[&>div]:bg-amber-500" : `[&>div]:${color}`}`}
        />
      )}
      {isUnlimited && (
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-full bg-gradient-to-r from-emerald-500/30 to-emerald-500/10 rounded-full" />
        </div>
      )}
    </div>
  );
}

export default function UsageDashboard() {
  const [, navigate] = useLocation();

  const { data: usage, isLoading: usageLoading } = useQuery<UsageData>({
    queryKey: ["/api/usage"],
  });

  const { data: subscription, isLoading: subLoading } = useQuery<SubscriptionData>({
    queryKey: ["/api/subscription"],
  });

  const isLoading = usageLoading || subLoading;
  const plan = usage?.plan || subscription?.plan || "trial";
  const byokActive = usage?.byokActive || subscription?.byokActive || false;
  const canUpgrade = plan === "trial" || plan === "starter" || plan === "pro";

  const handleUpgrade = async (targetPlan: string) => {
    try {
      const res = await apiRequest("POST", "/api/subscribe", { plan: targetPlan });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
    }
  };

  if (isLoading) {
    return (
      <Card className="border-border/50" data-testid="usage-dashboard-skeleton">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50" data-testid="usage-dashboard">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Usage & Plan
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {byokActive && (
              <Badge className="bg-emerald-900/50 text-emerald-300 border-0 text-xs" data-testid="badge-byok">
                <Key className="h-3 w-3 mr-1" /> BYOK
              </Badge>
            )}
            <Badge className={`${PLAN_COLORS[plan]} border-0 text-xs`} data-testid="badge-current-plan">
              {plan === "admin" ? (
                <><Crown className="h-3 w-3 mr-1" /> Admin</>
              ) : (
                <>{plan.charAt(0).toUpperCase() + plan.slice(1)} — {PLAN_PRICES[plan]}</>
              )}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {usage && (
          <>
            <UsageBar
              label="Messages today"
              icon={MessageSquare}
              current={usage.messagestoday}
              limit={usage.limits.messagesPerDay}
              color="bg-blue-500"
            />
            <UsageBar
              label="Tool calls today"
              icon={Wrench}
              current={usage.toolCallsToday}
              limit={usage.limits.toolCallsPerDay}
              color="bg-purple-500"
            />
            <UsageBar
              label="Conversations this month"
              icon={Users}
              current={usage.conversationsThisMonth}
              limit={usage.limits.conversationsPerMonth}
              color="bg-emerald-500"
            />
          </>
        )}

        {byokActive && (
          <div className="text-[11px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 border border-border/50" data-testid="text-byok-disclosure">
            <span className="font-medium text-foreground/70">BYOK Active:</span> Your enhanced limits are powered by your own API keys.
            Response quality and speed depend on your chosen provider — VisionClaw handles orchestration, tools, and memory.
          </div>
        )}

        {canUpgrade && (
          <div className="pt-2 flex gap-2">
            {plan === "trial" && (
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                onClick={() => handleUpgrade("starter")}
                data-testid="button-upgrade-starter"
              >
                <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
                Upgrade to Starter
              </Button>
            )}
            {(plan === "trial" || plan === "starter") && (
              <Button
                variant={plan === "trial" ? "outline" : "default"}
                size="sm"
                className="flex-1"
                onClick={() => handleUpgrade("pro")}
                data-testid="button-upgrade-pro"
              >
                <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
                {plan === "trial" ? "Go Pro" : "Upgrade to Pro"}
              </Button>
            )}
            {plan !== "enterprise" && plan !== "admin" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUpgrade("enterprise")}
                data-testid="button-upgrade-enterprise"
              >
                Enterprise
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
