import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest, authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRef } from "react";
import { FolderOpen, Plus, FileText, MessageSquare, StickyNote, Search, ArrowLeft, Trash2, Tag, User, Clock, ChevronRight, PlayCircle, Upload, Image as ImageIcon, File, X, Loader2, Pencil, Check, Star, ExternalLink, Lightbulb } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Project {
  id: number;
  name: string;
  description: string;
  status: string;
  customer_name: string | null;
  customer_email: string | null;
  tags: string[];
  primary_conversation_id: number | null;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
  file_count: number;
  note_count: number;
  conversation_count: number;
  created_at: string;
  updated_at: string;
}

interface ProjectFile {
  id: number;
  file_name: string;
  file_type: string;
  file_size: number | null;
  file_path: string | null;
  file_url: string | null;
  uploaded_by: string | null;
  created_at: string;
}

interface ProjectNote {
  id: number;
  note: string;
  author: string;
  created_at: string;
}

interface ProjectConversation {
  conversation_id: number;
  title: string;
  created_at: string;
}

interface BwbWeightStatus {
  currentWeight: number | null;
  totalLost: number | null;
  startWeight: number | null;
  updatedAt: string | null;
  daysSinceUpdate: number | null;
  staleThisWeek: boolean;
  hasWeight: boolean;
}

interface FrontierRevenueConceptSummary {
  id: string;
  title: string;
  targetBuyer: string;
  paidOffer: string;
  buildDelta: string;
  scores: {
    novelty: number;
    buyerPain: number;
    willingnessToPay: number;
    buildEffort: number;
    timeToProof: number;
    evidenceQuality: number;
    operationalRisk: number;
  };
  noveltyStatus: "new";
  humanReviewState: "needs_review";
  createdAt: string;
  sourceRunCount: number;
}

interface FrontierRevenueConceptDetail extends FrontierRevenueConceptSummary {
  candidate: {
    painfulJob: string;
    proofExperiment: string;
    priceCostModel: string;
    evidencePlan: string;
    operationalRisks: string;
    killCriterion: string;
  };
  sourceRunIds: string[];
  briefMarkdown: string;
  urls: {
    concept: string;
    brief: string;
    sourceRun: string;
  };
}

interface FrontierRevenueJuryRunSummary {
  id: string;
  title: string;
  createdAt: string;
  status: "complete" | "partial" | "failed";
  aggregatorModel: string;
  concordance: number | null;
  shouldEscalate: boolean;
  proposerCount: number;
  successfulProposers: number;
}

interface FrontierRevenueJuryRunDetail extends FrontierRevenueJuryRunSummary {
  prompt: string;
  aggregated: string;
  proposers: Array<{
    modelId: string;
    providerLane: string | null;
    provider: string | null;
    ok: boolean;
    error: string | null;
  }>;
  sourceUrl: string;
}

