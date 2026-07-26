import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Archive } from "lucide-react";

interface Order {
  id: number;
  org_name: string;
  org_type: string;
  contact_email: string;
  contact_name: string | null;
  tier: string;
  status: string;
  pages_quota: number;
  pages_used: number;
  stripe_session_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  demo_chars: number;
}

const STATUSES = ["demo_requested", "demo_delivered", "paid", "in_progress", "delivered", "cancelled"];

export default function AdminArchiveRescuePage() {
  const { toast } = useToast();
  const [pin, setPin] = useState<string>(() => sessionStorage.getItem("archive-rescue-pin") || "");
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<{ total: number; byStatus: Record<string, number>; byTier: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(false);

  async function load() {
    if (!pin) { toast({ title: "PIN required" }); return; }
    setLoading(true);
    try {
      const r = await fetch("/api/admin/archive-rescue/orders", { headers: { "x-admin-pin": pin } });
      if (r.status === 403) { setAuthed(false); toast({ title: "Wrong PIN", variant: "destructive" }); return; }
      if (r.status === 429) { toast({ title: "Locked out", description: "Too many PIN attempts.", variant: "destructive" }); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setOrders(j.orders || []);
      setSummary({ total: j.total, byStatus: j.byStatus, byTier: j.byTier });
      setAuthed(true);
      sessionStorage.setItem("archive-rescue-pin", pin);
    } catch (e: any) {
      toast({ title: "Load failed", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  }

  async function setStatus(id: number, status: string) {
    try {
      const r = await fetch(`/api/admin/archive-rescue/orders/${id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-admin-pin": pin },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast({ title: `Order #${id} → ${status}` });
      load();
    } catch (e: any) { toast({ title: "Update failed", description: e?.message, variant: "destructive" }); }
  }

  if (!authed) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-md">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Archive className="h-5 w-5" /> Archive Rescue Admin</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="pin">Admin PIN</Label>
              <Input id="pin" data-testid="input-admin-pin" type="password" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => { if (e.key === "Enter") load(); }} />
            </div>
            <Button onClick={load} disabled={loading} className="w-full" data-testid="button-load-orders">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Load orders
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2"><Archive className="h-7 w-7" /> Archive Rescue Queue</h1>
        <Button onClick={load} variant="outline" size="sm" disabled={loading} data-testid="button-refresh">
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}Refresh
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Total</div><div className="text-2xl font-bold" data-testid="stat-total">{summary.total}</div></CardContent></Card>
          {STATUSES.map(s => (
            <Card key={s}><CardContent className="pt-6"><div className="text-xs text-muted-foreground capitalize">{s.replace(/_/g, " ")}</div><div className="text-2xl font-bold" data-testid={`stat-status-${s}`}>{summary.byStatus[s] || 0}</div></CardContent></Card>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {orders.length === 0 ? (
          <Card><CardContent className="pt-6 text-center text-muted-foreground">No orders yet. Pipeline ready and listening.</CardContent></Card>
        ) : orders.map(o => (
          <Card key={o.id} data-testid={`row-order-${o.id}`}>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold" data-testid={`text-org-${o.id}`}>{o.org_name}</span>
                    <Badge variant="outline">{o.org_type}</Badge>
                    <Badge>{o.tier}</Badge>
                    <Badge variant={o.status === "delivered" ? "default" : "secondary"} data-testid={`text-status-${o.id}`}>{o.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <span className="font-mono">{o.contact_email}</span>
                    {o.contact_name ? ` · ${o.contact_name}` : ""}
                    {" · "}{new Date(o.created_at).toLocaleString()}
                    {o.demo_chars > 0 ? ` · OCR: ${o.demo_chars.toLocaleString()} chars` : ""}
                    {o.pages_quota > 0 ? ` · ${o.pages_used}/${o.pages_quota} pages` : ""}
                  </div>
                  {o.notes && <div className="text-sm mt-2 italic">"{o.notes}"</div>}
                  {o.stripe_session_id && <div className="text-xs font-mono text-muted-foreground mt-1">stripe: {o.stripe_session_id}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Select value={o.status} onValueChange={v => setStatus(o.id, v)}>
                    <SelectTrigger className="w-40" data-testid={`select-status-${o.id}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
