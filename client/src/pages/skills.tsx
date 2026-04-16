import { useQuery, useMutation } from "@tanstack/react-query";
import { Zap, Code, Search, Globe, FileText, Calculator, Image, Brain, Mail, Database, Shield, MessageSquare, Eraser, Lightbulb, Play, Twitter, Monitor, Store, Sun, Repeat, BookOpen, Gauge, Megaphone, Lock, GitBranch, Phone, Rocket, ShoppingBag, Palette, Workflow, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Skill, Persona } from "@shared/schema";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/error-state";

const ICON_MAP: Record<string, any> = {
  Code, Search, Globe, FileText, Calculator, Image, Brain, Mail, Database,
  Shield, MessageSquare, Zap, Eraser, Lightbulb, Play, Twitter, Monitor,
  Store, Sun, Repeat, BookOpen, Gauge, Megaphone, Lock, GitBranch, Phone, Rocket,
  ShoppingBag, Palette, Workflow,
};

const CATEGORY_LABELS: Record<string, string> = {
  reasoning: "Reasoning & Analysis",
  writing: "Writing & Communication",
  coding: "Code & Development",
  data: "Data & Research",
  general: "General",
};

export default function SkillsPage() {
  const { toast } = useToast();

  const skillsQuery = useQuery<Skill[]>({
    queryKey: ["/api/skills"],
  });
  const { data: skills = [], isLoading } = skillsQuery;

  const personasQuery = useQuery<Persona[]>({
    queryKey: ["/api/personas"],
  });
  const { data: personas = [] } = personasQuery;

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/skills/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/skills"] }),
    onError: () => toast({ description: "Failed to update skill", variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, personaId }: { id: number; personaId: number | null }) =>
      apiRequest("PATCH", `/api/skills/${id}`, { personaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
      toast({ description: "Skill assignment updated" });
    },
    onError: () => toast({ description: "Failed to assign skill", variant: "destructive" }),
  });

  const grouped = skills.reduce<Record<string, Skill[]>>((acc, skill) => {
    const cat = skill.category || "general";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(skill);
    return acc;
  }, {});

  const enabledCount = skills.filter((s) => s.enabled).length;
  const assignedCount = skills.filter((s) => s.personaId).length;

  if (skillsQuery.isError) return <ErrorState title="Skills Error" message="Failed to load skills. Please try again." onRetry={() => skillsQuery.refetch()} />;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Skills</h1>
              <p className="text-sm text-muted-foreground">Manage your agent's capabilities</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {assignedCount > 0 && (
              <Badge variant="outline" className="gap-1">
                <User className="w-3 h-3" />
                {assignedCount} assigned
              </Badge>
            )}
            <Badge variant="secondary" className="gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {enabledCount} active
            </Badge>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : skills.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No skills loaded yet.</p>
            </CardContent>
          </Card>
        ) : (
          Object.entries(grouped).map(([category, categorySkills]) => (
            <div key={category}>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-0.5">
                {CATEGORY_LABELS[category] || category}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {categorySkills.map((skill) => {
                  const Icon = ICON_MAP[skill.icon] || Zap;
                  const assignedPersona = personas.find(p => p.id === skill.personaId);
                  return (
                    <Card
                      key={skill.id}
                      data-testid={`card-skill-${skill.id}`}
                      className={cn("transition-colors", !skill.enabled && "opacity-60")}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                            skill.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                          )}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <h3 className="text-sm font-medium leading-tight truncate">{skill.name}</h3>
                                  {(skill as any).promptContent && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 text-primary border-primary/30">
                                      Enhanced
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{skill.description}</p>
                              </div>
                              <Switch
                                checked={skill.enabled}
                                data-testid={`switch-skill-${skill.id}`}
                                onCheckedChange={(enabled) => toggleMutation.mutate({ id: skill.id, enabled })}
                                className="shrink-0 mt-0.5"
                              />
                            </div>
                            <div className="mt-2">
                              <Select
                                value={skill.personaId ? String(skill.personaId) : "all"}
                                onValueChange={(val) => {
                                  const personaId = val === "all" ? null : parseInt(val, 10);
                                  assignMutation.mutate({ id: skill.id, personaId });
                                }}
                              >
                                <SelectTrigger
                                  data-testid={`select-skill-persona-${skill.id}`}
                                  className="h-7 text-xs w-full"
                                >
                                  <div className="flex items-center gap-1.5 truncate">
                                    <User className="w-3 h-3 shrink-0 text-muted-foreground" />
                                    <SelectValue placeholder="All Personas" />
                                  </div>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All Personas</SelectItem>
                                  {personas.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>
                                      {p.emoji} {p.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
