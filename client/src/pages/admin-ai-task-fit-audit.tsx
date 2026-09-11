import { useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  BriefcaseBusiness,
  Check,
  ClipboardCheck,
  FileText,
  Gauge,
  MessageSquareText,
  PackageCheck,
  Rocket,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";

const packages = [
  {
    name: "Starter assessment",
    price: "$497",
    scope: "One department · up to 15 tasks · one owner interview",
    outcome: "Task-fit map, safeguards, and concise 30 / 60 / 90-day roadmap",
  },
  {
    name: "Full business assessment",
    price: "$1,997",
    scope: "Up to three departments · up to 50 tasks · manager and worker input",
    outcome: "Prioritized task map, implementation sequence, risk controls, and 90-day roadmap",
  },
] as const;

const zones = [
  ["Automation green light", "People want the task removed and current tools can perform it reliably.", "Automate with monitoring and an escape path."],
  ["Human-AI partnership", "AI can accelerate the work, but human context, judgment, or relationship remains important.", "Augment; preserve review and decision authority."],
  ["Human-led red light", "Automation may be technically possible, but people need or prefer meaningful human control.", "Keep human-led; use AI only for bounded support."],
  ["Technical opportunity", "People want relief, but current tools cannot safely meet the required standard.", "Document the need and revisit when capability improves."],
  ["Low priority", "Low customer value, low worker demand, or weak economic benefit.", "Do not spend implementation money here."],
] as const;

const intake = [
  ["Business and department", "What part of the business are we assessing?", "Example: Northside HVAC — dispatch and office administration"],
  ["Business outcome", "What should improve if this project succeeds?", "Example: Return missed calls within five minutes without removing dispatcher approval"],
  ["Recurring tasks", "List the repeated work that consumes time or causes delays.", "Example: Copy web leads into the CRM, confirm appointments, prepare the Friday backlog report"],
  ["People involved", "Which roles perform, review, receive, or depend on this work?", "Example: Two dispatchers, service manager, technicians, and customers"],
  ["Current tools and evidence", "What systems, reports, recordings, or samples can support the assessment?", "Example: Jobber, call logs, scheduling reports, and five approved sample messages"],
  ["Limits and concerns", "What must remain human-controlled? What would damage trust?", "Example: Pricing exceptions and customer complaints require manager approval"],
] as const;

const fulfillment = [
  "Confirm payment and package scope in Customer Orders.",
  "Review intake; request only the missing facts needed to assess the named tasks.",
  "Conduct the owner interview and optional worker/manager interviews.",
  "Classify each task, choose Human Agency level H1–H5, and label Evidence confidence.",
  "Draft the customer-owned PDF using facts, evidence, limitations, safeguards, and the 30 / 60 / 90-day roadmap.",
  "Run the forbidden-output and affiliation check before attaching the PDF.",
  "Attach the validated PDF to the order, proofread it, then use Approve & ship.",
  "Record acceptance, implementation interest, delivery time, and actual fulfillment cost.",
] as const;

const launch = [
  "Select one local niche and list five qualified businesses.",
  "Use the founder offer: $497 for one department and up to 15 tasks.",
  "Ask for a paid commitment before building automation.",
  "Complete one assessment manually and measure operator hours.",
  "Ask the buyer which recommendation created the most value.",
  "Offer implementation only as a separately approved scope.",
] as const;

export default function AdminAiTaskFitAuditPage() {
  const [, navigate] = useLocation();
  const [tasks, setTasks] = useState("15");
  const [hourlyValue, setHourlyValue] = useState("35");
  const [hoursSaved, setHoursSaved] = useState("3");
  const estimate = useMemo(() => {
    const taskCount = Math.max(0, Number(tasks) || 0);
    const hourly = Math.max(0, Number(hourlyValue) || 0);
    const weekly = Math.max(0, Number(hoursSaved) || 0);
    return { taskCount, annualValue: Math.round(hourly * weekly * 50) };
  }, [tasks, hourlyValue, hoursSaved]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <section className="overflow-hidden rounded-2xl border bg-gradient-to-br from-cyan-500/15 via-background to-amber-500/10 p-5 sm:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge><Rocket className="mr-1 h-3 w-3" /> Launch program</Badge>
                <Badge variant="secondary">Manual-first</Badge>
                <Badge variant="outline">Owner only</Badge>
              </div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">AI Task Fit & Human Agency Audit</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                Help small businesses identify what to automate, what to augment, and what must remain human-led—before they spend money on the wrong AI project.
              </p>
              <p className="mt-3 text-sm font-medium">
                Promise: a practical task map and 30 / 60 / 90-day roadmap without employment decisions or exaggerated AI claims.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => navigate("/admin/income-opportunities")}>Opportunity Bank</Button>
              <Button onClick={() => navigate("/admin/payment-links")}>Open payment tools <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </div>
          </div>
        </section>

        <Tabs defaultValue="offer" className="space-y-5">
          <TabsList className="h-auto w-full justify-start overflow-x-auto p-1">
            <TabsTrigger value="offer">Offer</TabsTrigger>
            <TabsTrigger value="intake">Intake & rubric</TabsTrigger>
            <TabsTrigger value="fulfillment">Fulfillment</TabsTrigger>
            <TabsTrigger value="sales">Launch</TabsTrigger>
          </TabsList>

          <TabsContent value="offer" className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              {packages.map((item) => (
                <Card key={item.name} className="border-primary/25">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div><CardTitle>{item.name}</CardTitle><CardDescription className="mt-2">{item.scope}</CardDescription></div>
                      <Badge className="text-base">{item.price}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex gap-2 text-sm"><PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{item.outcome}</CardContent>
                </Card>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Best buyer</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">An owner or operations leader with 10–100 employees, repeated administrative work, and an AI decision expected within 90 days.</CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> Buying trigger</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">They are reviewing an AI proposal, losing time to repetitive work, or need one low-risk first project.</CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="h-4 w-4" /> Expansion</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Separately approved implementation and quarterly monitoring. No recurring charge is bundled into the audit.</CardContent></Card>
            </div>
            <Card>
              <CardHeader><CardTitle>Simple value conversation</CardTitle><CardDescription>This estimate is a qualification aid, not a promised ROI.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-4">
                <Input aria-label="Tasks assessed" value={tasks} onChange={(e) => setTasks(e.target.value)} placeholder="Example: 15" />
                <Input aria-label="Hourly value" value={hourlyValue} onChange={(e) => setHourlyValue(e.target.value)} placeholder="Example: 35" />
                <Input aria-label="Weekly hours saved" value={hoursSaved} onChange={(e) => setHoursSaved(e.target.value)} placeholder="Example: 3" />
                <div className="rounded-lg border bg-muted/40 p-3"><div className="text-xs text-muted-foreground">{estimate.taskCount} tasks · annual capacity hypothesis</div><div className="text-2xl font-bold">${estimate.annualValue.toLocaleString()}</div></div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="intake" className="space-y-5">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" /> Customer intake</CardTitle><CardDescription>Every blank says what to enter and provides an example.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                {intake.map(([label, prompt, example]) => (
                  <div key={label} className="space-y-2 rounded-lg border p-4"><div className="font-medium">{label}</div><div className="text-sm text-muted-foreground">{prompt}</div><Textarea disabled placeholder={example} /></div>
                ))}
              </CardContent>
            </Card>
            <div className="grid gap-3">
              {zones.map(([name, meaning, action], index) => (
                <Card key={name}><CardContent className="grid gap-3 p-4 md:grid-cols-[72px_1fr_1fr] md:items-center"><Badge variant="outline">H{index + 1}</Badge><div><div className="font-semibold">{name}</div><div className="text-sm text-muted-foreground">{meaning}</div></div><div className="text-sm"><span className="font-medium">Action:</span> {action}</div></CardContent></Card>
              ))}
            </div>
            <Card className="border-amber-500/35">
              <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-amber-600" /> Evidence contract</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                <div><strong>Fact type:</strong> Customer-supplied fact, operator-observed evidence, external evidence, or inference.</div>
                <div><strong>Evidence confidence:</strong> High, Medium, or Low with a plain-language reason.</div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fulfillment" className="space-y-5">
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Report blueprint</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm md:grid-cols-2">{["Executive decision summary","Scope, sources, and limitations","Task-by-task agency map","Green lights and safeguards","Human-AI partnership workflows","Human-led red lights","Technical opportunities and low priorities","30 / 60 / 90-day roadmap","Measures, owners, and stop conditions","Appendix: evidence and confidence"].map((item) => <div key={item} className="flex gap-2 rounded-md bg-muted/35 p-3"><Check className="h-4 w-4 text-primary" />{item}</div>)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Fulfillment checklist</CardTitle></CardHeader><CardContent className="space-y-3">{fulfillment.map((item, index) => <div key={item} className="flex gap-3 text-sm"><Badge variant="outline">{index + 1}</Badge><span>{item}</span></div>)}</CardContent></Card>
            <Card className="border-destructive/30"><CardHeader><CardTitle className="flex items-center gap-2"><Ban className="h-5 w-5 text-destructive" /> Hard boundaries</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm md:grid-cols-2"><div>Do not recommend layoffs, hiring, discipline, compensation changes, or worker ranking.</div><div>No Stanford or MIT affiliation, endorsement, certification, or WORKBank resale claim.</div><div>Do not invent customer facts or imply low-confidence evidence is verified.</div><div>Do not deliver without owner review and a valid customer-owned PDF.</div></CardContent></Card>
          </TabsContent>

          <TabsContent value="sales" className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Rocket className="h-5 w-5" /> Launch checklist</CardTitle></CardHeader><CardContent className="space-y-3">{launch.map((item) => <div key={item} className="flex gap-2 text-sm"><BadgeCheck className="h-4 w-4 shrink-0 text-primary" />{item}</div>)}</CardContent></Card>
              <Card><CardHeader><CardTitle>Founder outreach copy</CardTitle><CardDescription>Use only in a consented, one-to-one conversation.</CardDescription></CardHeader><CardContent><div className="rounded-lg bg-muted/40 p-4 text-sm leading-6">“Before you buy another AI tool, I’ll map the work your team actually wants automated, the work that needs human control, and the safest first projects. The $497 founder assessment covers one department and up to 15 tasks, with a practical 90-day roadmap. Would a 15-minute fit call be useful?”</div></CardContent></Card>
            </div>
            <Card><CardHeader><CardTitle>Track proof, not activity</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{["Paid conversion","Operator hours","Accepted recommendations","Implementation interest"].map((metric) => <div key={metric} className="rounded-lg border p-4"><div className="text-2xl font-bold">—</div><div className="text-sm text-muted-foreground">{metric}</div></div>)}</CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}