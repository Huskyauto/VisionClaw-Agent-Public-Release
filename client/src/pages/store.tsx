import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShoppingCart, CheckCircle2, ArrowLeft, FileText, Package, Mail, ExternalLink } from "lucide-react";
import { Link } from "wouter";

interface IntakeField {
  key: string;
  label: string;
  placeholder?: string;
  type: "text" | "textarea" | "select";
  required?: boolean;
  maxLength?: number;
  options?: { value: string; label: string }[];
}

interface PublicCatalogEntry {
  sku: string;
  productName: string;
  priceCents: number;
  priceFormatted: string;
  tagline: string;
  description: string;
  kind?: "static" | "service";
  intakeFields?: IntakeField[];
  fileCount: number;
  primaryFileName: string;
  primaryFileType: string;
}

function StoreHeader() {
  return (
    <div className="text-center mb-12">
      <div className="inline-flex items-center gap-2 text-3xl font-bold mb-2">
        <span className="text-4xl">🦞</span>
        <span data-testid="text-store-title">VisionClaw Store</span>
      </div>
      <p className="text-muted-foreground text-lg" data-testid="text-store-subtitle">
        Offline-first productivity tools. Buy once, run anywhere — no subscriptions.
      </p>
    </div>
  );
}

function ProductCard({ product }: { product: PublicCatalogEntry }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [intake, setIntake] = useState<Record<string, string>>({});
  const isSample = false;
  const isService = product.kind === "service";

  // Stable per-mount idempotency token. Two near-simultaneous clicks of the
  // same Buy button (the classic anonymous double-click race) send the same
  // token, so the backend builds the same Stripe idempotency key and Stripe
  // returns the original Checkout Session instead of opening a second one.
  // Reused across retries because useRef is preserved across re-renders;
  // a fresh card mount (different SKU) gets its own token. Format matches
  // the backend's CLIENT_TOKEN_RE (/^[A-Za-z0-9_-]{8,128}$/).
  const idempotencyTokenRef = useRef<string>(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
  );

  function setIntakeValue(key: string, value: string) {
    setIntake(prev => ({ ...prev, [key]: value }));
  }

  function getMissingRequiredField(): string | null {
    if (!isService || !product.intakeFields) return null;
    for (const f of product.intakeFields) {
      if (f.required && !(intake[f.key] || "").trim()) return f.label;
    }
    return null;
  }

  async function handleBuy() {
    if (!email || !email.includes("@")) {
      toast({
        title: "Email required",
        description: "Please enter your email so we can deliver the product after payment.",
        variant: "destructive",
      });
      return;
    }
    const missing = getMissingRequiredField();
    if (missing) {
      toast({
        title: `${missing} is required`,
        description: "Fill in the highlighted field so we can generate your report.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const body: any = {
        sku: product.sku,
        customerEmail: email,
        clientIdempotencyToken: idempotencyTokenRef.current,
      };
      if (isService) body.intake = intake;
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Checkout failed");
      }
      window.location.href = data.url;
    } catch (err: any) {
      toast({
        title: "Checkout failed",
        description: err.message || "Could not start checkout. Please try again.",
        variant: "destructive",
      });
      setLoading(false);
    }
  }

  return (
    <Card className="flex flex-col" data-testid={`card-product-${product.sku}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 mb-2">
          <Badge variant={isSample ? "default" : "secondary"} data-testid={`badge-price-${product.sku}`}>
            {product.priceFormatted}
          </Badge>
          {isSample && <Badge variant="outline" className="border-emerald-500 text-emerald-600">Test purchase</Badge>}
        </div>
        <CardTitle data-testid={`text-product-name-${product.sku}`}>{product.productName}</CardTitle>
        <CardDescription data-testid={`text-product-tagline-${product.sku}`}>{product.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <p className="text-sm text-muted-foreground" data-testid={`text-product-description-${product.sku}`}>
          {product.description}
        </p>
        {isService && product.intakeFields && product.intakeFields.length > 0 && (
          <div className="space-y-3 pt-2 border-t">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tell us what to research</p>
            {product.intakeFields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`intake-${product.sku}-${f.key}`} className="text-xs">
                  {f.label}{f.required && <span className="text-red-500"> *</span>}
                </Label>
                {f.type === "textarea" && (
                  <textarea
                    id={`intake-${product.sku}-${f.key}`}
                    placeholder={f.placeholder}
                    value={intake[f.key] || ""}
                    maxLength={f.maxLength || 500}
                    onChange={(e) => setIntakeValue(f.key, e.target.value)}
                    disabled={loading}
                    rows={3}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid={`textarea-intake-${product.sku}-${f.key}`}
                  />
                )}
                {f.type === "text" && (
                  <Input
                    id={`intake-${product.sku}-${f.key}`}
                    type="text"
                    placeholder={f.placeholder}
                    value={intake[f.key] || ""}
                    maxLength={f.maxLength || 500}
                    onChange={(e) => setIntakeValue(f.key, e.target.value)}
                    disabled={loading}
                    data-testid={`input-intake-${product.sku}-${f.key}`}
                  />
                )}
                {f.type === "select" && (
                  <select
                    id={`intake-${product.sku}-${f.key}`}
                    value={intake[f.key] || (f.options?.[0]?.value || "")}
                    onChange={(e) => setIntakeValue(f.key, e.target.value)}
                    disabled={loading}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid={`select-intake-${product.sku}-${f.key}`}
                  >
                    {f.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t">
          <span className="flex items-center gap-1" data-testid={`text-product-files-${product.sku}`}>
            <Package className="h-3 w-3" /> {product.fileCount} {product.fileCount === 1 ? "file" : "files"}
          </span>
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" /> {product.primaryFileType}
          </span>
          {isService && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-500 font-medium">
              Custom-generated
            </span>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 items-stretch">
        <Label htmlFor={`email-${product.sku}`} className="text-xs">Email for delivery</Label>
        <Input
          id={`email-${product.sku}`}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          data-testid={`input-email-${product.sku}`}
        />
        <Button
          onClick={handleBuy}
          disabled={loading || !email}
          className="w-full"
          data-testid={`button-buy-${product.sku}`}
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting…</>
          ) : (
            <><ShoppingCart className="h-4 w-4 mr-2" /> Buy {product.priceFormatted}</>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

interface LookupOrder {
  sessionId: string;
  productName: string;
  productSku: string | null;
  createdAt: string | null;
}

function OrderLookup() {
  const { toast } = useToast();
  const [step, setStep] = useState<"email" | "code" | "results">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<LookupOrder[]>([]);

  // If the buyer arrived from the recovery email link
  // (/store?lookup=<email>), pre-fill the email and jump straight to
  // the code-entry step so they can paste the 6-digit code from the
  // same email without retyping their address. We strip the param
  // from the URL afterward so a shared/bookmarked link doesn't leak
  // the email address.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const presetEmail = params.get("lookup");
    if (presetEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(presetEmail)) {
      setEmail(presetEmail);
      setStep("code");
      params.delete("lookup");
      const qs = params.toString();
      window.history.replaceState({}, "", `/store${qs ? `?${qs}` : ""}`);
    }
  }, []);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      toast({
        title: "Email required",
        description: "Enter the email you used at checkout.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/store/lookup-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Lookup failed");
      }
      setStep("code");
      toast({
        title: "Check your inbox",
        description: data.message || "If we found any orders for that email, we just sent a 6-digit code to it.",
      });
    } catch (err: any) {
      toast({
        title: "Lookup failed",
        description: err.message || "Could not look up orders. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast({
        title: "Enter the 6-digit code",
        description: "Check the email we just sent for a 6-digit number.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/store/verify-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Verification failed");
      }
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setStep("results");
      setCode("");
    } catch (err: any) {
      toast({
        title: "Could not verify",
        description: err.message || "Invalid or expired code.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setStep("email");
    setEmail("");
    setCode("");
    setOrders([]);
  }

  return (
    <Card className="max-w-2xl mx-auto mt-16" data-testid="card-order-lookup">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg" data-testid="text-lookup-title">
          <Mail className="h-5 w-5" /> Lost your download link?
        </CardTitle>
        <CardDescription data-testid="text-lookup-description">
          {step === "email" && "Enter the email you used at checkout and we'll send you a 6-digit code."}
          {step === "code" && "Enter the 6-digit code we just emailed you to see your orders here."}
          {step === "results" && `Showing orders for ${email}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === "email" && (
          <form onSubmit={handleRequestCode} className="flex flex-col sm:flex-row gap-2 items-stretch">
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="flex-1"
              data-testid="input-lookup-email"
            />
            <Button
              type="submit"
              disabled={loading || !email}
              data-testid="button-lookup-submit"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
              ) : (
                <>Email me a code</>
              )}
            </Button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleVerifyCode} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground" data-testid="text-code-sent">
              If <span className="font-medium">{email}</span> has any orders on file, a 6-digit code is on its way. The code expires in 15 minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 items-stretch">
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={loading}
                className="flex-1 tracking-widest text-center font-mono text-lg"
                data-testid="input-lookup-code"
              />
              <Button
                type="submit"
                disabled={loading || code.length !== 6}
                data-testid="button-verify-code"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Checking…</>
                ) : (
                  <>Show my orders</>
                )}
              </Button>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:underline self-start"
              data-testid="button-lookup-restart"
            >
              Use a different email
            </button>
          </form>
        )}

        {step === "results" && (
          <div className="flex flex-col gap-3">
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-orders">
                We couldn't find any download links on file for this email yet. If you just bought something, give it a minute and try again.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="list-orders">
                {orders.map((o) => {
                  const when = o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "";
                  return (
                    <li
                      key={o.sessionId}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                      data-testid={`row-order-${o.sessionId}`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate" data-testid={`text-order-name-${o.sessionId}`}>
                          {o.productName}
                        </div>
                        {when && (
                          <div className="text-xs text-muted-foreground" data-testid={`text-order-date-${o.sessionId}`}>
                            {when}
                          </div>
                        )}
                      </div>
                      <Link href={`/orders/${o.sessionId}`}>
                        <Button size="sm" variant="outline" data-testid={`link-order-${o.sessionId}`}>
                          <ExternalLink className="h-4 w-4 mr-1" /> Open
                        </Button>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:underline self-start"
              data-testid="button-lookup-restart"
            >
              Look up a different email
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SuccessView({ sku }: { sku: string | null }) {
  const [_, navigate] = useLocation();
  return (
    <div className="max-w-2xl mx-auto text-center py-16">
      <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto mb-6" data-testid="icon-success" />
      <h1 className="text-3xl font-bold mb-3" data-testid="text-success-title">Payment received — thank you!</h1>
      <p className="text-muted-foreground mb-2" data-testid="text-success-message">
        Your purchase{sku ? ` of ${sku}` : ""} is being delivered right now.
      </p>
      <p className="text-muted-foreground mb-8">
        Check your inbox in the next minute or two. You'll get an email with a download link — open it on any device and the file works offline. Nothing to install.
      </p>
      <Button onClick={() => navigate("/store")} variant="outline" data-testid="button-back-to-store">
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to store
      </Button>
    </div>
  );
}

function CatalogView() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<{ products: PublicCatalogEntry[] }>({
    queryKey: ["/api/store/catalog"],
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") === "1") {
      toast({
        title: "Checkout cancelled",
        description: "No payment was taken. You can try again any time.",
      });
      window.history.replaceState({}, "", "/store");
    }
  }, [toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-24">
        <p className="text-destructive" data-testid="text-error-loading-catalog">Could not load catalog. Please refresh.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="grid-products">
        {data.products.map((p) => (
          <ProductCard key={p.sku} product={p} />
        ))}
      </div>
      <OrderLookup />
    </>
  );
}

export default function StorePage() {
  const [location, navigate] = useLocation();
  const isSuccess = location.startsWith("/store/success");
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const sku = params.get("sku");
  const sessionId = params.get("session_id");

  // After Stripe redirects back here, hand the customer off to the
  // permanent order page (/orders/:sessionId). That page is bookmarkable
  // and re-downloadable, which the legacy success view was not.
  useEffect(() => {
    if (isSuccess && sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      navigate(`/orders/${sessionId}`, { replace: true });
    }
  }, [isSuccess, sessionId, navigate]);

  useEffect(() => {
    document.title = isSuccess
      ? "Order Confirmed — VisionClaw Store"
      : "VisionClaw Store — Offline-First Productivity Tools";
  }, [isSuccess]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-7xl">
        {!isSuccess && <StoreHeader />}
        {isSuccess ? <SuccessView sku={sku} /> : <CatalogView />}
      </div>
    </div>
  );
}
