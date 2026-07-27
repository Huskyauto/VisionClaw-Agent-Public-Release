import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/queryClient";
import { Loader2, DollarSign, Copy, Check, Mail, Link2, Receipt, User } from "lucide-react";

interface Product {
  sku: string;
  productName: string;
  priceCents: number;
  priceFormatted: string;
  kind: "static" | "service";
}

interface CreatedLink {
  url: string;
  amountCents: number;
  description: string;
  emailSubject: string;
  emailBody: string;
}

interface ReceiptRecord {
  id: string;
  receiptNo: string;
  createdAt: number;
  company: string;
  contactName: string;
  email: string;
  description: string;
  amountCents: number;
  paymentMethod: "stripe" | "check";
  checkNumber?: string;
  paidDate: string;
  copiedTo: string | null;
  emailStatus: "sent" | "failed";
}

const PRESETS: { label: string; description: string; amountCents: number }[] = [
  { label: "AI Readiness Audit — $497", description: "AI Readiness Audit (comprehensive PDF report)", amountCents: 49700 },
  { label: "AI Audit Done-For-You — $1,997", description: "AI Readiness Audit — Done-For-You implementation", amountCents: 199700 },
  { label: "Custom Research Report — $49", description: "Custom AI Research Report (PDF)", amountCents: 4900 },
];

