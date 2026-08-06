import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Power } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SystemStateResp = {
  system?: { backgroundHalted?: boolean; haltedAt?: number; haltedBy?: string; reason?: string };
  concurrency?: { chat?: { active: number }; background?: { active: number; max: number } };
};

export function HaltToggle() {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<SystemStateResp>({
    queryKey: ["/api/admin/system-state"],
    refetchInterval: 7000,
    retry: false,
    staleTime: 4000,
  });

  const isAdmin = !isError && !!data;
  const halted = !!data?.system?.backgroundHalted;

  const flip = useMutation({
    mutationFn: async (nextHalted: boolean) => {
      const url = nextHalted ? "/api/admin/halt-background" : "/api/admin/resume-background";
      const body = nextHalted ? { halted: true, reason: "owner toggle (UI)" } : {};
      const res = await apiRequest("POST", url, body);
      return res.json();
    },
    onSuccess: (_resp, nextHalted) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-state"] });
      toast({
        title: nextHalted ? "Background work HALTED" : "Background work RESUMED",
        description: nextHalted
          ? "Heartbeat, scheduled tasks, and agent delegations are paused. Live chat is unaffected."
          : "Heartbeat and background operators are running again.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Toggle failed",
        description: err?.message || "Could not change system state.",
        variant: "destructive",
      });
    },
  });

  if (!isAdmin && !isLoading) return null;
  if (isLoading) return null;

  const onClick = () => {
    if (halted) {
      flip.mutate(false);
    } else {
      setConfirmOpen(true);
    }
  };

  const busy = flip.isPending;
  const label = halted ? "STOPPED" : "RUNNING";
  const colorClass = halted
    ? "bg-red-600 hover:bg-red-700 text-white border-red-700"
    : "bg-green-600 hover:bg-green-700 text-white border-green-700";

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        role="switch"
        aria-checked={!halted}
        aria-pressed={halted}
        aria-label={halted ? "Background work is stopped. Click to resume." : "Background work is running. Click to stop."}
        data-testid="button-halt-toggle"
        title={halted ? "Background work is STOPPED — click to resume" : "Background work is RUNNING — click to stop"}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${colorClass}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
        <span data-testid="text-halt-state">{label}</span>
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop all background work?</AlertDialogTitle>
            <AlertDialogDescription>
              This pauses the heartbeat engine, scheduled tasks, and any agent delegations
              the platform is running on its own. Live chat is NOT affected — you can keep
              talking to agents normally. Click STOPPED again to resume.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-halt-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-halt-confirm"
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                setConfirmOpen(false);
                flip.mutate(true);
              }}
            >
              Yes, stop background work
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
