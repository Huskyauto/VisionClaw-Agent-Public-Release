import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Sparkles, BookOpen } from "lucide-react";

interface PublicSkill {
  topic: string;
  department: string;
  summary: string;
  personaFit: string[];
  bytes: number;
  lastReviewed: string;
}

interface CatalogResponse {
  generatedAt: string;
  count: number;
  departmentCount: number;
  departments: string[];
  items: PublicSkill[];
}

interface SkillDetail extends PublicSkill {
  markdown: string;
}

const DEPARTMENT_COLOR: Record<string, string> = {
  Product: "text-violet-500",
  Strategy: "text-amber-500",
  Sales: "text-emerald-500",
  Marketing: "text-rose-500",
  Communications: "text-blue-500",
  Legal: "text-cyan-500",
  HR: "text-orange-500",
  Operations: "text-slate-500",
  Knowledge: "text-fuchsia-500",
  General: "text-muted-foreground",
};

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  return `${(b / 1024).toFixed(1)} KB`;
}

export default function SkillsCatalogPage() {
  const [openTopic, setOpenTopic] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<CatalogResponse>({
    queryKey: ["/api/public/skills"],
    refetchInterval: 5 * 60_000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery<SkillDetail>({
    queryKey: ["/api/public/skills", openTopic],
    enabled: !!openTopic,
  });

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-skills-catalog">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">
          <Sparkles className="h-7 w-7 text-primary" />
          Skills Catalog
        </h1>
        <p className="text-muted-foreground mt-2 max-w-3xl" data-testid="text-page-description">
          Reusable, repeatable workflows the VisionClaw agent team executes on demand. Each skill encodes how a senior practitioner approaches a specific task — from drafting a PRD to running a discovery call — so the same standard ships every time.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16" data-testid="state-loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive" data-testid="state-error">
            Failed to load the skills catalog.
          </CardContent>
        </Card>
      )}

      {data && data.items.length === 0 && (
        <Card>
          <CardContent className="pt-6" data-testid="state-empty">
            <p className="text-muted-foreground">
              No public skills yet. Curated examples will appear here as they are reviewed and opted in.
            </p>
          </CardContent>
        </Card>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" data-testid="badge-skill-count">
                {data.count} public {data.count === 1 ? "skill" : "skills"}
              </Badge>
              <Badge variant="outline" data-testid="badge-department-count">
                {data.departmentCount} {data.departmentCount === 1 ? "department" : "departments"}
              </Badge>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="grid-skills">
            {data.items.map((skill) => {
              const colorClass = DEPARTMENT_COLOR[skill.department] || "text-muted-foreground";
              return (
                <Card
                  key={skill.topic}
                  className="hover:border-primary/40 transition-colors flex flex-col"
                  data-testid={`card-skill-${skill.topic}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <BookOpen className={`h-5 w-5 shrink-0 ${colorClass}`} />
                        <CardTitle
                          className="text-base truncate"
                          title={skill.topic}
                          data-testid={`text-skill-name-${skill.topic}`}
                        >
                          {skill.topic.replace(/-/g, " ")}
                        </CardTitle>
                      </div>
                      <Badge variant="outline" className="shrink-0" data-testid={`badge-dept-${skill.topic}`}>
                        {skill.department}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 flex-1 flex flex-col">
                    <p className="text-sm text-muted-foreground flex-1" data-testid={`text-summary-${skill.topic}`}>
                      {skill.summary}
                    </p>
                    {skill.personaFit.length > 0 && (
                      <div className="flex flex-wrap gap-1" data-testid={`personas-${skill.topic}`}>
                        {skill.personaFit.map((p) => (
                          <Badge key={p} variant="secondary" className="text-xs">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span data-testid={`text-bytes-${skill.topic}`}>{fmtBytes(skill.bytes)}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setOpenTopic(skill.topic)}
                      data-testid={`button-view-${skill.topic}`}
                    >
                      View skill
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {data && data.items.length > 0 && (
        <p className="text-xs text-muted-foreground pt-6 border-t" data-testid="text-attribution">
          Skill templates adapted from{" "}
          <a
            href="https://github.com/mohitagw15856/pm-claude-skills"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            pm-claude-skills
          </a>{" "}
          by Mohit Aggarwal (MIT License). Curated, extended, and operationalized by the VisionClaw agent team.
        </p>
      )}

      <Dialog open={!!openTopic} onOpenChange={(o) => !o && setOpenTopic(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh]" data-testid="dialog-skill-detail">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {detail ? detail.topic.replace(/-/g, " ") : "Loading…"}
            </DialogTitle>
          </DialogHeader>
          {detailLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {detail && (
            <ScrollArea className="h-[60vh] pr-4">
              <pre
                className="text-xs whitespace-pre-wrap font-mono leading-relaxed"
                data-testid="text-skill-markdown"
              >
                {detail.markdown}
              </pre>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
