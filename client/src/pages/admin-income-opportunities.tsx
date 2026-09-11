import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  INCOME_OPPORTUNITIES,
  type OpportunityCategory,
  type OpportunityEvidence,
} from "@/data/income-opportunities";
import { ArrowRight, Blocks, FileStack, Lightbulb, Search, Sparkles, Target, Users } from "lucide-react";
import { useLocation } from "wouter";

const CATEGORIES: Array<"All" | OpportunityCategory> = [
  "All",
  "Assessment",
  "Monitoring",
  "Implementation",
  "Partner",
  "Education",
];

const EVIDENCE_VARIANT: Record<
  OpportunityEvidence,
  "default" | "secondary" | "outline"
> = {
  Idea: "outline",
  Observed: "secondary",
  Committed: "secondary",
  Paid: "default",
  Repeatable: "default",
};

export default function AdminIncomeOpportunitiesPage() {
  const [, navigate] = useLocation();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return INCOME_OPPORTUNITIES.filter((opportunity) => {
      const matchesCategory = category === "All" || opportunity.category === category;
      const matchesSearch =
        query.length === 0 ||
        [
          opportunity.name,
          opportunity.buyer,
          opportunity.problem,
          opportunity.entryOffer,
        ].some((value) => value.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [category, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <section className="overflow-hidden rounded-xl border bg-gradient-to-br from-primary/12 via-background to-amber-500/10 p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Badge variant="secondary" className="mb-3">
                <Sparkles className="mr-1 h-3 w-3" /> Owner workspace
              </Badge>
              <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl" data-testid="text-income-opportunities-title">
                <Lightbulb className="h-7 w-7 text-primary" />
                Income Opportunities
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
                Turn research, customer pain, and VisionClaw capabilities into practical offers.
                Keep many ideas visible, but validate one small revenue experiment at a time.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-2xl font-bold">{INCOME_OPPORTUNITIES.length}</div>
                <div className="text-xs text-muted-foreground">ideas captured</div>
              </div>
              <div className="rounded-lg border bg-background/80 p-3">
                <div className="text-2xl font-bold">
                  {INCOME_OPPORTUNITIES.filter((item) => item.featured).length}
                </div>
                <div className="text-xs text-muted-foreground">priority candidates</div>
              </div>
              <div className="col-span-2 rounded-lg border bg-background/80 p-3 sm:col-span-1">
                <div className="text-2xl font-bold">1</div>
                <div className="text-xs text-muted-foreground">experiment at a time</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Card className="border-dashed" data-testid="card-future-templates">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileStack className="h-4 w-4 text-primary" /> Templates
                <Badge variant="outline">Next</Badge>
              </CardTitle>
              <CardDescription>
                Reusable intake forms, calculators, report outlines, outreach, and customer deliverables.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-dashed" data-testid="card-future-systems">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Blocks className="h-4 w-4 text-primary" /> Systems
                <Badge variant="outline">Future</Badge>
              </CardTitle>
              <CardDescription>
                Evidence tracking, offer fulfillment, monitoring, and payment-gated delivery workflows.
              </CardDescription>
            </CardHeader>
          </Card>
        </section>

        <section className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Opportunity bank</h2>
              <p className="text-sm text-muted-foreground">
                Prices are hypotheses until a real buyer commits and pays.
              </p>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search buyers, problems, or offers"
                aria-label="Search income opportunities"
                className="pl-9"
                data-testid="input-opportunity-search"
              />
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Opportunity categories">
            {CATEGORIES.map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={category === item ? "default" : "outline"}
                className="min-h-11 shrink-0"
                onClick={() => setCategory(item)}
                data-testid={`button-opportunity-category-${item.toLowerCase()}`}
              >
                {item}
              </Button>
            ))}
          </div>
        </section>

        {visible.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground" data-testid="status-opportunities-empty">
              No opportunities match those filters.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2" data-testid="grid-income-opportunities">
            {visible.map((opportunity) => (
              <Card
                key={opportunity.slug}
                className={opportunity.featured ? "border-primary/35 shadow-sm" : ""}
                data-testid={`card-opportunity-${opportunity.slug}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge variant="secondary">{opportunity.category}</Badge>
                        <Badge variant={EVIDENCE_VARIANT[opportunity.evidence]}>
                          {opportunity.evidence}
                        </Badge>
                        {opportunity.featured && <Badge>Priority</Badge>}
                      </div>
                      <CardTitle className="text-lg">{opportunity.name}</CardTitle>
                    </div>
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                      <Target className="h-5 w-5" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex gap-2">
                    <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Buyer</div>
                      <p>{opportunity.buyer}</p>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Problem</div>
                    <p className="mt-1 text-muted-foreground">{opportunity.problem}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/35 p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-medium">{opportunity.entryOffer}</span>
                      <Badge variant="outline" className="w-fit shrink-0">{opportunity.price}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Expansion: {opportunity.expansion}
                    </p>
                  </div>
                  <div className="rounded-lg bg-primary/8 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-primary">Smallest next test</div>
                    <p className="mt-1">{opportunity.nextStep}</p>
                  </div>
                  {opportunity.actionPath && (
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => navigate(opportunity.actionPath!)}
                      data-testid={`button-open-${opportunity.slug}`}
                    >
                      Open launch workspace <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
