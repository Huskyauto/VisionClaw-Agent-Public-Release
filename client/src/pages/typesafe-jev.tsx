import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Status = { typesafeJev?: { configured: boolean; enabled: boolean; ready: boolean } };
export default function TypeSafeJevPage() {
  const { data, isLoading } = useQuery<Status>({ queryKey: ["/api/setup/status"] });
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
          <p className="text-sm text-muted-foreground">Activation requires an operator-configured API key and the exact server flag <code>TYPESAFE_JEV_ENABLED=1</code>. Credentials are never shown here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
function StatusBadge({ label, value }: { label: string; value?: boolean }) {
  return <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{label}</div><Badge variant={value ? "default" : "secondary"}>{value === undefined ? "Checking…" : value ? "Yes" : "No"}</Badge></div>;
}