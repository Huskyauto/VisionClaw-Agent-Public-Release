export type ResearchFrontierListFilters = {
  page: number;
  limit: number;
  search?: string;
  maturity?: string;
  status?: string;
};

export function buildResearchFrontierListUrl(base: string, filters: ResearchFrontierListFilters): string {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: String(filters.limit),
  });
  const search = filters.search?.trim();
  if (search) params.set("q", search);
  if (filters.maturity) params.set("maturity", filters.maturity);
  if (filters.status) params.set("status", filters.status);
  return `${base}?${params.toString()}`;
}

export function clampResearchFrontierPage(page: number, total: number, limit: number): number {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  return Math.min(Math.max(1, page), pageCount);
}

export function buildResearchFrontierMutationRequest(
  base: string,
  options: {
    editing: boolean;
    selectedId: number | null;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  },
): { method: "POST" | "PATCH"; url: string; body: Record<string, unknown> } {
  const isUpdate = options.editing && options.selectedId !== null;
  return {
    method: isUpdate ? "PATCH" : "POST",
    url: isUpdate ? `${base}/${options.selectedId}` : base,
    body: isUpdate
      ? options.payload
      : { ...options.payload, idempotencyKey: options.idempotencyKey },
  };
}