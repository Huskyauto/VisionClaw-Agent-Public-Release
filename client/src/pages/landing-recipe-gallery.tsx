import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowRight, Clock, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Recipe = {
  id: string;
  label: string;
  format: string;
  prompt: string;
  tagline: string;
  description: string;
  estimate: string;
  durationMinutes: { low: number; median: number; high: number };
  costUsd: { low: number; median: number; high: number };
  passingGradeBar: number;
};

export function RecipeGallery() {
  const [, navigate] = useLocation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, isLoading } = useQuery<{ recipes: Recipe[] }>({
    queryKey: ["/api/public/recipes"],
  });
  const recipes = data?.recipes || [];

  const handleRun = (r: Recipe) => {
    try {
      sessionStorage.setItem("vc.prefilledPrompt", r.prompt);
    } catch { /* no-op */ }
    navigate("/chat");
  };

  return (
    <section id="section-recipes" className="py-20 px-6 border-t border-border" data-testid="section-recipes">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">Try it · No setup</Badge>
          <h2 className="text-3xl font-bold mb-3">One-Click Recipes</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Real, cost-quoted deliverables Felix can run end-to-end. Every recipe shows the
            up-front time and cost band — no surprises.
          </p>
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="recipes-loading">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i} className="border-border/60 animate-pulse h-44" />
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recipes.map((r) => {
              const expanded = expandedId === r.id;
              return (
                <Card
                  key={r.id}
                  className="border-border/60 hover-elevate active-elevate-2 transition-shadow"
                  data-testid={`card-recipe-${r.id}`}
                >
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-semibold leading-snug" data-testid={`text-recipe-label-${r.id}`}>
                        {r.label}
                      </h3>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide shrink-0">
                        {r.format}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground" data-testid={`text-recipe-tagline-${r.id}`}>
                      {r.tagline}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground border-t border-border/40 pt-3">
                      <div className="flex items-center gap-1" data-testid={`text-recipe-estimate-${r.id}`}>
                        <Clock className="w-3.5 h-3.5" />
                        <span>{r.estimate || "instant"}</span>
                      </div>
                      <div className="flex items-center gap-1 ml-auto">
                        <Gauge className="w-3.5 h-3.5" />
                        <span>{r.passingGradeBar > 0 ? `≥${r.passingGradeBar}/100 graded` : "no grading"}</span>
                      </div>
                    </div>
                    {expanded && (
                      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground border border-border/40" data-testid={`text-recipe-prompt-${r.id}`}>
                        <div className="font-medium text-foreground mb-1">Prompt sent to Felix:</div>
                        {r.prompt}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                        data-testid={`button-recipe-expand-${r.id}`}
                      >
                        {expanded ? "Hide" : "Show prompt"}
                      </Button>
                      <Button
                        size="sm"
                        className="ml-auto"
                        onClick={() => handleRun(r)}
                        data-testid={`button-recipe-run-${r.id}`}
                      >
                        Run this <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}