export default function AdminPaymentLinksPage() {
  const qc = useQueryClient();
  // Customer details (shared by the payment link + the receipt)
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  // Sale details (shared)
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  // Payment link state
  const [creating, setCreating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState<"link" | "email" | null>(null);
  // Receipt state
  const [method, setMethod] = useState<"stripe" | "check">("stripe");
  const [checkNumber, setCheckNumber] = useState("");
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptSent, setReceiptSent] = useState<ReceiptRecord | null>(null);

  const { data } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/admin/income/products"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/income/products");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: receiptData } = useQuery<{ receipts: ReceiptRecord[] }>({
    queryKey: ["/api/admin/income/receipts"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/income/receipts");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const amountCents = Math.round(parseFloat(amount) * 100);
  const customerComplete = company.trim() && contactName.trim() && phone.trim() && customerEmail.trim();

  function applyPreset(desc: string, cents: number) {
    setDescription(desc);
    setAmount((cents / 100).toFixed(2));
    setCreated(null);
    setLinkError(null);
  }

  async function createLink() {
    if (!description.trim() || !Number.isFinite(amountCents) || amountCents < 50) {
      setLinkError("Enter a description and a valid amount (at least $0.50).");
      return;
    }
    setCreating(true);
    setLinkError(null);
    setCreated(null);
    try {
      const res = await authFetch("/api/admin/income/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          amountCents,
          customerEmail: customerEmail.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not create the payment link");
      setCreated(data as CreatedLink);
    } catch (e: any) {
      setLinkError(e?.message || "Could not create the payment link");
    } finally {
      setCreating(false);
    }
  }

  async function sendReceipt() {
    if (!customerComplete) {
      setReceiptError("Fill in the customer details first (company, contact, phone, email).");
      return;
    }
    if (!description.trim() || !Number.isFinite(amountCents) || amountCents < 50) {
      setReceiptError("Enter the sale description and a valid amount first.");
      return;
    }
    setSendingReceipt(true);
    setReceiptError(null);
    setReceiptSent(null);
    try {
      const res = await authFetch("/api/admin/income/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: company.trim(),
          contactName: contactName.trim(),
          phone: phone.trim(),
          email: customerEmail.trim(),
          description: description.trim(),
          amountCents,
          paymentMethod: method,
          checkNumber: method === "check" ? checkNumber.trim() || null : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The receipt may still have been saved (e.g. email failure) — refresh the list either way.
        qc.invalidateQueries({ queryKey: ["/api/admin/income/receipts"] });
        throw new Error(data?.error || "Could not send the receipt");
      }
      setReceiptSent(data.receipt as ReceiptRecord);
      qc.invalidateQueries({ queryKey: ["/api/admin/income/receipts"] });
    } catch (e: any) {
      setReceiptError(e?.message || "Could not send the receipt");
    } finally {
      setSendingReceipt(false);
    }
  }

  async function copy(text: string, which: "link" | "email") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <DollarSign className="h-6 w-6" /> Get Paid
        </h1>
        <p className="text-muted-foreground mt-1">
          Fill in the customer once, then use the same details to send a payment link and an
          official receipt. Every receipt is emailed to the customer with a duplicate copy to your inbox.
        </p>
      </div>

      {/* Step 1: customer */}
      <Card data-testid="card-customer">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> 1. Customer details</CardTitle>
          <CardDescription>Used on both the payment link email and the receipt.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} data-testid="input-company" />
          <Input placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} data-testid="input-contact-name" />
          <Input placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-phone" />
          <Input placeholder="Email address" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} data-testid="input-email" />
        </CardContent>
      </Card>

      {/* Step 2: sale */}
      <Card data-testid="card-sale">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> 2. What they're paying for</CardTitle>
          <CardDescription>Pick a product or type your own description and price.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => applyPreset(p.description, p.amountCents)} data-testid={`button-preset-${p.amountCents}`}>
                {p.label}
              </Button>
            ))}
            {(data?.products || []).filter((p) => p.kind === "static").map((p) => (
              <Button key={p.sku} variant="outline" size="sm" onClick={() => applyPreset(p.productName, p.priceCents)} data-testid={`button-preset-${p.sku}`}>
                {p.productName} — {p.priceFormatted}
              </Button>
            ))}
          </div>
          <Input placeholder="Description (shown on the checkout page and receipt)" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-link-description" />
          <Input placeholder="Amount in dollars, e.g. 497" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" data-testid="input-link-amount" />
        </CardContent>
      </Card>

      {/* Step 3a: payment link */}
      <Card data-testid="card-payment-link">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" /> 3a. Paying by card? Send a payment link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={createLink} disabled={creating || !description.trim() || !amount.trim()} data-testid="button-create-link">
            {creating ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating…</> : "Create Payment Link"}
          </Button>
          {linkError && <p className="text-sm text-destructive" data-testid="text-link-error">{linkError}</p>}
          {created && (
            <div className="border rounded-md p-4 space-y-3" data-testid="section-created-link">
              <p className="font-medium flex items-center gap-2 text-green-600">
                <Check className="h-4 w-4" /> Link ready — ${(created.amountCents / 100).toFixed(2)} for "{created.description}"
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={created.url} className="font-mono text-xs" data-testid="input-created-url" />
                <Button variant="outline" size="sm" onClick={() => copy(created.url, "link")} data-testid="button-copy-link">
                  {copied === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Textarea readOnly value={created.emailBody} rows={8} className="text-sm" data-testid="textarea-email-body" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => copy(created.emailBody, "email")} data-testid="button-copy-email">
                  {copied === "email" ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />} Copy email text
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.location.href = `mailto:${encodeURIComponent(customerEmail.trim())}?subject=${encodeURIComponent(created.emailSubject)}&body=${encodeURIComponent(created.emailBody)}`;
                  }}
                  data-testid="button-open-mail"
                >
                  <Mail className="h-4 w-4 mr-1" /> Open in email app
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">After they pay, come back here and send the receipt below.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3b: receipt */}
      <Card data-testid="card-receipt">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> 3b. Payment received? Send the receipt</CardTitle>
          <CardDescription>
            Works for both card and check payments. The customer gets an official receipt by email,
            and a duplicate copy goes to your inbox automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant={method === "stripe" ? "default" : "outline"} size="sm" onClick={() => setMethod("stripe")} data-testid="button-method-stripe">
              Paid by card (Stripe)
            </Button>
            <Button variant={method === "check" ? "default" : "outline"} size="sm" onClick={() => setMethod("check")} data-testid="button-method-check">
              Paid by check
            </Button>
          </div>
          {method === "check" && (
            <Input placeholder="Check number (optional)" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} className="max-w-xs" data-testid="input-check-number" />
          )}
          <Button onClick={sendReceipt} disabled={sendingReceipt} data-testid="button-send-receipt">
            {sendingReceipt ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending…</> : "Email Receipt (customer + your copy)"}
          </Button>
          {receiptError && <p className="text-sm text-destructive" data-testid="text-receipt-error">{receiptError}</p>}
          {receiptSent && (
            <p className="text-sm text-green-600 flex items-center gap-2" data-testid="text-receipt-sent">
              <Check className="h-4 w-4" /> Receipt {receiptSent.receiptNo} sent to {receiptSent.email}
              {receiptSent.copiedTo ? ` — copy delivered to ${receiptSent.copiedTo}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent receipts */}
      <Card data-testid="card-recent-receipts">
        <CardHeader>
          <CardTitle>Recent receipts</CardTitle>
          <CardDescription>Your last 50 receipts (each was also emailed to you as a backup).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(receiptData?.receipts || []).length === 0 && <p className="text-sm text-muted-foreground">No receipts yet.</p>}
          {(receiptData?.receipts || []).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 border rounded-md p-2 text-sm flex-wrap" data-testid={`row-receipt-${r.receiptNo}`}>
              <div className="min-w-0">
                <span className="font-medium">{r.receiptNo}</span>
                <span className="text-muted-foreground"> — {r.company} ({r.contactName})</span>
                <p className="text-xs text-muted-foreground truncate">{r.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary">${(r.amountCents / 100).toFixed(2)}</Badge>
                <Badge variant="outline">{r.paymentMethod === "check" ? `Check${r.checkNumber ? " #" + r.checkNumber : ""}` : "Card"}</Badge>
                {r.emailStatus === "failed" && <Badge className="bg-destructive text-destructive-foreground">email failed</Badge>}
                <span className="text-xs text-muted-foreground">{r.paidDate}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
