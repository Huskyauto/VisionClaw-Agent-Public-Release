import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { ProposedSkill } from "@shared/schema";

type Status = "pending" | "accepted" | "rejected" | "all";

export default function ProposedSkillsPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("pending");
  const { data, isLoading } = useQuery<{ proposedSkills: ProposedSkill[] }>({
    queryKey: ["/api/proposed-skills", status],
  });
  const items = data?.proposedSkills || [];

  const accept = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/proposed-skills/${id}/accept`),
    onSuccess: () => {
      toast({ title: "Promoted to live skills" });
      queryClient.invalidateQueries({ queryKey: ["/api/proposed-skills"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });
  const reject = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/proposed-skills/${id}/reject`),
    onSuccess: () => {
      toast({ title: "Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/proposed-skills"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="container mx-auto py-8 px-6 max-w-5xl">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-proposed-skills">Proposed Skills</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Patterns agents have flagged as worth saving as reusable skills. Nothing is active until you accept it.
          </p>
        </div>
        <div className="flex gap-2" data-testid="filter-status">
          {(["pending", "accepted", "rejected", "all"] as Status[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              onClick={() => setStatus(s)}
              data-testid={`button-filter-${s}`}
            >{s}</Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground" data-testid="text-loading">Loading…</div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground" data-testid="text-empty">
          No proposed skills with status "{status}".
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <Card key={s.id} data-testid={`card-proposed-skill-${s.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <CardTitle className="text-base" data-testid={`text-name-${s.id}`}>{s.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{s.category}</Badge>
                    <Badge variant="secondary" data-testid={`text-confidence-${s.id}`}>conf {s.confidence}/100</Badge>
                    <Badge variant={s.status === "pending" ? "default" : s.status === "accepted" ? "secondary" : "outline"}>
                      {s.status}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm" data-testid={`text-description-${s.id}`}>{s.description}</p>
                {s.sourceContext && (
                  <p className="text-xs text-muted-foreground italic">Source: {s.sourceContext}</p>
                )}
                <details className="group">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground" data-testid={`button-toggle-body-${s.id}`}>
                    Show full body
                  </summary>
                  <pre className="mt-2 text-xs whitespace-pre-wrap bg-muted/40 p-3 rounded border border-border/40 max-h-80 overflow-auto" data-testid={`text-body-${s.id}`}>
                    {s.body}
                  </pre>
                </details>
                {s.proposingPersona && (
                  <p className="text-xs text-muted-foreground">Proposed by: {s.proposingPersona}</p>
                )}
                {s.status === "pending" && (
                  <div className="flex gap-2 pt-2 border-t border-border/40">
                    <Button
                      size="sm"
                      onClick={() => accept.mutate(s.id)}
                      disabled={accept.isPending}
                      data-testid={`button-accept-${s.id}`}
                    >Accept &amp; promote</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reject.mutate(s.id)}
                      disabled={reject.isPending}
                      data-testid={`button-reject-${s.id}`}
                    >Reject</Button>
                  </div>
                )}
                {s.reviewedBy && (
                  <p className="text-xs text-muted-foreground">
                    Reviewed by {s.reviewedBy}
                    {s.promotedSkillId ? ` → skill #${s.promotedSkillId}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
