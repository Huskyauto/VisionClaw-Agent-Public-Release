import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BarChart3, PieChart as PieChartIcon, Clock, TrendingUp, MessageSquare, Wrench, Hash } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
} from "recharts";

interface Analytics {
  messagesPerDay: Record<string, { user: number; assistant: number }>;
  modelUsage: Record<string, number>;
  hourlyActivity: Record<number, number>;
  toolUsage: Record<string, number>;
  topTopics: { word: string; count: number }[];
  totalConversations: number;
  totalMessages: number;
  periodDays: number;
}

const CHART_COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

export default function AnalyticsPage() {
  const [, navigate] = useLocation();
  const analyticsQuery = useQuery<Analytics>({ queryKey: ["/api/analytics"] });
  const { data: analytics, isLoading } = analyticsQuery;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-80" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        </div>
      </div>
    );
  }

  if (analyticsQuery.isError) return <ErrorState title="Analytics Error" message="Failed to load analytics data. Please try again." onRetry={() => analyticsQuery.refetch()} />;

  if (!analytics) return null;

  const dailyData = Object.entries(analytics.messagesPerDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date: date.slice(5),
      user: counts.user,
      assistant: counts.assistant,
      total: counts.user + counts.assistant,
    }));

  const modelData = Object.entries(analytics.modelUsage)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name: name.length > 15 ? name.slice(0, 15) + "…" : name, value, fullName: name }));

  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}:00`,
    messages: analytics.hourlyActivity[h] || 0,
  }));

  const toolData = Object.entries(analytics.toolUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name: name.replace(/_/g, " "), count }));

  const avgPerDay = dailyData.length > 0
    ? Math.round(dailyData.reduce((s, d) => s + d.total, 0) / dailyData.length)
    : 0;

  const peakHour = hourlyData.reduce((max, h) => h.messages > max.messages ? h : max, hourlyData[0]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground" data-testid="text-analytics-title">Conversation Intelligence</h1>
            <p className="text-sm text-muted-foreground">Last {analytics.periodDays} days of activity</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { icon: MessageSquare, label: "Total Messages", value: analytics.totalMessages },
            { icon: TrendingUp, label: "Conversations", value: analytics.totalConversations },
            { icon: Clock, label: "Avg/Day", value: avgPerDay },
            { icon: Clock, label: "Peak Hour", value: peakHour?.hour || "—" },
          ].map(({ icon: Icon, label, value }) => (
            <Card key={label} data-testid={`card-analytics-${label.toLowerCase().replace(/\s/g, "-")}`}>
              <CardContent className="pt-4 pb-4 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <div className="text-2xl font-bold text-foreground">{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card data-testid="card-messages-chart">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Messages Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dailyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }} />
                  <Area type="monotone" dataKey="user" stackId="1" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} name="You" />
                  <Area type="monotone" dataKey="assistant" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="Assistant" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No message data yet</div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card data-testid="card-model-usage">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-primary" /> Model Usage
              </CardTitle>
            </CardHeader>
            <CardContent>
              {modelData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={modelData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {modelData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center text-muted-foreground text-sm">No model data yet</div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-hourly-activity">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" /> Activity by Hour
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }} />
                  <Bar dataKey="messages" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {toolData.length > 0 && (
            <Card data-testid="card-tool-usage">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-primary" /> Tool Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={toolData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {analytics.topTopics.length > 0 && (
            <Card data-testid="card-top-topics">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Hash className="w-4 h-4 text-primary" /> Top Topics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {analytics.topTopics.map((topic, i) => (
                    <Badge
                      key={topic.word}
                      variant={i < 5 ? "default" : "outline"}
                      className="text-xs"
                      data-testid={`badge-topic-${topic.word}`}
                    >
                      {topic.word}
                      <span className="ml-1 opacity-70">{topic.count}</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
