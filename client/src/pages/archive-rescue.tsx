import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Honeypot, TurnstileWidget } from "@/components/bot-protection";
import { Check, FileText, Upload, Loader2, ArrowRight, Archive, Phone, ShieldCheck } from "lucide-react";

interface ArchiveProduct {
  id: string;
  name: string;
  description: string | null;
  tier: string;
  priceId: string | null;
  unitAmountCents: number | null;
  currency: string | null;
  mode: "payment" | "subscription";
}
interface ProductsResponse { generatedAt: string; count: number; products: ArchiveProduct[]; }

const OWNER_EMAIL = "huskyauto@gmail.com";

const TIERS = [
  { key: "starter", name: "Starter", priceFallback: "$99", pages: "500 pages", desc: "One-time. Perfect for a single filing cabinet or a small board's historical minutes.", features: ["500 pages OCR'd + indexed", "Per-org search portal (1 year)", "PDF + searchable text export", "Email delivery within 5 business days"] },
  { key: "standard", name: "Standard", priceFallback: "$299", pages: "2,500 pages", desc: "Most common. A small museum's correspondence archive or a 5-attorney law firm's closed-case files.", features: ["2,500 pages OCR'd + indexed", "Per-org search portal (1 year)", "Auto-classification by document type", "Date extraction + timeline view", "Delivery within 10 business days"], featured: true },
  { key: "pro", name: "Pro", priceFallback: "$999 + $49/mo", pages: "10,000 pages + ongoing", desc: "Full-archive treatment. Includes a year of monthly add-on scans for active records.", features: ["10,000 pages OCR'd + indexed", "Per-org search portal (lifetime)", "Monthly add-on scans (up to 500/mo)", "Custom doc-type classifier", "Quarterly check-in call", "Delivery within 20 business days"] },
];

function priceLabel(p?: ArchiveProduct, fallback?: string): string {
  if (p?.unitAmountCents != null && p.currency) {
    const amt = p.unitAmountCents / 100;
    const sym = p.currency.toLowerCase() === "usd" ? "$" : "";
    return `${sym}${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}${p.mode === "subscription" ? "/mo" : ""}`;
  }
  return fallback || "Contact";
}

