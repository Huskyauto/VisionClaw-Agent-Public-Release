import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CreditCard, Package, Plus, ExternalLink, Loader2, DollarSign, CheckCircle, XCircle, Clock, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ErrorState } from "@/components/error-state";

interface StripePrice {
  id: string;
  unit_amount: number;
  currency: string;
  recurring: any;
  active: boolean;
}

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  metadata: any;
  images: string[];
  prices: StripePrice[];
}

interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
}

function formatCurrency(amount: number, currency: string = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function PaymentStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
    succeeded: { variant: "default", icon: CheckCircle },
    canceled: { variant: "destructive", icon: XCircle },
    requires_payment_method: { variant: "outline", icon: Clock },
    processing: { variant: "secondary", icon: Loader2 },
  };
  const config = variants[status] || { variant: "outline" as const, icon: Clock };
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1" data-testid={`badge-payment-status-${status}`}>
      <Icon className="w-3 h-3" />
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function CreateProductDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [recurring, setRecurring] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/create-product", {
        name,
        description: description || undefined,
        price: parseFloat(price),
        currency,
        recurring: recurring || undefined,
      });
      return await res.json();
    },
    onSuccess: (data) => {
      toast({ description: `Created "${data.product.name}" with price ${formatCurrency(data.price.unit_amount, data.price.currency)}` });
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/products"] });
      setOpen(false);
      setName("");
      setDescription("");
      setPrice("");
      setRecurring("");
    },
    onError: (err: any) => {
      toast({ description: err.message || "Failed to create product", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-product" className="gap-2">
          <Plus className="w-4 h-4" /> Create Product
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Product</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label>Product Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. VisionClaw Pro"
              data-testid="input-product-name"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this product include?"
              rows={2}
              data-testid="input-product-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Price</Label>
              <Input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="29.99"
                data-testid="input-product-price"
              />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger data-testid="select-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="usd">USD</SelectItem>
                  <SelectItem value="eur">EUR</SelectItem>
                  <SelectItem value="gbp">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Billing Type</Label>
            <Select value={recurring || "one_time"} onValueChange={(v) => setRecurring(v === "one_time" ? "" : v)}>
              <SelectTrigger data-testid="select-billing-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one_time">One-time payment</SelectItem>
                <SelectItem value="month">Monthly subscription</SelectItem>
                <SelectItem value="year">Annual subscription</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full"
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || !price || createMutation.isPending}
            data-testid="button-submit-product"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Create Product
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductCard({ product }: { product: StripeProduct }) {
  const { toast } = useToast();

  const checkoutMutation = useMutation({
    mutationFn: async (priceId: string) => {
      const price = product.prices.find(p => p.id === priceId);
      const mode = price?.recurring ? "subscription" : "payment";
      const res = await apiRequest("POST", "/api/stripe/checkout", { priceId, mode });
      return await res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.assign(data.url);
    },
    onError: (err: any) => {
      toast({ description: err.message || "Checkout failed", variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`card-product-${product.id}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{product.name}</CardTitle>
            {product.description && (
              <CardDescription className="mt-1">{product.description}</CardDescription>
            )}
          </div>
          <Package className="w-5 h-5 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        {product.prices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No prices configured</p>
        ) : (
          <div className="space-y-2">
            {product.prices.map((price) => (
              <div key={price.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <div>
                  <span className="font-semibold text-lg" data-testid={`text-price-${price.id}`}>
                    {formatCurrency(price.unit_amount, price.currency)}
                  </span>
                  {price.recurring && (
                    <span className="text-sm text-muted-foreground ml-1">
                      /{price.recurring.interval}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => checkoutMutation.mutate(price.id)}
                  disabled={checkoutMutation.isPending}
                  data-testid={`button-checkout-${price.id}`}
                >
                  {checkoutMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ShoppingCart className="w-3 h-3" />
                  )}
                  Buy
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PaymentsPage() {
  const [location] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(location.split("?")[1] || "");
  const status = params.get("status");

  const productsQuery = useQuery<{ products: StripeProduct[] }>({
    queryKey: ["/api/stripe/products"],
  });
  const { data: productsData, isLoading: productsLoading } = productsQuery;

  const { data: paymentsData, isLoading: paymentsLoading } = useQuery<{ payments: PaymentIntent[] }>({
    queryKey: ["/api/stripe/payments"],
  });

  const products = productsData?.products || [];
  const payments = paymentsData?.payments || [];

  useEffect(() => {
    if (status === "success") {
      toast({ description: "Payment successful! Thank you." });
      window.history.replaceState({}, "", "/payments");
    }
  }, [status]);

  if (productsQuery.isError) return <ErrorState title="Payments Error" message="Failed to load payment data. Please try again." onRetry={() => productsQuery.refetch()} />;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <CreditCard className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold" data-testid="text-payments-title">Payments</h1>
            <p className="text-sm text-muted-foreground">Manage products, pricing, and transactions</p>
          </div>
        </div>
        <CreateProductDialog />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Tabs defaultValue="products">
          <TabsList data-testid="tabs-payments">
            <TabsTrigger value="products" data-testid="tab-products">
              <Package className="w-4 h-4 mr-1.5" /> Products
            </TabsTrigger>
            <TabsTrigger value="transactions" data-testid="tab-transactions">
              <DollarSign className="w-4 h-4 mr-1.5" /> Transactions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="products" className="mt-4">
            {productsLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="animate-pulse">
                    <CardHeader><div className="h-5 bg-muted rounded w-32" /><div className="h-3 bg-muted rounded w-48 mt-2" /></CardHeader>
                    <CardContent><div className="h-10 bg-muted rounded" /></CardContent>
                  </Card>
                ))}
              </div>
            ) : products.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h3 className="font-medium mb-1">No products yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create your first product to start accepting payments
                  </p>
                  <CreateProductDialog />
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="products-grid">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="transactions" className="mt-4">
            {paymentsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : payments.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <DollarSign className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h3 className="font-medium mb-1">No transactions yet</h3>
                  <p className="text-sm text-muted-foreground">
                    Transactions will appear here once customers make purchases
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2" data-testid="transactions-list">
                {payments.map((payment) => (
                  <Card key={payment.id} data-testid={`card-payment-${payment.id}`}>
                    <CardContent className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">
                            {formatCurrency(payment.amount, payment.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(payment.created * 1000).toLocaleDateString("en-US", {
                              month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                      <PaymentStatusBadge status={payment.status} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
