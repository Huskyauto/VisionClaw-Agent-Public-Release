import { useEffect, useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, ArrowLeft, Download, ExternalLink, Mail, Clock, AlertCircle, RefreshCw, Bookmark, Copy, Check } from "lucide-react";

interface OrderResponse {
  sessionId: string;
  productName: string;
  fileName: string;
  downloadLink: string | null;
  shareableLink: string | null;
  folderLink: string | null;
  appPlayLink: string | null;
  emailSent: boolean;
  status: string;
  customerEmailMasked: string | null;
  createdAt: string;
  completedAt: string | null;
}

export default function OrderPage() {
  const [, params] = useRoute("/orders/:sessionId");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const sessionId = params?.sessionId || "";
  const [copied, setCopied] = useState(false);
  const orderPageUrl = typeof window !== "undefined" && sessionId
    ? `${window.location.origin}/orders/${sessionId}`
    : "";

  async function handleCopyLink() {
    if (!orderPageUrl) return;
    try {
      await navigator.clipboard.writeText(orderPageUrl);
      setCopied(true);
      toast({ title: "Link copied", description: "Paste it anywhere to come back to this order." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Long-press the link to copy it manually.",
        variant: "destructive",
      });
    }
  }

  const { data, isLoading, error, refetch, isFetching } = useQuery<OrderResponse>({
    queryKey: ["/api/store/order", sessionId],
    enabled: !!sessionId,
    // Delivery happens asynchronously via Stripe webhook. Poll until
    // we see a terminal status so the customer's page lights up the
    // moment the file is ready.
    refetchInterval: (query) => {
      const d = query.state.data as OrderResponse | undefined;
      if (!d) return 3000;
      if (d.status === "delivered" || d.status === "completed" || d.status === "failed") return false;
      return 3000;
    },
  });

  useEffect(() => {
    document.title = data?.productName
      ? `Order — ${data.productName}`
      : "Your Order — VisionClaw Store";
  }, [data?.productName]);

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle data-testid="text-missing-session">Missing order ID</CardTitle>
            <CardDescription>This link is incomplete. Check your delivery email for the correct URL.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/store")} variant="outline" data-testid="button-back-to-store">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to store
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPending = !data || data.status === "pending" || data.status === "in_progress";
  const isFailed = data?.status === "failed";
  const isReady = !!data && (data.status === "delivered" || data.status === "completed");

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="mb-6">
          <Button onClick={() => navigate("/store")} variant="ghost" size="sm" data-testid="button-back-to-store">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to store
          </Button>
        </div>

        <Card data-testid="card-order">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-2xl" data-testid="text-order-title">
                  {isReady ? "Your download is ready" : isFailed ? "Delivery problem" : "Preparing your download…"}
                </CardTitle>
                <CardDescription className="mt-2" data-testid="text-order-product">
                  {data?.productName || "Loading purchase details…"}
                </CardDescription>
              </div>
              {isReady && <CheckCircle2 className="h-8 w-8 text-emerald-500 shrink-0" data-testid="icon-ready" />}
              {isFailed && <AlertCircle className="h-8 w-8 text-destructive shrink-0" data-testid="icon-failed" />}
              {isPending && !isLoading && <Clock className="h-8 w-8 text-muted-foreground shrink-0" data-testid="icon-pending" />}
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {isLoading && (
              <div className="flex items-center justify-center py-10" data-testid="state-loading">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {error && !data && (
              <div className="text-sm text-muted-foreground" data-testid="text-not-found">
                We couldn't find this order yet. Stripe payments can take up to a minute to process — try again shortly.
                <div className="mt-3">
                  <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-retry">
                    <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Check again
                  </Button>
                </div>
              </div>
            )}

            {data && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={isReady ? "default" : isFailed ? "destructive" : "secondary"} data-testid="badge-status">
                    {data.status}
                  </Badge>
                  {data.emailSent && (
                    <Badge variant="outline" data-testid="badge-email-sent">
                      <Mail className="h-3 w-3 mr-1" /> Email sent
                    </Badge>
                  )}
                </div>

                <div className="text-sm space-y-1 text-muted-foreground">
                  <div data-testid="text-file-name">
                    <span className="text-foreground font-medium">File:</span> {data.fileName}
                  </div>
                  {data.customerEmailMasked && (
                    <div data-testid="text-customer-email">
                      <span className="text-foreground font-medium">Delivered to:</span> {data.customerEmailMasked}
                    </div>
                  )}
                </div>

                {isReady && (data.appPlayLink || data.downloadLink || data.shareableLink || data.folderLink) && (
                  <div className="flex flex-col gap-2 pt-2 border-t">
                    {data.appPlayLink ? (
                      <>
                        <Button asChild data-testid="button-open-app">
                          {/* appPlayLink is a SIGNED URL that already carries ?tid&exp&sig — append
                              mode params with the correct separator so the sig value isn't corrupted. */}
                          <a href={`${data.appPlayLink}${data.appPlayLink.includes("?") ? "&" : "?"}play=1`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2" /> Open App in Browser
                          </a>
                        </Button>
                        <Button asChild variant="outline" data-testid="button-download">
                          <a href={`${data.appPlayLink}${data.appPlayLink.includes("?") ? "&" : "?"}dl=1`}>
                            <Download className="h-4 w-4 mr-2" /> Download to Keep Offline
                          </a>
                        </Button>
                      </>
                    ) : data.downloadLink && (
                      <Button asChild data-testid="button-download">
                        <a href={data.downloadLink} target="_blank" rel="noopener noreferrer">
                          <Download className="h-4 w-4 mr-2" /> Download file
                        </a>
                      </Button>
                    )}
                    {data.shareableLink && (
                      <Button asChild variant="outline" data-testid="button-share-link">
                        <a href={data.shareableLink} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-2" /> Open share link
                        </a>
                      </Button>
                    )}
                    {data.folderLink && (
                      <Button asChild variant="outline" data-testid="button-folder-link">
                        <a href={data.folderLink} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-2" /> Open folder
                        </a>
                      </Button>
                    )}
                  </div>
                )}

                {isPending && (
                  <div className="text-sm text-muted-foreground border-t pt-4" data-testid="text-pending-help">
                    We're packaging your file and uploading it now. This page will update automatically — you can also check your inbox for the delivery email.
                  </div>
                )}

                {isFailed && (
                  <div className="text-sm border-t pt-4 space-y-2" data-testid="text-failed-help">
                    <p className="text-destructive">Something went wrong delivering your file.</p>
                    <p className="text-muted-foreground">
                      Your payment was received. Please email <a className="underline" href="/contact">support</a> with this order ID and we'll get your file to you right away:
                    </p>
                    <code className="block text-xs bg-muted p-2 rounded break-all" data-testid="text-session-id">{data.sessionId}</code>
                  </div>
                )}

              </>
            )}
          </CardContent>
        </Card>

        <div className="mt-6" data-testid="section-bookmark">
          <div className="rounded-md border bg-muted/40 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Bookmark className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold" data-testid="text-bookmark-title">
                  Bookmark your order page
                </p>
                <p className="text-xs text-muted-foreground" data-testid="text-bookmark-description">
                  Save this link before you leave — you can come back any time to re-download your purchase, even if you lose the email.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <a
                href={orderPageUrl}
                className="flex-1 text-xs underline break-all bg-background border rounded px-3 py-2"
                data-testid="link-order-page"
              >
                {orderPageUrl}
              </a>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCopyLink}
                data-testid="button-copy-order-link"
              >
                {copied ? (
                  <><Check className="h-4 w-4 mr-2" /> Copied</>
                ) : (
                  <><Copy className="h-4 w-4 mr-2" /> Copy link</>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/store" className="underline" data-testid="link-store">Browse more products</Link>
        </div>
      </div>
    </div>
  );
}
