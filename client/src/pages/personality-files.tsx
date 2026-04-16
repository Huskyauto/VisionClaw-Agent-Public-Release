import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, FileText, User, Sparkles, Shield, BookOpen, Trash2, ChevronDown, ChevronUp } from "lucide-react";

interface PersonalityFile {
  id: number;
  tenantId: number;
  personaId: number;
  fileType: string;
  content: string;
  updatedAt: string;
}

interface FileTypeInfo {
  type: string;
  description: string;
}

interface Persona {
  id: number;
  name: string;
  role: string;
  icon: string;
}

const FILE_ICONS: Record<string, any> = {
  SOUL: Sparkles,
  STYLE: FileText,
  USER: User,
  RULES: Shield,
  CONTEXT: BookOpen,
};

const FILE_COLORS: Record<string, string> = {
  SOUL: "text-purple-500",
  STYLE: "text-blue-500",
  USER: "text-green-500",
  RULES: "text-red-500",
  CONTEXT: "text-orange-500",
};

const FILE_PLACEHOLDERS: Record<string, string> = {
  SOUL: `# Soul Definition
Write who this agent truly IS — their core values, personality traits, and behavioral boundaries.

Example:
- I am methodical and precise. I never rush to conclusions.
- I value transparency — I always explain my reasoning.
- I have a dry sense of humor but keep it professional.
- I treat every task as if the company's reputation depends on it.`,
  STYLE: `# Communication Style
Define how this agent communicates — tone, vocabulary, formatting preferences.

Example:
- Use short, punchy sentences. No fluff.
- Always lead with the key insight before supporting details.
- Use bullet points for lists of 3+ items.
- Avoid corporate jargon. Speak plainly.
- Sign off important communications with the agent's name.`,
  USER: `# User Context
Information about you (the CEO) that helps the agent serve you better.

Example:
- I run a SaaS company with 12 employees.
- I prefer concise summaries over detailed reports.
- My timezone is CST (Chicago).
- I'm technical but value business impact over technical details.
- Key projects: Product launch Q2, Series A fundraise.`,
  RULES: `# Hard Rules
Non-negotiable directives this agent must always follow.

Example:
- Never share pricing information externally without approval.
- Always CC the legal team on any contract-related communications.
- Budget limit: Do not approve expenditures over $500 autonomously.
- Data handling: All customer data must be referenced by ID, never by name in logs.`,
  CONTEXT: `# Business Context
Domain knowledge and situational awareness for this agent.

Example:
- Our product is a B2B analytics platform for e-commerce.
- Main competitors: Mixpanel, Amplitude, Heap.
- Our differentiator: real-time cohort analysis with no-code setup.
- Current priorities: reducing churn, improving onboarding flow.
- Key metrics: MRR, DAU, NPS, Time-to-Value.`,
};

