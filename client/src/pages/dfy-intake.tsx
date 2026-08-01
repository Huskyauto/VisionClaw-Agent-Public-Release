import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, ClipboardList, XCircle } from "lucide-react";
import { DFY_INTAKE_SECTIONS } from "@shared/dfy-intake-fields";

interface FormMeta {
  company: string;
  website: string;
  customerName?: string | null;
  status: "sent" | "submitted";
  responses: Record<string, string>;
}

export default function DfyIntakePage() {
  const [, params] = useRoute("/dfy-intake/:token");
  const token = params?.token || "";
  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/public/dfy-intake/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "This link is invalid.");
        setMeta(data as FormMeta);
        setAnswers((data.responses as Record<string, string>) || {});
      } catch (e: any) {
        setLoadError(e?.message || "This link is invalid.");
      }
    })();
  }, [token]);

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    setMissing([]);
    try {
      const res = await fetch(`/api/public/dfy-intake/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: answers }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data?.missing) && data.missing.length) {
          setMissing(data.missing);
          setSubmitError("Please answer the required questions highlighted below.");
          // Scroll to first missing field
          setTimeout(() => document.querySelector('[data-missing="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
        } else {
          setSubmitError(data?.error || "Could not save your answers.");
        }
        return;
      }
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setSubmitError(e?.message || "Could not save your answers.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto p-6 pt-16 text-center">
        <XCircle className="h-10 w-10 mx-auto text-destructive mb-3" />
        <h1 className="text-xl font-semibold mb-1">Link not found</h1>
        <p className="text-muted-foreground text-sm" data-testid="text-load-error">{loadError}</p>
      </div>
    );
  }
  if (!meta) {
    return <div className="p-16 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6 pb-24">
      <div className="pt-4">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-form-title">
          <ClipboardList className="h-6 w-6" /> {meta.company} — AI Setup Questionnaire
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {meta.customerName ? `Hi ${meta.customerName.split(" ")[0]}! ` : ""}
          Your answers below are used to build your website's AI-readiness files with
          accurate, real information — the more complete, the better the result.
          Takes about 10–15 minutes. Fields marked * are required.
        </p>
      </div>

      {(submitted || meta.status === "submitted") && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm flex items-start gap-2" data-testid="banner-submitted">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">{submitted ? "Answers received — thank you!" : "You already submitted this form."}</div>
            <div className="text-muted-foreground">You can update any answer and resubmit at any time using this same link.</div>
          </div>
        </div>
      )}

      {DFY_INTAKE_SECTIONS.map((section) => (
        <Card key={section.title}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{section.title}</CardTitle>
            {section.description && <CardDescription>{section.description}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            {section.fields.map((f) => {
              const isMissing = missing.includes(f.key);
              return (
                <div key={f.key} className="space-y-1.5" data-missing={isMissing ? "true" : undefined}>
                  <Label htmlFor={`f-${f.key}`} className={isMissing ? "text-destructive" : ""}>
                    {f.label}{f.required ? " *" : ""}
                  </Label>
                  {f.multiline ? (
                    <Textarea
                      id={`f-${f.key}`}
                      rows={4}
                      value={answers[f.key] || ""}
                      placeholder={f.placeholder}
                      className={isMissing ? "border-destructive" : ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                      data-testid={`input-intake-${f.key}`}
                    />
                  ) : (
                    <Input
                      id={`f-${f.key}`}
                      value={answers[f.key] || ""}
                      placeholder={f.placeholder}
                      className={isMissing ? "border-destructive" : ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                      data-testid={`input-intake-${f.key}`}
                    />
                  )}
                  {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {submitError && <p className="text-sm text-destructive" data-testid="text-submit-error">{submitError}</p>}
      <Button size="lg" className="w-full" onClick={submit} disabled={submitting} data-testid="button-submit-intake">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {meta.status === "submitted" || submitted ? "Update my answers" : "Submit my answers"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Your information is only used to prepare your AI-readiness deliverables and is never shared.
      </p>
    </div>
  );
}