export default function ArchiveRescuePage() {
  const { toast } = useToast();
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<"museum" | "law-firm" | "historical-society" | "other">("museum");
  const [contactEmail, setContactEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [checkoutTier, setCheckoutTier] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = "Archive Rescue — turn your filing cabinet into a searchable database | VisionClaw";
    return () => { document.title = prev; };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("status") === "success") {
      toast({ title: "Payment received!", description: "We'll email you within one business day to coordinate your upload." });
    }
  }, [toast]);

  const { data: productsData } = useQuery<ProductsResponse>({ queryKey: ["/api/public/archive-rescue/products"] });
  const productByTier: Record<string, ArchiveProduct | undefined> = {};
  for (const p of productsData?.products || []) productByTier[p.tier] = p;

  async function submitDemo(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) { toast({ title: "Add at least 1 page", description: "Snap a phone photo of any page — we'll OCR it free." }); return; }
    if (files.length > 5) { toast({ title: "Max 5 pages for the free demo", description: "We'll do the rest after you pick a tier." }); return; }
    if (!orgName.trim() || !contactEmail.trim()) { toast({ title: "Org name + email required", description: "We need somewhere to send your OCR'd transcripts." }); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("orgName", orgName.trim());
      fd.append("orgType", orgType);
      fd.append("contactEmail", contactEmail.trim());
      if (contactName.trim()) fd.append("contactName", contactName.trim());
      if (notes.trim()) fd.append("notes", notes.trim());
      for (const f of files) fd.append("photos", f);
      fd.append("company_website", honeypot);
      if (demoToken) fd.append("turnstileToken", demoToken);
      const r = await fetch("/api/public/archive-rescue/demo", { method: "POST", body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setSubmitted(true);
      toast({ title: "Got it!", description: "OCR running now — you'll have transcripts within 24 hours." });
    } catch (err: any) {
      toast({ title: "Submission failed", description: err?.message || "Email us directly and we'll handle it.", variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  async function startCheckout(tierKey: string) {
    if (!orgName.trim() || !contactEmail.trim()) { toast({ title: "Org name + email required first", description: "Fill in the demo form fields above — we use the same info." }); return; }
    setCheckoutTier(tierKey);
    try {
      const r = await fetch("/api/public/archive-rescue/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierKey, orgName: orgName.trim(), orgType, contactEmail: contactEmail.trim(), company_website: honeypot }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.fallback) { toast({ title: "Checkout not wired yet", description: j.fallback }); return; }
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      if (j.url) window.location.href = j.url;
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err?.message || `Email ${OWNER_EMAIL} and we'll handle it manually.`, variant: "destructive" });
    } finally { setCheckoutTier(null); }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <section className="text-center mb-16">
          <Badge variant="outline" className="mb-4" data-testid="badge-wedge"><Archive className="h-3 w-3 mr-1" /> Archive Rescue</Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6" data-testid="text-hero-headline">
            Turn that filing cabinet<br />into a searchable database.
          </h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-6" data-testid="text-hero-subhead">
            For small museums, two-attorney law firms, and historical societies. We OCR your paper archives, classify them, and give your team a search portal — all from <span className="font-semibold">phone photos a volunteer can shoot in an afternoon</span>. No flatbed scanner. No flying out a vendor. Pricing starts at $99.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Check className="h-4 w-4 text-green-600" /> Enterprise vendors quote $50K+</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Check className="h-4 w-4 text-green-600" /> We charge $99–$999</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Check className="h-4 w-4 text-green-600" /> Same OCR quality</span>
          </div>
        </section>

        <section className="mb-16">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Try it free: 5 pages, OCR'd within 24 hours</CardTitle>
              <CardDescription>Snap a phone photo of any 1–5 pages from your archive. We'll OCR them with the same pipeline real customers get and email the transcripts back. No card, no commitment.</CardDescription>
            </CardHeader>
            <CardContent>
              {submitted ? (
                <div className="rounded-lg bg-green-50 dark:bg-green-950 p-6 text-center" data-testid="banner-demo-submitted">
                  <Check className="h-12 w-12 text-green-600 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold mb-2">Got it. OCR is running now.</h3>
                  <p className="text-sm text-muted-foreground">We'll email <span className="font-mono">{contactEmail}</span> within 24 hours with your transcripts + a sample of the search portal you'd get as a customer. If you don't see it, check spam or write to {OWNER_EMAIL}.</p>
                </div>
              ) : (
                <form onSubmit={submitDemo} className="grid gap-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="org-name">Organization name *</Label>
                      <Input id="org-name" data-testid="input-org-name" required value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="e.g. Smithfield County Historical Society" />
                    </div>
                    <div>
                      <Label htmlFor="org-type">Org type</Label>
                      <Select value={orgType} onValueChange={v => setOrgType(v as any)}>
                        <SelectTrigger id="org-type" data-testid="select-org-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="museum">Museum / archive</SelectItem>
                          <SelectItem value="law-firm">Law firm</SelectItem>
                          <SelectItem value="historical-society">Historical society</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="email">Email *</Label>
                      <Input id="email" data-testid="input-email" type="email" required value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="you@org.org" />
                    </div>
                    <div>
                      <Label htmlFor="name">Your name (optional)</Label>
                      <Input id="name" data-testid="input-name" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Jane Doe" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="photos">1–5 phone photos of any pages *</Label>
                    <Input id="photos" data-testid="input-photos" ref={fileRef} type="file" accept="image/*" multiple onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 5))} />
                    {files.length > 0 && <p className="text-sm text-muted-foreground mt-1" data-testid="text-file-count">{files.length} file(s) selected — first {Math.min(files.length, 5)} will be OCR'd.</p>}
                  </div>
                  <div>
                    <Label htmlFor="notes">Tell us about the archive (optional)</Label>
                    <Textarea id="notes" data-testid="input-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. 'Mostly typed correspondence 1962–1989, some handwritten board minutes, condition is mixed.'" />
                  </div>
                  <Honeypot value={honeypot} onChange={setHoneypot} />
                  <TurnstileWidget onToken={setDemoToken} />
                  <Button type="submit" disabled={submitting} size="lg" data-testid="button-submit-demo">
                    {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading…</> : <>Get my free OCR demo <ArrowRight className="h-4 w-4 ml-2" /></>}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-3" data-testid="text-pricing-headline">Pricing</h2>
            <p className="text-muted-foreground">Pay once. Get pages back as searchable PDFs + a private search portal for your team.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {TIERS.map(t => {
              const p = productByTier[t.key];
              const live = priceLabel(p, t.priceFallback);
              return (
                <Card key={t.key} className={t.featured ? "border-primary shadow-lg" : ""} data-testid={`card-tier-${t.key}`}>
                  <CardHeader>
                    {t.featured && <Badge className="w-fit mb-2">Most popular</Badge>}
                    <CardTitle className="flex items-baseline justify-between">
                      <span>{t.name}</span>
                      <span className="text-3xl font-bold" data-testid={`text-price-${t.key}`}>{live}</span>
                    </CardTitle>
                    <CardDescription>{t.pages}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">{t.desc}</p>
                    <ul className="space-y-2 mb-6">
                      {t.features.map(f => (
                        <li key={f} className="flex items-start gap-2 text-sm"><Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" /><span>{f}</span></li>
                      ))}
                    </ul>
                    <Button className="w-full" variant={t.featured ? "default" : "outline"} onClick={() => startCheckout(t.key)} disabled={checkoutTier === t.key} data-testid={`button-buy-${t.key}`}>
                      {checkoutTier === t.key ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Opening checkout…</> : <>Get {t.name} <ArrowRight className="h-4 w-4 ml-2" /></>}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4">Custom volume? Need on-site pickup? Email {OWNER_EMAIL}.</p>
        </section>

        <section className="mb-16 grid md:grid-cols-3 gap-6">
          <Card data-testid="card-how-1"><CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="rounded-full bg-primary text-primary-foreground w-7 h-7 inline-flex items-center justify-center text-sm">1</span> A volunteer shoots phone photos</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">No scanner needed. Just open the phone, page through, snap. We've validated the OCR on a hand-held shot with a thumb in frame — quality is identical to a flatbed.</CardContent></Card>
          <Card data-testid="card-how-2"><CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="rounded-full bg-primary text-primary-foreground w-7 h-7 inline-flex items-center justify-center text-sm">2</span> We OCR, classify, and index</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Every page gets verbatim text extraction (Claude vision), document-type classification (letter / minutes / memo / receipt / photo caption), and date extraction where possible.</CardContent></Card>
          <Card data-testid="card-how-3"><CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="rounded-full bg-primary text-primary-foreground w-7 h-7 inline-flex items-center justify-center text-sm">3</span> You get a private search portal</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Your team logs in and searches across the whole archive — by keyword, date, or doc type. Plus a downloadable PDF + searchable text bundle you own forever.</CardContent></Card>
        </section>

        <section className="mb-16">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Why this works at this price</CardTitle></CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none text-sm">
              <p>Enterprise digitization vendors quote $50K because they assume a flatbed scanner, a dedicated room, trained operators, and weeks of project management. The actual unit cost of modern vision-model OCR is <strong>about a penny per page</strong>. The vendor markup is the room, the operator, and the salespeople.</p>
              <p>We removed all three. A volunteer with a phone replaces the room + operator. The OCR is a vision-model API call. The portal is one of our existing per-tenant knowledge surfaces — already built, already running. The price difference between us and the enterprise vendor is not a quality difference. It's a <em>distribution</em> difference.</p>
              <p>Concierge fulfillment by the founder for the first 20 customers per tier — first 20 pages of every order are human-spot-checked, then 10% sampling. If quality slips, the whole order is re-run free.</p>
            </CardContent>
          </Card>
        </section>

        <section className="text-center">
          <Card className="bg-muted/40">
            <CardContent className="pt-6">
              <Phone className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <h3 className="text-xl font-semibold mb-2">Not sure if your archive fits?</h3>
              <p className="text-muted-foreground mb-4">Send a few sample photos via the free demo above, or email {OWNER_EMAIL}. Real reply, same day.</p>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
