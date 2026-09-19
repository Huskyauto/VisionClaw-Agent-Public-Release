import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";

type Status = { typesafeJev?: { configured: boolean; enabled: boolean; ready: boolean } };
export default function TypeSafeJevPage() {
  const { data, isLoading, isFetching, refetch } = useQuery<Status>({
    queryKey: ["/api/setup/status"],
    refetchInterval: 30_000,
  });
  const configured = data?.typesafeJev?.configured;
  const enabled = data?.typesafeJev?.enabled;
  const ready = data?.typesafeJev?.ready;
  return (
    <div className="container max-w-3xl py-8">
      <Card>
        <CardHeader>
          <CardTitle>TypeSafe Jev</CardTitle>
          <CardDescription>Bounded advisory analysis. Jev cannot authorize actions or bypass platform safety gates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatusBadge label="Configured" value={isLoading ? undefined : configured} />
            <StatusBadge label="Enabled" value={enabled} />
            <StatusBadge label="Ready" value={ready} />
          </div>
          <div className="rounded-md border p-4">
            <h2 className="font-medium">When TypeSafe sends your API key</h2>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Open this Replit workspace&apos;s <strong>Secrets</strong> tool.</li>
              <li>Add the secret <code>TYPESAFE_API_KEY</code> and paste the key as its value.</li>
              <li>Add <code>TYPESAFE_JEV_ENABLED</code> with the exact value <code>1</code>.</li>
              <li>Restart the application, then return here. Ready will change to Yes automatically.</li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">Enter the key only in Replit Secrets—never in this page, chat, source code, or a regular environment file.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href="https://typesafe.ai/" target="_blank" rel="noopener noreferrer">
                Open TypeSafe waitlist <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              {isFetching ? "Checking…" : "Check readiness"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">On the TypeSafe homepage, tap <strong>Join Waitlist</strong> to check or submit your access request.</p>
          <p className="text-sm text-muted-foreground">Jev stays off unless both settings are present. Credentials are never returned by the status endpoint or shown here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
function StatusBadge({ label, value }: { label: string; value?: boolean }) {
  return <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{label}</div><Badge variant={value ? "default" : "secondary"}>{value === undefined ? "Checking…" : value ? "Yes" : "No"}</Badge></div>;
}