import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ImportResult = { imported: Record<string, number>; rejected: Record<string, number> };
export function usePlatformImport(onResult: (result: ImportResult) => void) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: unknown) => {
      const response = await apiRequest("POST", "/api/import", data);
      return response.json();
    },
    onSuccess: (data) => {
      const rejected = data.rejected ?? {};
      onResult({ imported: data.imported, rejected });
      queryClient.invalidateQueries();
      const count = Object.values(rejected).reduce<number>((sum, value) => sum + Number(value), 0);
      toast({ description: data.success === false || count > 0
        ? `Import partially completed. ${count} record(s) rejected; review the results before importing again.`
        : "Import completed successfully", variant: data.success === false || count > 0 ? "destructive" : "default" });
    },
    onError: () => toast({ description: "Import failed", variant: "destructive" }),
  });
}
