import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

export interface SparkRelayData {
  enabled: boolean;
  worker: { ready: boolean; seenAt: string } | null;
  jobs: { id: number; status: string; task: string; transport: string; ledgerConfirmed: boolean;
    usage: { prompt_tokens: number; completion_tokens: number } | null }[];
}
export function SparkRelayStatus({ data }: { data: SparkRelayData }) {
  const [confirmation, setConfirmation] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: async (id: number | null) => {
      const url = id === null ? "/api/admin/legion-relay/probe" : `/api/admin/legion-relay/${id}/release`;
      const result = await apiRequest("POST", url, id === null ? {} : { confirmedStopped: true });
      return result.json();
    },
    onSuccess: () => {
      setConfirmation(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/local-maintenance"] });
    },
  });
  return <section className="space-y-3 rounded-md border p-3.5" aria-label="Spark Lenovo fallback">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-medium">Spark Lenovo fallback</h3>
        <p className="text-sm text-muted-foreground">
          {!data.enabled ? "Disabled. No Spark work will start." :
            data.worker?.ready ? "Worker recently checked in with the exact Mellum model." :
              "Worker offline or not ready. Direct Lenovo remains primary."}
        </p>
      </div>
      <Button size="sm" variant="outline" disabled={!data.enabled || !data.worker?.ready || mutation.isPending}
        onClick={() => mutation.mutate(null)}>Queue fixed 42 check</Button>
    </div>
    <p className="text-xs text-muted-foreground">Screened runbooks only, not chat or short memory tasks.
      A check-in is worker-reported evidence, not an end-to-end test.</p>
    {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    {mutation.isSuccess && <p role="status" className="text-sm">Request saved. Status below confirms the outcome.</p>}
    <ul className="space-y-2 text-xs">
      {data.jobs.slice(0, 6).map(job => <li key={job.id} className="rounded border p-2">
        <p>Receipt {job.id} · {job.task} · <strong>{job.status}</strong> · {job.transport} transport</p>
        {job.usage && <p>{job.usage.prompt_tokens} input / {job.usage.completion_tokens} output tokens ·
          Usage ledger {job.ledgerConfirmed ? "confirmed" : "not confirmed"}</p>}
        {job.status === "uncertain" && <div className="mt-2 space-y-2">
          <p className="text-destructive">Lenovo work may still be running. Further Lenovo generation is blocked.</p>
          {confirmation === job.id ? <>
            <p>Confirm on Lenovo that the old inference has stopped. Releasing this reservation permits new work.</p>
            <Button size="sm" variant="destructive" disabled={mutation.isPending}
              onClick={() => mutation.mutate(job.id)}>I confirmed the old work stopped</Button>
            <Button size="sm" variant="ghost" disabled={mutation.isPending}
              onClick={() => setConfirmation(null)}>Keep blocked</Button>
          </> : <Button size="sm" variant="outline" disabled={mutation.isPending}
            onClick={() => { mutation.reset(); setConfirmation(job.id); }}>Review blocked work</Button>}
        </div>}
      </li>)}
    </ul>
  </section>;
}