export default function PersonalityFilesPage() {
  const { toast } = useToast();
  const [selectedPersona, setSelectedPersona] = useState<string>("1");
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const { data: personas = [] } = useQuery<Persona[]>({
    queryKey: ["/api/personas"],
  });

  const { data: fileTypes = [] } = useQuery<FileTypeInfo[]>({
    queryKey: ["/api/personality-files/types"],
  });

  const { data: files = [], isLoading } = useQuery<PersonalityFile[]>({
    queryKey: ["/api/personality-files", selectedPersona],
    enabled: !!selectedPersona,
  });

  useEffect(() => {
    const contentMap: Record<string, string> = {};
    files.forEach(f => { contentMap[f.fileType] = f.content; });
    setEditContent(contentMap);
    setDirty({});
  }, [files]);

  const saveMutation = useMutation({
    mutationFn: ({ fileType, content }: { fileType: string; content: string }) =>
      apiRequest("POST", `/api/personality-files/${selectedPersona}`, { fileType, content }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/personality-files", selectedPersona] });
      setDirty(prev => ({ ...prev, [variables.fileType]: false }));
      toast({ title: `${variables.fileType}.md saved`, description: "Changes will apply to the next conversation." });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (fileType: string) =>
      apiRequest("DELETE", `/api/personality-files/${selectedPersona}/${fileType}`),
    onSuccess: (_data, fileType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/personality-files", selectedPersona] });
      setEditContent(prev => { const n = { ...prev }; delete n[fileType]; return n; });
      toast({ title: `${fileType}.md deleted` });
    },
  });

  const handleContentChange = (fileType: string, content: string) => {
    setEditContent(prev => ({ ...prev, [fileType]: content }));
    setDirty(prev => ({ ...prev, [fileType]: true }));
  };

  const currentPersona = personas.find(p => String(p.id) === selectedPersona);
  const fileCount = files.filter(f => f.content.trim().length > 0).length;

  if (isLoading && personas.length === 0) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6" data-testid="personality-files-page">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Sparkles className="h-7 w-7 text-primary" /> Agent Personality Files
        </h1>
        <p className="text-muted-foreground">
          Customize each agent's personality, style, and context with structured markdown files.
          These override the default persona settings for your account.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Select value={selectedPersona} onValueChange={setSelectedPersona}>
            <SelectTrigger data-testid="select-persona">
              <SelectValue placeholder="Select an agent" />
            </SelectTrigger>
            <SelectContent>
              {personas.map(p => (
                <SelectItem key={p.id} value={String(p.id)} data-testid={`persona-option-${p.id}`}>
                  {p.icon} {p.name} — {p.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {currentPersona && (
          <Badge variant="outline" className="text-sm" data-testid="text-file-count">
            {fileCount}/5 files configured
          </Badge>
        )}
      </div>

      {currentPersona && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">{currentPersona.icon} {currentPersona.name}</CardTitle>
            <CardDescription>{currentPersona.role}</CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="space-y-3">
        {fileTypes.map(ft => {
          const Icon = FILE_ICONS[ft.type] || FileText;
          const color = FILE_COLORS[ft.type] || "text-muted-foreground";
          const isExpanded = expandedFile === ft.type;
          const existingFile = files.find(f => f.fileType === ft.type);
          const content = editContent[ft.type] ?? "";
          const isDirty = dirty[ft.type] || false;
          const hasContent = content.trim().length > 0;

          return (
            <Card key={ft.type} data-testid={`file-card-${ft.type}`}>
              <CardHeader
                className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedFile(isExpanded ? null : ft.type)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className={`h-5 w-5 ${color}`} />
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {ft.type}.md
                        {hasContent && <Badge variant="default" className="text-xs">Active</Badge>}
                        {isDirty && <Badge variant="outline" className="text-xs text-yellow-600">Unsaved</Badge>}
                      </CardTitle>
                      <CardDescription className="text-xs">{ft.description}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {existingFile && (
                      <span className="text-xs text-muted-foreground">
                        Updated {new Date(existingFile.updatedAt).toLocaleDateString()}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="pt-0 space-y-3">
                  <Textarea
                    className="min-h-[200px] font-mono text-sm"
                    placeholder={FILE_PLACEHOLDERS[ft.type] || `Write your ${ft.type}.md content here...`}
                    value={content}
                    onChange={e => handleContentChange(ft.type, e.target.value)}
                    data-testid={`textarea-${ft.type}`}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveMutation.mutate({ fileType: ft.type, content })}
                        disabled={!isDirty || saveMutation.isPending}
                        data-testid={`button-save-${ft.type}`}
                      >
                        {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save {ft.type}.md
                      </Button>
                      {existingFile && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deleteMutation.mutate(ft.type)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${ft.type}`}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Clear
                        </Button>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {content.length} chars
                    </span>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Card data-testid="card-info">
        <CardHeader><CardTitle>How Personality Files Work</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p><strong>SOUL.md</strong> — Defines the agent's core personality and behavioral boundaries. This is the deepest layer of customization.</p>
          <p><strong>STYLE.md</strong> — Controls communication tone, vocabulary, and formatting preferences.</p>
          <p><strong>USER.md</strong> — Provides context about you (the CEO) so the agent can serve you better.</p>
          <p><strong>RULES.md</strong> — Hard constraints the agent must always follow. Non-negotiable directives.</p>
          <p><strong>CONTEXT.md</strong> — Business domain knowledge, industry context, and situational awareness.</p>
          <p className="text-xs mt-3">These files are injected into the agent's system prompt for every conversation. They override default persona settings and are specific to your account.</p>
        </CardContent>
      </Card>
    </div>
  );
}
