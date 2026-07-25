import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, X as XIcon, RefreshCw, Send } from "lucide-react";

const PLATFORMS = ["x", "linkedin", "instagram", "facebook", "threads", "pinterest", "youtube"] as const;
const VIDEO_REQUIRED_PLATFORMS = new Set(["youtube"]);
// R115.4 — Instagram + Pinterest are image-first publishers (server rejects
// at schedule time without an https imageUrl). Pre-validate in the UI so
// users fail fast.
const IMAGE_REQUIRED_PLATFORMS = new Set(["instagram", "pinterest"]);

interface ScheduledPost {
  id: number;
  platforms: string[];
  content: string;
  image_url: string | null;
  scheduled_for: string;
  status: "pending" | "publishing" | "sent" | "partial" | "failed" | "cancelled";
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  per_platform_results: Record<string, any>;
  campaign: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
    publishing: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    sent: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30",
    partial: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
    failed: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
    cancelled: "bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/30",
  };
  return (
    <Badge variant="outline" className={map[status] || ""} data-testid={`status-${status}`}>
      {status}
    </Badge>
  );
}

export default function SocialCalendarPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [campaign, setCampaign] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["x", "linkedin"]);

  const listKey = ["/api/scheduled-posts", statusFilter];
  const { data, isLoading, refetch } = useQuery<{ posts: ScheduledPost[] }>({
    queryKey: listKey,
    queryFn: async () => {
      const url = statusFilter === "all"
        ? "/api/scheduled-posts"
        : `/api/scheduled-posts?status=${encodeURIComponent(statusFilter)}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      if (selectedPlatforms.length === 0) throw new Error("Select at least one platform");
      if (!content.trim()) throw new Error("Content is required");
      if (!scheduledFor) throw new Error("Schedule time is required");
      const needsVideo = selectedPlatforms.some((p) => VIDEO_REQUIRED_PLATFORMS.has(p));
      if (needsVideo && !videoUrl.trim()) {
        throw new Error("videoUrl is required when YouTube is selected (Data API has no text-post endpoint).");
      }
      const needsImage = selectedPlatforms.filter((p) => IMAGE_REQUIRED_PLATFORMS.has(p));
      if (needsImage.length > 0 && !imageUrl.trim()) {
        throw new Error(`imageUrl is required when ${needsImage.join(" / ")} is selected (image-first platforms).`);
      }
      const iso = new Date(scheduledFor).toISOString();
      const res = await apiRequest("POST", "/api/scheduled-posts", {
        platforms: selectedPlatforms,
        content,
        scheduledFor: iso,
        imageUrl: imageUrl || undefined,
        videoUrl: videoUrl || undefined,
        campaign: campaign || undefined,
      });
      return res.json();
    },
    onSuccess: (d: any) => {
      toast({ title: "Scheduled", description: `Post ${d.id} scheduled for ${new Date(d.scheduledFor).toLocaleString()}` });
      setContent("");
      setImageUrl("");
      setVideoUrl("");
      setCampaign("");
      setScheduledFor("");
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-posts"] });
    },
    onError: (e: any) => toast({ title: "Schedule failed", description: e?.message || "unknown", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/scheduled-posts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-posts"] });
    },
    onError: (e: any) => toast({ title: "Cancel failed", description: e?.message || "unknown", variant: "destructive" }),
  });

  function togglePlatform(p: string) {
    setSelectedPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  const posts = data?.posts || [];

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CalendarClock className="w-7 h-7" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Social Calendar</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Schedule a cross-platform post</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {PLATFORMS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={selectedPlatforms.includes(p) ? "default" : "outline"}
                  onClick={() => togglePlatform(p)}
                  data-testid={`button-platform-${p}`}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="content">Content</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What do you want to say?"
              className="mt-1"
              rows={4}
              data-testid="input-content"
            />
            <p className="text-xs text-muted-foreground mt-1">{content.length} chars (X ≤280)</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="scheduled">Schedule for</Label>
              <Input
                id="scheduled"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="mt-1"
                data-testid="input-scheduled-for"
              />
            </div>
            <div>
              <Label htmlFor="image">Image URL (optional)</Label>
              <Input
                id="image"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1"
                data-testid="input-image-url"
              />
            </div>
            <div>
              <Label htmlFor="video">
                Video URL
                {selectedPlatforms.some((p) => VIDEO_REQUIRED_PLATFORMS.has(p)) ? (
                  <span className="text-red-500 ml-1">*</span>
                ) : (
                  <span className="text-muted-foreground ml-1">(YouTube only)</span>
                )}
              </Label>
              <Input
                id="video"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://...mp4"
                className="mt-1"
                data-testid="input-video-url"
              />
            </div>
            <div>
              <Label htmlFor="campaign">Campaign tag (optional)</Label>
              <Input
                id="campaign"
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder="launch-week"
                className="mt-1"
                data-testid="input-campaign"
              />
            </div>
          </div>
          <Button
            onClick={() => scheduleMutation.mutate()}
            disabled={scheduleMutation.isPending}
            data-testid="button-schedule"
          >
            <Send className="w-4 h-4 mr-2" />
            {scheduleMutation.isPending ? "Scheduling..." : "Schedule"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 mb-4">
        <Label>Filter</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="publishing">Publishing</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading...</p>}
      {!isLoading && posts.length === 0 && (
        <p className="text-muted-foreground" data-testid="text-empty">No scheduled posts yet.</p>
      )}

      <div className="space-y-3">
        {posts.map((post) => (
          <Card key={post.id} data-testid={`card-post-${post.id}`}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <StatusBadge status={post.status} />
                    {post.platforms.map((p) => (
                      <Badge key={p} variant="secondary" data-testid={`badge-platform-${post.id}-${p}`}>
                        {p}
                      </Badge>
                    ))}
                    {post.campaign && <Badge variant="outline">{post.campaign}</Badge>}
                    <span className="text-xs text-muted-foreground" data-testid={`text-scheduled-${post.id}`}>
                      {new Date(post.scheduled_for).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words" data-testid={`text-content-${post.id}`}>
                    {post.content}
                  </p>
                  {post.last_error && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-2" data-testid={`text-error-${post.id}`}>
                      Last error: {post.last_error}
                    </p>
                  )}
                  {post.attempts > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Attempts: {post.attempts} / {post.max_attempts}
                      {post.next_attempt_at && ` — next retry ${new Date(post.next_attempt_at).toLocaleString()}`}
                    </p>
                  )}
                  {Object.keys(post.per_platform_results || {}).length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Per-platform results</summary>
                      <pre className="mt-1 p-2 bg-muted rounded text-[10px] overflow-x-auto">
                        {JSON.stringify(post.per_platform_results, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
                {post.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelMutation.mutate(post.id)}
                    disabled={cancelMutation.isPending}
                    data-testid={`button-cancel-${post.id}`}
                  >
                    <XIcon className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