const statusColors: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  paused: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  completed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  archived: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export default function ProjectsPage() {
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [frontierFolderOpen, setFrontierFolderOpen] = useState(false);
  const [selectedFrontierConceptId, setSelectedFrontierConceptId] = useState<string | null>(null);
  const [frontierResearchFolderOpen, setFrontierResearchFolderOpen] = useState(false);
  const [selectedFrontierJuryRunId, setSelectedFrontierJuryRunId] = useState<string | null>(null);
  const [openingFrontierFile, setOpeningFrontierFile] = useState<string | null>(null);
  const [location, navigate] = useLocation();
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("id");
      if (id) {
        const parsed = parseInt(id);
        if (!isNaN(parsed)) setSelectedProject(parsed);
      }
    } catch {}
  }, [location]);
  const { tenant } = useAuth();
  const isAdmin = tenant?.isAdmin ?? false;
  const [searchQuery, setSearchQuery] = useState("");
  const [ideaFolderOpen, setIdeaFolderOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({ name: "", description: "", customerName: "", customerEmail: "", tags: "" });
  const [newNote, setNewNote] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });
  const { data: frontierConcepts = [], isLoading: isFrontierConceptsLoading } = useQuery<FrontierRevenueConceptSummary[]>({
    queryKey: ["/api/frontier-revenue/discoveries"],
    enabled: isAdmin,
  });
  const { data: frontierConcept, isLoading: isFrontierConceptLoading, error: frontierConceptError } = useQuery<FrontierRevenueConceptDetail>({
    queryKey: [`/api/frontier-revenue/discoveries/${selectedFrontierConceptId || "none"}`],
    enabled: isAdmin && !!selectedFrontierConceptId,
  });
  const { data: frontierJuryRuns = [], isLoading: isFrontierJuryRunsLoading } = useQuery<FrontierRevenueJuryRunSummary[]>({
    queryKey: ["/api/frontier-revenue/runs"],
    enabled: isAdmin,
  });
  const { data: frontierJuryRun, isLoading: isFrontierJuryRunLoading, error: frontierJuryRunError } = useQuery<FrontierRevenueJuryRunDetail>({
    queryKey: [`/api/frontier-revenue/runs/${selectedFrontierJuryRunId || "none"}`],
    enabled: isAdmin && !!selectedFrontierJuryRunId,
  });

  const { data: projectDetail, isLoading: isDetailLoading, error: detailError } = useQuery<{
    project: Project;
    files: ProjectFile[];
    notes: ProjectNote[];
    conversations: ProjectConversation[];
  }>({
    queryKey: ["/api/projects", selectedProject],
    enabled: !!selectedProject,
    retry: 1,
  });

  const { data: driveFolder } = useQuery<{ rootUrl: string; subfolderUrl?: string; subfolderName?: string }>({
    queryKey: ["/api/gdrive/folder"],
    enabled: !!selectedProject,
  });

  const { data: bwbWeight } = useQuery<BwbWeightStatus>({
    queryKey: ["/api/bwb/weight"],
    enabled: selectedProject === 16,
  });

  const [weightForm, setWeightForm] = useState({ currentWeight: "", totalLost: "", startWeight: "" });
  const weightMutation = useMutation({
    mutationFn: (data: { currentWeight?: number; totalLost?: number; startWeight?: number }) =>
      apiRequest("POST", "/api/bwb/weight", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bwb/weight"] });
      setWeightForm({ currentWeight: "", totalLost: "", startWeight: "" });
      toast({ title: "Weigh-in logged", description: "Saved — no video build was triggered." });
    },
    onError: (e: any) => toast({ title: "Could not save weight", description: e?.message || "Try again.", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/projects", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowCreate(false);
      setNewProject({ name: "", description: "", customerName: "", customerEmail: "", tags: "" });
      toast({ title: "Project created" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create project", description: err.message || "Please try again", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setSelectedProject(null);
      toast({ title: "Project deleted" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/projects/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      if (selectedProject) queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProject] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiRequest("PATCH", `/api/projects/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      if (selectedProject) queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProject] });
      setEditingName(false);
      toast({ title: "Project renamed" });
    },
    onError: () => {
      toast({ title: "Failed to rename", variant: "destructive" });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      apiRequest("POST", `/api/projects/${id}/notes`, { note, author: "user" }),
    onSuccess: () => {
      if (selectedProject) queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProject] });
      setNewNote("");
      toast({ title: "Note added" });
    },
  });

  const startProjectChat = async (projectId: number, projectName: string) => {
    try {
      const existingRes = await apiRequest("GET", `/api/projects/${projectId}`);
      const projectData = await existingRes.json();
      const project = projectData.project || projectData;
      const convs = projectData.conversations || [];
      const convIds = new Set(convs.map((c: any) => c.conversation_id || c.id));
      if (project.primary_conversation_id && convIds.has(project.primary_conversation_id)) {
        navigate(`/chat/${project.primary_conversation_id}`);
        return;
      }
      if (project.primary_conversation_id) {
        navigate(`/chat/${project.primary_conversation_id}`);
        return;
      }
      if (convs.length > 0) {
        const sorted = [...convs].sort((a: any, b: any) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
        const latestId = sorted[0].conversation_id || sorted[0].id;
        navigate(`/chat/${latestId}`);
        return;
      }
      const res = await apiRequest("POST", "/api/conversations", {
        title: `${projectName}`,
        projectId,
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      navigate(`/chat/${data.id}`);
    } catch {
      toast({ title: "Failed to create chat", variant: "destructive" });
    }
  };

  const handleFileUpload = async (projectId: number, files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const MAX_SIZE = 50 * 1024 * 1024;
    const oversized = fileArray.filter(f => f.size > MAX_SIZE);
    if (oversized.length > 0) {
      toast({ title: `${oversized.map(f => f.name).join(", ")} exceeds 50 MB limit`, variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setUploadProgress({ current: 0, total: fileArray.length, fileName: fileArray[0].name });
    try {
      const formData = new FormData();
      for (const file of fileArray) {
        formData.append("files", file);
      }
      const res = await authFetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Upload failed");
      }
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: `${data.uploaded} file(s) uploaded to project` });
    } catch (err: any) {
      toast({ title: err.message || "Upload failed", variant: "destructive" });
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent, projectId: number) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      handleFileUpload(projectId, droppedFiles);
    }
  };

  const deleteFileMutation = useMutation({
    mutationFn: ({ projectId, fileId }: { projectId: number; fileId: number }) =>
      apiRequest("DELETE", `/api/projects/${projectId}/files/${fileId}`),
    onSuccess: () => {
      if (selectedProject) queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProject] });
      toast({ title: "File removed" });
    },
  });

  const filtered = projects.filter((p) => {
    const matchesSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // IdeaBrowser virtual folder: group all ideabrowser/isenberg-tagged projects
  // under one folder card so they don't flood the main filing cabinet.
  const isIdeaProject = (p: Project) =>
    (p.tags || []).some((t) => ["ideabrowser", "isenberg", "isenberg-iotd", "iotd", "idea-stage", "ideabrowser-weekly-run", "ideabrowser-master-run"].includes(t));
  const isRunProject = (p: Project) =>
    (p.tags || []).some((t) => ["ideabrowser-weekly-run", "ideabrowser-master-run"].includes(t));
  const isWedgeProject = (p: Project) =>
    (p.tags || []).some((t) => t === "wedge" || t.startsWith("wedge:"));
  const ideaProjects = filtered.filter(isIdeaProject);
  const weeklyRuns = ideaProjects
    .filter(isRunProject)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const wedgeEntries = ideaProjects
    .filter((p) => !isRunProject(p) && isWedgeProject(p))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const ideaEntries = ideaProjects
    .filter((p) => !isRunProject(p) && !isWedgeProject(p))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  // While searching, show everything flat (so search still finds ideas directly).
  const groupIdeas = !searchQuery && ideaProjects.length > 0;
  const mainList = groupIdeas ? filtered.filter((p) => !isIdeaProject(p)) : filtered;
  const visibleFrontierConcepts = frontierConcepts.filter((concept) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return [concept.title, concept.targetBuyer, concept.paidOffer, concept.buildDelta]
      .some((value) => value.toLowerCase().includes(query));
  });
  const showFrontierFolder = isAdmin && statusFilter === "all" && !searchQuery && frontierConcepts.length > 0;
  const showFrontierResearchFolder = isAdmin && statusFilter === "all" && !searchQuery && frontierJuryRuns.length > 0;

  // On-demand IdeaBrowser money-scenario run (Bob 2026-07-21). Queues the
  // existing heartbeat maintenance task (next_run_at=now) — the heartbeat's
  // normal machinery does the actual run, so a "queued" state can persist for
  // ~a minute before it flips to running/finished.
  interface ScenarioStatus {
    taskId: number; enabled: boolean; lastRunAt: string | null; nextRunAt: string | null;
    queued: boolean; lastRunStatus: string | null; lastRunFinishedAt: string | null;
  }
  const { data: scenarioStatus } = useQuery<ScenarioStatus>({
    queryKey: ["/api/ideabrowser/scenario/status"],
    // Admin-only endpoints — don't poll (and 401 every 20s) for non-admin users.
    enabled: ideaFolderOpen && isAdmin,
    refetchInterval: ideaFolderOpen && isAdmin ? 20_000 : false,
  });
  const runScenarioMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ideabrowser/scenario/run-now");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.alreadyQueued ? "Already queued" : "Refresh queued",
        description: data.message || "The money-scenario pass will start within a minute; a new run card appears here when it finishes (typically 5–15 min).",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ideabrowser/scenario/status"] });
    },
    onError: (e: any) => {
      toast({ title: "Could not queue run", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });

  const openFrontierFile = async (url: string, fileLabel: string) => {
    setOpeningFrontierFile(fileLabel);
    const previewWindow = window.open("", "_blank");
    try {
      const response = await authFetch(url);
      if (!response.ok) throw new Error(`Could not load ${fileLabel.toLowerCase()} (${response.status})`);
      const blobUrl = URL.createObjectURL(await response.blob());
      if (!previewWindow) {
        URL.revokeObjectURL(blobUrl);
        toast({ title: "Couldn't open preview", description: "Allow popups and try again.", variant: "destructive" });
        return;
      }
      previewWindow.opener = null;
      previewWindow.location.replace(blobUrl);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error: any) {
      previewWindow?.close();
      toast({ title: `Couldn't open ${fileLabel}`, description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setOpeningFrontierFile(null);
    }
  };

  if (selectedFrontierJuryRunId) {
    if (isFrontierJuryRunLoading) {
      return (
        <div className="h-full flex items-center justify-center p-6" data-testid="frontier-jury-run-detail-loading">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading jury research…
          </div>
        </div>
      );
    }
    if (frontierJuryRunError || !frontierJuryRun) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 gap-3" data-testid="frontier-jury-run-detail-error">
          <p className="text-destructive">Couldn't load this frontier jury research.</p>
          <p className="text-xs text-muted-foreground">{(frontierJuryRunError as any)?.message || "The saved run may no longer be available."}</p>
          <Button variant="outline" size="sm" onClick={() => setSelectedFrontierJuryRunId(null)} data-testid="button-back-frontier-jury-error">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to jury research
          </Button>
        </div>
      );
    }
    const statusLabel = frontierJuryRun.status === "complete" ? "Complete" : frontierJuryRun.status === "partial" ? "Partial" : "Failed";
    const statusClass = frontierJuryRun.status === "complete"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : frontierJuryRun.status === "partial"
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : "bg-destructive/15 text-destructive border-destructive/30";
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6" data-testid="frontier-jury-run-detail">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedFrontierJuryRunId(null)} data-testid="button-back-frontier-jury-run">
            <ArrowLeft className="w-4 h-4 mr-1" /> Frontier Jury Research
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{frontierJuryRun.title}</h1>
              <Badge className={statusClass}>{statusLabel}</Badge>
              <Badge variant="outline">Research only</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Saved {new Date(frontierJuryRun.createdAt).toLocaleString()} · {frontierJuryRun.successfulProposers}/{frontierJuryRun.proposerCount} jury lanes completed</p>
          </div>
        </div>

        <Card className="border-primary/25">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Lightbulb className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <h2 className="font-semibold">Research stays a human decision</h2>
                <p className="text-sm text-muted-foreground mt-1">This preserves the jury’s monetization research for review. It does not create a feature, Revenue Mission, outreach, payment, or customer record.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => openFrontierFile(frontierJuryRun.sourceUrl, "source jury run")} disabled={!!openingFrontierFile} data-testid="button-frontier-jury-source">
              {openingFrontierFile === "source jury run" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-1" />} Open source jury run
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Synthesis</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{frontierJuryRun.aggregatorModel}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">Concordance</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{frontierJuryRun.concordance === null ? "Not recorded" : `${Math.round(frontierJuryRun.concordance * 100)}%`}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">Review signal</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{frontierJuryRun.shouldEscalate ? "Escalation recommended" : "No escalation signal"}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-lg">Jury report</CardTitle></CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-foreground/90" data-testid="text-frontier-jury-report">{frontierJuryRun.aggregated || "No synthesized report was recorded for this run."}</pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedFrontierConceptId) {
    if (isFrontierConceptLoading) {
      return (
        <div className="h-full flex items-center justify-center p-6" data-testid="frontier-concept-detail-loading">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading concept…
          </div>
        </div>
      );
    }
    if (frontierConceptError || !frontierConcept) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 gap-3" data-testid="frontier-concept-detail-error">
          <p className="text-destructive">Couldn't load this frontier concept.</p>
          <p className="text-xs text-muted-foreground">{(frontierConceptError as any)?.message || "The concept may no longer be available."}</p>
          <Button variant="outline" size="sm" onClick={() => setSelectedFrontierConceptId(null)} data-testid="button-back-frontier-error">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to frontier concepts
          </Button>
        </div>
      );
    }
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6" data-testid="frontier-concept-detail">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedFrontierConceptId(null)} data-testid="button-back-frontier-concept">
            <ArrowLeft className="w-4 h-4 mr-1" /> Frontier Concepts
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{frontierConcept.title}</h1>
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">New concept</Badge>
              <Badge variant="outline">Human review required</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Saved {new Date(frontierConcept.createdAt).toLocaleString()} · seen in {frontierConcept.sourceRunCount} jury run{frontierConcept.sourceRunCount === 1 ? "" : "s"}</p>
          </div>
        </div>

        <Card className="border-primary/25">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Lightbulb className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <h2 className="font-semibold">Build-next decision stays with you</h2>
                <p className="text-sm text-muted-foreground mt-1">This is jury research, not an active product. Opening it does not create a feature contract, Revenue Mission, outreach, payment, or customer record.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => openFrontierFile(frontierConcept.urls.brief, "brief file")} disabled={!!openingFrontierFile} data-testid="button-frontier-brief">
                {openingFrontierFile === "brief file" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />} Open brief file
              </Button>
              <Button variant="outline" size="sm" onClick={() => openFrontierFile(frontierConcept.urls.concept, "concept JSON")} disabled={!!openingFrontierFile} data-testid="button-frontier-concept-json">
                {openingFrontierFile === "concept JSON" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <File className="w-4 h-4 mr-1" />} Concept JSON
              </Button>
              <Button variant="outline" size="sm" onClick={() => openFrontierFile(frontierConcept.urls.sourceRun, "source jury run")} disabled={!!openingFrontierFile} data-testid="button-frontier-source-run">
                {openingFrontierFile === "source jury run" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-1" />} Source jury run
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-lg">Opportunity snapshot</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Target buyer</p><p className="mt-1">{frontierConcept.targetBuyer}</p></div>
              <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Paid offer</p><p className="mt-1">{frontierConcept.paidOffer}</p></div>
              <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Painful job</p><p className="mt-1">{frontierConcept.candidate.painfulJob}</p></div>
              <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Smallest build delta</p><p className="mt-1">{frontierConcept.buildDelta}</p></div>
              <div><p className="text-xs text-muted-foreground uppercase tracking-wide">30-day proof</p><p className="mt-1">{frontierConcept.candidate.proofExperiment}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">Jury scores</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Novelty <span className="float-right font-semibold">{frontierConcept.scores.novelty}</span></p>
              <p>Buyer pain <span className="float-right font-semibold">{frontierConcept.scores.buyerPain}</span></p>
              <p>Willingness to pay <span className="float-right font-semibold">{frontierConcept.scores.willingnessToPay}</span></p>
              <p>Build effort <span className="float-right font-semibold">{frontierConcept.scores.buildEffort}</span></p>
              <p>Time to proof <span className="float-right font-semibold">{frontierConcept.scores.timeToProof}</span></p>
              <p>Evidence quality <span className="float-right font-semibold">{frontierConcept.scores.evidenceQuality}</span></p>
              <p>Operational risk <span className="float-right font-semibold">{frontierConcept.scores.operationalRisk}</span></p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-lg">Saved jury brief</CardTitle></CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-foreground/90" data-testid="text-frontier-brief">{frontierConcept.briefMarkdown}</pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedProject && (isDetailLoading || detailError || projectDetail)) {
    if (isDetailLoading) {
      return (
        <div className="h-full flex items-center justify-center p-6" data-testid="project-detail-loading">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading project…
          </div>
        </div>
      );
    }
    if (detailError || !projectDetail) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 gap-3" data-testid="project-detail-error">
          <p className="text-destructive">Couldn't load this project.</p>
          <p className="text-xs text-muted-foreground">{(detailError as any)?.message || "Unknown error"}</p>
          <Button variant="outline" size="sm" onClick={() => setSelectedProject(null)} data-testid="button-back-error">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to projects
          </Button>
        </div>
      );
    }
    const { project, files, notes, conversations } = projectDetail;
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6" data-testid="project-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedProject(null); setEditingName(false); }} data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                className="text-lg font-bold h-9 w-64"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editNameValue.trim() && !renameMutation.isPending) {
                    renameMutation.mutate({ id: project.id, name: editNameValue.trim() });
                  }
                  if (e.key === "Escape") setEditingName(false);
                }}
                data-testid="input-rename-project"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (editNameValue.trim()) renameMutation.mutate({ id: project.id, name: editNameValue.trim() });
                }}
                disabled={renameMutation.isPending}
                data-testid="button-save-rename"
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingName(false)} data-testid="button-cancel-rename">
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-2xl font-bold" data-testid="text-project-name">{project.name}</h1>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => { setEditNameValue(project.name); setEditingName(true); }}
                data-testid="button-rename-project"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          <Badge className={statusColors[project.status]}>{project.status}</Badge>
          <Select value={project.status} onValueChange={(v) => updateStatusMutation.mutate({ id: project.id, status: v })}>
            <SelectTrigger className="w-32" data-testid="select-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-2">
            <Button onClick={() => startProjectChat(project.id, project.name)} data-testid="button-continue-working">
              <PlayCircle className="w-4 h-4 mr-1" /> Continue Working
            </Button>
            <Button variant="outline" onClick={async () => {
              try {
                const res = await apiRequest("POST", "/api/conversations", { title: project.name, projectId: project.id });
                const data = await res.json();
                queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
                queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] });
                navigate(`/chat/${data.id}`);
              } catch { toast({ title: "Failed to create chat", variant: "destructive" }); }
            }} data-testid="button-new-project-chat">
              <Plus className="w-4 h-4 mr-1" /> New Thread
            </Button>
            {(project.drive_folder_url || driveFolder?.rootUrl) && (
              <a
                href={project.drive_folder_url || driveFolder?.rootUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-drive-folder"
              >
                <Button variant="outline" size="default">
                  <FolderOpen className="w-4 h-4 mr-1" /> Project Files <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
              </a>
            )}
          </div>
        </div>

        {project.customer_name && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <User className="w-4 h-4" />
            <span data-testid="text-customer">{project.customer_name}</span>
            {project.customer_email && <span className="text-sm">({project.customer_email})</span>}
          </div>
        )}
        {project.description && <p className="text-muted-foreground" data-testid="text-description">{project.description}</p>}

        {project.id === 16 && (
          <Card data-testid="card-bwb-weight" className={bwbWeight?.staleThisWeek ? "border-yellow-500/40" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Star className="w-5 h-5" /> Weigh-In
                {bwbWeight?.staleThisWeek ? (
                  <Badge className="ml-auto bg-yellow-500/20 text-yellow-400 border-yellow-500/30" data-testid="status-weight-stale">Update due this week</Badge>
                ) : bwbWeight?.hasWeight ? (
                  <Badge className="ml-auto bg-green-500/20 text-green-400 border-green-500/30" data-testid="status-weight-fresh">Fresh</Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-2xl font-bold" data-testid="text-current-weight">{bwbWeight?.currentWeight ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">Current (lbs)</div>
                </div>
                <div>
                  <div className="text-2xl font-bold" data-testid="text-total-lost">{bwbWeight?.totalLost ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">Lost (lbs)</div>
                </div>
                <div>
                  <div className="text-2xl font-bold" data-testid="text-start-weight">{bwbWeight?.startWeight ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">Start (lbs)</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground" data-testid="text-weight-updated">
                {bwbWeight?.updatedAt
                  ? `Last updated ${bwbWeight.daysSinceUpdate === 0 ? "today" : `${bwbWeight.daysSinceUpdate} day(s) ago`} · ${new Date(bwbWeight.updatedAt).toLocaleDateString()}`
                  : "No weight logged yet"}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  type="number"
                  placeholder="Current"
                  value={weightForm.currentWeight}
                  onChange={(e) => setWeightForm((f) => ({ ...f, currentWeight: e.target.value }))}
                  data-testid="input-current-weight"
                />
                <Input
                  type="number"
                  placeholder="Lost"
                  value={weightForm.totalLost}
                  onChange={(e) => setWeightForm((f) => ({ ...f, totalLost: e.target.value }))}
                  data-testid="input-total-lost"
                />
                <Input
                  type="number"
                  placeholder="Start"
                  value={weightForm.startWeight}
                  onChange={(e) => setWeightForm((f) => ({ ...f, startWeight: e.target.value }))}
                  data-testid="input-start-weight"
                />
              </div>
              <Button
                className="w-full"
                disabled={weightMutation.isPending || (!weightForm.currentWeight && !weightForm.totalLost && !weightForm.startWeight)}
                onClick={() => {
                  const payload: { currentWeight?: number; totalLost?: number; startWeight?: number } = {};
                  const c = parseFloat(weightForm.currentWeight);
                  const l = parseFloat(weightForm.totalLost);
                  const s = parseFloat(weightForm.startWeight);
                  if (Number.isFinite(c) && c > 0) payload.currentWeight = c;
                  if (Number.isFinite(l) && l > 0) payload.totalLost = l;
                  if (Number.isFinite(s) && s > 0) payload.startWeight = s;
                  if (Object.keys(payload).length === 0) {
                    toast({ title: "Enter a weight", description: "Fill in at least one figure.", variant: "destructive" });
                    return;
                  }
                  weightMutation.mutate(payload);
                }}
                data-testid="button-log-weight"
              >
                {weightMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                Log weigh-in
              </Button>
              <p className="text-xs text-muted-foreground">Saving updates the figure the next recap uses — no video build is triggered.</p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="w-5 h-5" /> Files ({files.length})
                <div className="ml-auto">
                  <input
                    type="file"
                    ref={fileInputRef}
                    multiple
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.json,.xml,.yaml,.yml,.html,.md,.pptx,.ppt,.mp4,.mp3,.wav,.zip"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleFileUpload(project.id, e.target.files);
                      }
                    }}
                    data-testid="input-file-upload"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    data-testid="button-upload-files"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                    {isUploading ? "Uploading..." : "Upload"}
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                ref={dropZoneRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, project.id)}
                className={`relative rounded-lg transition-all duration-200 ${
                  isDragOver
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5"
                    : ""
                }`}
                data-testid="dropzone-files"
              >
                {isDragOver && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/10 backdrop-blur-sm rounded-lg border-2 border-dashed border-primary">
                    <Upload className="w-10 h-10 text-primary mb-2 animate-bounce" />
                    <p className="text-primary font-semibold text-lg">Drop files here</p>
                    <p className="text-primary/70 text-sm">PDFs, images, documents, spreadsheets — up to 50 MB each</p>
                  </div>
                )}

                {isUploading && uploadProgress && (
                  <div className="mb-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="text-sm font-medium text-primary">
                        Uploading {uploadProgress.total} file{uploadProgress.total > 1 ? "s" : ""}...
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{uploadProgress.fileName}</p>
                  </div>
                )}

              {files.length === 0 && !isUploading ? (
                <div
                  className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="text-muted-foreground text-sm font-medium">Drag & drop files here, or click to browse</p>
                  <p className="text-muted-foreground/70 text-xs mt-1">PDFs, images, Word docs, spreadsheets — up to 50 MB each</p>
                </div>
              ) : files.length > 0 ? (
                <div className="space-y-2">
                  {files.map((f) => {
                    const mimeType = f.file_type || "";
                    const isImage = mimeType.startsWith("image/");
                    const isPdf = mimeType === "application/pdf";
                    const driveLink = [f.file_url, f.file_path].find(u => u && u.includes("drive.google.com")) || null;
                    const downloadLink = f.file_url && !f.file_url.includes("drive.google.com") ? f.file_url : null;
                    const sizeStr = f.file_size ? (f.file_size > 1024 * 1024 ? `${(f.file_size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(f.file_size / 1024)} KB`) : null;
                    return (
                      <div key={f.id} className="flex items-center justify-between p-2 rounded bg-muted/50 group" data-testid={`file-${f.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          {isImage ? <ImageIcon className="w-4 h-4 text-blue-400 shrink-0" /> :
                           isPdf ? <FileText className="w-4 h-4 text-red-400 shrink-0" /> :
                           <File className="w-4 h-4 text-muted-foreground shrink-0" />}
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{f.file_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(f.created_at).toLocaleDateString()}
                              {sizeStr && <span className="ml-1.5 text-muted-foreground/60">{sizeStr}</span>}
                              {f.uploaded_by && <span className="ml-1.5">by {f.uploaded_by}</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {driveLink && (
                            <a href={driveLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-xs text-blue-400 hover:bg-blue-500/20 transition-colors" data-testid={`link-view-file-${f.id}`}>
                              <FolderOpen className="w-3 h-3" /> Open
                            </a>
                          )}
                          {downloadLink && (
                            <a href={downloadLink} download className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 text-xs text-green-400 hover:bg-green-500/20 transition-colors" data-testid={`link-download-file-${f.id}`}>
                              <ArrowLeft className="w-3 h-3 rotate-[-90deg]" /> Download
                            </a>
                          )}
                          {!driveLink && !downloadLink && (
                            <span className="text-xs text-muted-foreground/50">Local only</span>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100"
                            onClick={() => deleteFileMutation.mutate({ projectId: project.id, fileId: f.id })}
                            data-testid={`button-delete-file-${f.id}`}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <div
                    className="border border-dashed border-muted-foreground/25 rounded p-3 text-center cursor-pointer hover:border-primary/50 transition-colors mt-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <p className="text-muted-foreground text-xs flex items-center justify-center gap-1"><Upload className="w-3 h-3" /> Drag & drop or click to upload more</p>
                  </div>
                </div>
              ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="w-5 h-5" /> Linked Conversations ({conversations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {conversations.length === 0 ? (
                <p className="text-muted-foreground text-sm">No conversations linked yet. Agents will link relevant chats automatically.</p>
              ) : (
                <div className="space-y-2">
                  {conversations.map((c) => {
                    const isPrimary = project.primary_conversation_id === c.conversation_id;
                    return (
                      <div key={c.conversation_id} className={`flex items-center justify-between p-2 rounded transition-colors ${isPrimary ? "bg-primary/10 border border-primary/30" : "bg-muted/50 hover:bg-muted"}`}>
                        <a href={`/chat/${c.conversation_id}`} className="flex-1" data-testid={`conv-${c.conversation_id}`}>
                          <div className="flex items-center gap-2">
                            {isPrimary && <Star className="w-4 h-4 text-primary fill-primary" />}
                            <div>
                              <p className="font-medium text-sm">{c.title}</p>
                              <p className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}{isPrimary && " — Primary thread"}</p>
                            </div>
                          </div>
                        </a>
                        {!isPrimary && (
                          <Button size="sm" variant="ghost" className="text-xs" onClick={async () => {
                            try {
                              await apiRequest("PATCH", `/api/projects/${project.id}`, { primaryConversationId: c.conversation_id });
                              queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] });
                              toast({ title: "Primary thread set" });
                            } catch { toast({ title: "Failed", variant: "destructive" }); }
                          }} data-testid={`btn-set-primary-${c.conversation_id}`}>
                            <Star className="w-3 h-3 mr-1" /> Pin
                          </Button>
                        )}
                        <a href={`/chat/${c.conversation_id}`}><ChevronRight className="w-4 h-4 text-muted-foreground" /></a>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <StickyNote className="w-5 h-5" /> Notes ({notes.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Add a note..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newNote.trim()) addNoteMutation.mutate({ id: project.id, note: newNote.trim() }); }}
                  data-testid="input-note"
                />
                <Button onClick={() => { if (newNote.trim()) addNoteMutation.mutate({ id: project.id, note: newNote.trim() }); }}
                  disabled={!newNote.trim()} data-testid="button-add-note">Add</Button>
              </div>
              {notes.length === 0 ? (
                <p className="text-muted-foreground text-sm">No notes yet.</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-auto">
                  {notes.map((n) => (
                    <div key={n.id} className="p-2 rounded bg-muted/50" data-testid={`note-${n.id}`}>
                      <p className="text-sm">{n.note}</p>
                      <p className="text-xs text-muted-foreground mt-1">{n.author} — {new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(project.id)} data-testid="button-delete-project">
            <Trash2 className="w-4 h-4 mr-1" /> Delete Project
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6" data-testid="projects-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderOpen className="w-6 h-6" /> Projects
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Your filing cabinet — every customer and job gets a project folder</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-project"><Plus className="w-4 h-4 mr-1" /> New Project</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Project name" value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                data-testid="input-project-name" />
              <Textarea placeholder="Description" value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                data-testid="input-project-description" />
              <Input placeholder="Customer name" value={newProject.customerName} onChange={(e) => setNewProject({ ...newProject, customerName: e.target.value })}
                data-testid="input-customer-name" />
              <Input placeholder="Customer email" value={newProject.customerEmail} onChange={(e) => setNewProject({ ...newProject, customerEmail: e.target.value })}
                data-testid="input-customer-email" />
              <Input placeholder="Tags (comma separated)" value={newProject.tags} onChange={(e) => setNewProject({ ...newProject, tags: e.target.value })}
                data-testid="input-tags" />
              <Button className="w-full" disabled={!newProject.name.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate({
                  name: newProject.name.trim(),
                  description: newProject.description.trim(),
                  customerName: newProject.customerName.trim() || undefined,
                  customerEmail: newProject.customerEmail.trim() || undefined,
                  tags: newProject.tags ? newProject.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
                })}
                data-testid="button-create-project">
                {createMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search projects, customers..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)} data-testid="input-search-projects" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="select-filter-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Loading projects...</div>
      ) : frontierResearchFolderOpen ? (
        <div className="space-y-6" data-testid="frontier-jury-research-folder-view">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setFrontierResearchFolderOpen(false)} data-testid="button-close-frontier-jury-research">
              <ArrowLeft className="w-4 h-4 mr-1" /> All Projects
            </Button>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-primary" /> Frontier Jury Research
            </h2>
            <span className="text-sm text-muted-foreground">{frontierJuryRuns.length} saved run{frontierJuryRuns.length === 1 ? "" : "s"}</span>
          </div>
          <Card className="border-primary/20">
            <CardContent className="p-4 text-sm text-muted-foreground">
              Saved income and monetization research from the frontier jury. Reports remain visible even when their recommendations overlap existing offers and are not promoted as new concepts.
            </CardContent>
          </Card>
          {isFrontierJuryRunsLoading ? (
            <div className="text-center text-muted-foreground py-12">Loading frontier jury research...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {frontierJuryRuns.map(renderFrontierJuryRunCard)}
            </div>
          )}
        </div>
      ) : frontierFolderOpen ? (
        <div className="space-y-6" data-testid="frontier-concepts-folder-view">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setFrontierFolderOpen(false)} data-testid="button-close-frontier-folder">
              <ArrowLeft className="w-4 h-4 mr-1" /> All Projects
            </Button>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-primary" /> Frontier Concepts
            </h2>
            <span className="text-sm text-muted-foreground">{frontierConcepts.length} accepted concept{frontierConcepts.length === 1 ? "" : "s"}</span>
          </div>
          <Card className="border-primary/20">
            <CardContent className="p-4 text-sm text-muted-foreground">
              These are new concepts the frontier jury has already screened against existing offers. They remain research until you explicitly decide to turn one into a feature contract or Revenue Mission.
            </CardContent>
          </Card>
          {isFrontierConceptsLoading ? (
            <div className="text-center text-muted-foreground py-12">Loading frontier concepts...</div>
          ) : visibleFrontierConcepts.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <Lightbulb className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-lg font-medium">No accepted concepts yet</p>
                <p className="text-muted-foreground text-sm mt-1">The folder will fill after an owner-authorized frontier discovery produces a genuinely new concept.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleFrontierConcepts.map(renderFrontierConceptCard)}
            </div>
          )}
        </div>
      ) : filtered.length === 0 && !showFrontierFolder && !showFrontierResearchFolder ? (
        <Card className="text-center py-12">
          <CardContent>
            <FolderOpen className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-lg font-medium">No projects yet</p>
            <p className="text-muted-foreground text-sm mt-1">
              {projects.length === 0
                ? "Create your first project or let an agent create one when you start working on a customer job."
                : "No projects match your search."
              }
            </p>
          </CardContent>
        </Card>
      ) : groupIdeas && ideaFolderOpen ? (
        <div className="space-y-6" data-testid="ideabrowser-folder-view">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setIdeaFolderOpen(false)} data-testid="button-close-idea-folder">
              <ArrowLeft className="w-4 h-4 mr-1" /> All Projects
            </Button>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FolderOpen className="w-5 h-5" /> IdeaBrowser
            </h2>
            <span className="text-sm text-muted-foreground">{weeklyRuns.length} run{weeklyRuns.length === 1 ? "" : "s"} · {wedgeEntries.length} wedge{wedgeEntries.length === 1 ? "" : "s"} · {ideaEntries.length} idea{ideaEntries.length === 1 ? "" : "s"}</span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Simulation Runs</h3>
              <div className="flex items-center gap-3">
                {scenarioStatus?.lastRunFinishedAt && (
                  <span className="text-xs text-muted-foreground" data-testid="text-scenario-last-run">
                    Last run: {new Date(scenarioStatus.lastRunFinishedAt).toLocaleString()} ({scenarioStatus.lastRunStatus})
                  </span>
                )}
                {isAdmin && <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runScenarioMutation.mutate()}
                  disabled={runScenarioMutation.isPending || scenarioStatus?.queued}
                  data-testid="button-run-scenario-now"
                >
                  {runScenarioMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Queuing…</>
                  ) : scenarioStatus?.queued ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Run queued</>
                  ) : (
                    <><PlayCircle className="w-4 h-4 mr-1" /> Run now</>
                  )}
                </Button>}
              </div>
            </div>
            {weeklyRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet — Felix files one here every Monday after the money-scenario pass (master archive sweeps land here too).</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {weeklyRuns.map(renderProjectCard)}
              </div>
            )}
          </div>

          {wedgeEntries.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Wedge Builds</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="grid-wedge-builds">
                {wedgeEntries.map(renderProjectCard)}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Ideas</h3>
            {ideaEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ideas ingested yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {ideaEntries.map(renderProjectCard)}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {showFrontierResearchFolder && (
            <Card className="cursor-pointer hover:border-primary/50 transition-colors border-dashed"
              onClick={() => { setFrontierFolderOpen(false); setIdeaFolderOpen(false); setFrontierResearchFolderOpen(true); }} data-testid="card-frontier-jury-research-folder">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-lg leading-tight flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-primary" /> Frontier Jury Research
                  </h3>
                  <Badge variant="outline" className="text-xs">{frontierJuryRuns.length}</Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                  Saved monetization and income-opportunity reports from the frontier jury, including recommendations that were not promoted as new concepts.
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                  <span className="flex items-center gap-1"><ChevronRight className="w-3 h-3" /> Open folder</span>
                  {frontierJuryRuns[0] && (
                    <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" /> {new Date(frontierJuryRuns[0].createdAt).toLocaleDateString()}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          {showFrontierFolder && (
            <Card className="cursor-pointer hover:border-primary/50 transition-colors border-dashed"
              onClick={() => { setIdeaFolderOpen(false); setFrontierResearchFolderOpen(false); setFrontierFolderOpen(true); }} data-testid="card-frontier-concepts-folder">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-lg leading-tight flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-primary" /> Frontier Concepts
                  </h3>
                  <Badge variant="outline" className="text-xs">{frontierConcepts.length}</Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                  Accepted new business concepts from the frontier jury, saved for your review before anything gets built or sold.
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                  <span className="flex items-center gap-1"><ChevronRight className="w-3 h-3" /> Open folder</span>
                  {frontierConcepts[0] && (
                    <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" /> {new Date(frontierConcepts[0].createdAt).toLocaleDateString()}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          {groupIdeas && (
            <Card className="cursor-pointer hover:border-primary/50 transition-colors border-dashed"
              onClick={() => { setFrontierFolderOpen(false); setIdeaFolderOpen(true); }} data-testid="card-ideabrowser-folder">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-lg leading-tight flex items-center gap-2">
                    <FolderOpen className="w-5 h-5 text-primary" /> IdeaBrowser
                  </h3>
                  <Badge variant="outline" className="text-xs">{ideaProjects.length}</Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                  Idea pipeline — {weeklyRuns.length} weekly run{weeklyRuns.length === 1 ? "" : "s"}, {wedgeEntries.length > 0 ? `${wedgeEntries.length} wedge build${wedgeEntries.length === 1 ? "" : "s"}, ` : ""}{ideaEntries.length} idea{ideaEntries.length === 1 ? "" : "s"}. Felix ingests, scores, and money-scenarios these every Monday.
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                  <span className="flex items-center gap-1"><ChevronRight className="w-3 h-3" /> Open folder</span>
                  {ideaProjects[0] && (
                    <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" /> {new Date(ideaProjects[0].updated_at).toLocaleDateString()}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          {mainList.map(renderProjectCard)}
        </div>
      )}
    </div>
  );

  function renderFrontierConceptCard(concept: FrontierRevenueConceptSummary) {
    return (
      <Card key={concept.id} className="cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => setSelectedFrontierConceptId(concept.id)} data-testid={`card-frontier-concept-${concept.id}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold text-lg leading-tight">{concept.title}</h3>
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">New</Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-1"><span className="font-medium text-foreground">Buyer:</span> {concept.targetBuyer}</p>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{concept.paidOffer}</p>
          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground border-t pt-3">
            <span>Novelty <strong className="text-foreground">{concept.scores.novelty}</strong></span>
            <span>Pain <strong className="text-foreground">{concept.scores.buyerPain}</strong></span>
            <span>WTP <strong className="text-foreground">{concept.scores.willingnessToPay}</strong></span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3">
            <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> Review needed</span>
            <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" /> {new Date(concept.createdAt).toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderFrontierJuryRunCard(run: FrontierRevenueJuryRunSummary) {
    const statusLabel = run.status === "complete" ? "Complete" : run.status === "partial" ? "Partial" : "Failed";
    const statusClass = run.status === "complete"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : run.status === "partial"
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : "bg-destructive/15 text-destructive border-destructive/30";
    return (
      <Card key={run.id} className="cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => setSelectedFrontierJuryRunId(run.id)} data-testid={`card-frontier-jury-run-${run.id}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold text-lg leading-tight">{run.title}</h3>
            <Badge className={`${statusClass} text-xs`}>{statusLabel}</Badge>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{run.aggregatorModel}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground border-t pt-3">
            <span>Jury lanes <strong className="text-foreground">{run.successfulProposers}/{run.proposerCount}</strong></span>
            <span>Concordance <strong className="text-foreground">{run.concordance === null ? "—" : `${Math.round(run.concordance * 100)}%`}</strong></span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3">
            <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> Open report</span>
            <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" /> {new Date(run.createdAt).toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderProjectCard(p: Project) {
    return (
      <Card key={p.id} className="cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => setSelectedProject(p.id)} data-testid={`card-project-${p.id}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-lg leading-tight">{p.name}</h3>
            <Badge className={`${statusColors[p.status]} text-xs`}>{p.status}</Badge>
          </div>
          {p.customer_name && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
              <User className="w-3 h-3" /> {p.customer_name}
            </p>
          )}
          {p.description && <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{p.description}</p>}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
            <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {p.file_count}</span>
            <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {p.conversation_count}</span>
            <span className="flex items-center gap-1"><StickyNote className="w-3 h-3" /> {p.note_count}</span>
            <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" /> {new Date(p.updated_at).toLocaleDateString()}</span>
          </div>
          {p.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {p.tags.map((t) => (
                <Badge key={t} variant="outline" className="text-xs"><Tag className="w-3 h-3 mr-1" />{t}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
}
