import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/queryClient";
import { Loader2, Package, Download } from "lucide-react";

interface ProductFile {
  index: number;
  fileName: string;
  description?: string;
}

interface Product {
  sku: string;
  productName: string;
  priceFormatted: string;
  tagline: string;
  kind: "static" | "service";
  files: ProductFile[];
}

async function downloadFile(sku: string, index: number, fileName: string) {
  const res = await authFetch(`/api/admin/income/products/${encodeURIComponent(sku)}/download/${index}`);
  if (!res.ok) return;
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function AdminDigitalProductsPage() {
  const { data, isLoading } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/admin/income/products"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/income/products");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const staticProducts = (data?.products || []).filter((p) => p.kind === "static");

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="h-6 w-6" /> Digital Products
        </h1>
        <p className="text-muted-foreground mt-1">
          Every product from your store, downloadable free under admin — exactly the same files
          customers receive after paying. Use them for demos, prospects, or your own use.
        </p>
      </div>

      {isLoading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}

      {staticProducts.map((p) => (
        <Card key={p.sku} data-testid={`card-product-${p.sku}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 flex-wrap">
              {p.productName}
              <Badge variant="secondary">{p.priceFormatted}</Badge>
              <Badge className="bg-green-600 text-white">Free for you</Badge>
            </CardTitle>
            <CardDescription>{p.tagline}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.files.map((f) => (
              <div key={f.index} className="flex items-center justify-between gap-2 border rounded-md p-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{f.fileName}</span>
                  {f.description && <p className="text-muted-foreground text-xs">{f.description}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => downloadFile(p.sku, f.index, f.fileName)} data-testid={`button-download-${p.sku}-${f.index}`}>
                  <Download className="h-4 w-4 mr-1" /> Download
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {!isLoading && staticProducts.length === 0 && (
        <p className="text-muted-foreground">No static products found in the catalog.</p>
      )}
    </div>
    </div>
  );
}
