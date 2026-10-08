const FIGMA_API_BASE = "https://api.figma.com/v1";

export interface FigmaResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

function getToken(): string | null {
  return process.env.FIGMA_TOKEN || process.env.FIGMA_PERSONAL_ACCESS_TOKEN || null;
}

async function figmaFetch<T = any>(path: string, opts?: { method?: string; body?: any }): Promise<FigmaResponse<T>> {
  const token = getToken();
  if (!token) {
    return { success: false, error: "FIGMA_TOKEN not configured. Bob needs to add a Figma personal access token (figma.com → Settings → Account → Personal access tokens) as the FIGMA_TOKEN secret." };
  }
  try {
    const res = await fetch(`${FIGMA_API_BASE}${path}`, {
      method: opts?.method || "GET",
      headers: {
        "X-Figma-Token": token,
        "Content-Type": "application/json",
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `Figma API ${res.status}: ${text.slice(0, 300)}`, status: res.status };
    }
    const data = await res.json() as T;
    return { success: true, data, status: res.status };
  } catch (err: any) {
    return { success: false, error: `Figma fetch failed: ${err.message}` };
  }
}

function parseFigmaUrl(input: string): { fileKey?: string; nodeId?: string } {
  if (!input) return {};
  const fileMatch = input.match(/figma\.com\/(?:design|file|board|make)\/([A-Za-z0-9]+)/);
  const nodeMatch = input.match(/[?&]node-id=([0-9A-Za-z\-_:%]+)/);
  const out: { fileKey?: string; nodeId?: string } = {};
  if (fileMatch) out.fileKey = fileMatch[1];
  if (nodeMatch) out.nodeId = decodeURIComponent(nodeMatch[1]).replace(/-/g, ":");
  return out;
}

export function normalizeFigmaInput(params: { fileKey?: string; nodeId?: string; url?: string }): { fileKey?: string; nodeId?: string } {
  if (params.url) {
    const parsed = parseFigmaUrl(params.url);
    return {
      fileKey: params.fileKey || parsed.fileKey,
      nodeId: params.nodeId || parsed.nodeId,
    };
  }
  return { fileKey: params.fileKey, nodeId: params.nodeId };
}

export async function getFile(fileKey: string, opts?: { depth?: number; ids?: string[] }): Promise<FigmaResponse> {
  const qs = new URLSearchParams();
  if (opts?.depth) qs.set("depth", String(opts.depth));
  if (opts?.ids?.length) qs.set("ids", opts.ids.join(","));
  const q = qs.toString();
  return figmaFetch(`/files/${fileKey}${q ? "?" + q : ""}`);
}

export async function getNodes(fileKey: string, nodeIds: string[]): Promise<FigmaResponse> {
  if (!nodeIds.length) return { success: false, error: "nodeIds required" };
  return figmaFetch(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeIds.join(","))}`);
}

export async function renderImages(fileKey: string, nodeIds: string[], opts?: { format?: "png" | "svg" | "jpg" | "pdf"; scale?: number }): Promise<FigmaResponse<{ images: Record<string, string> }>> {
  if (!nodeIds.length) return { success: false, error: "nodeIds required" };
  const qs = new URLSearchParams({ ids: nodeIds.join(",") });
  qs.set("format", opts?.format || "png");
  if (opts?.scale) qs.set("scale", String(opts.scale));
  return figmaFetch(`/images/${fileKey}?${qs.toString()}`);
}

export async function getComponents(fileKey: string): Promise<FigmaResponse> {
  return figmaFetch(`/files/${fileKey}/components`);
}

export async function getStyles(fileKey: string): Promise<FigmaResponse> {
  return figmaFetch(`/files/${fileKey}/styles`);
}

export async function getComments(fileKey: string): Promise<FigmaResponse> {
  return figmaFetch(`/files/${fileKey}/comments`);
}

export async function postComment(fileKey: string, message: string, clientMeta?: { node_id?: string; node_offset?: { x: number; y: number } }): Promise<FigmaResponse> {
  return figmaFetch(`/files/${fileKey}/comments`, {
    method: "POST",
    body: { message, client_meta: clientMeta },
  });
}

export async function getMe(): Promise<FigmaResponse> {
  return figmaFetch(`/me`);
}

export async function getTeamProjects(teamId: string): Promise<FigmaResponse> {
  return figmaFetch(`/teams/${teamId}/projects`);
}

export async function getProjectFiles(projectId: string): Promise<FigmaResponse> {
  return figmaFetch(`/projects/${projectId}/files`);
}

export async function getFileVersions(fileKey: string): Promise<FigmaResponse> {
  return figmaFetch(`/files/${fileKey}/versions`);
}

function summarizeNodeTree(node: any, depth = 0, maxDepth = 3): any {
  if (!node || depth > maxDepth) return undefined;
  const out: any = {
    id: node.id,
    name: node.name,
    type: node.type,
  };
  if (node.absoluteBoundingBox) out.bounds = node.absoluteBoundingBox;
  if (node.fills?.length) out.fills = node.fills.slice(0, 3).map((f: any) => ({ type: f.type, color: f.color }));
  if (node.characters) out.text = String(node.characters).slice(0, 200);
  if (Array.isArray(node.children) && depth < maxDepth) {
    out.children = node.children.slice(0, 30).map((c: any) => summarizeNodeTree(c, depth + 1, maxDepth)).filter(Boolean);
    if (node.children.length > 30) out.childrenTruncated = node.children.length - 30;
  }
  return out;
}

export async function getDesignContext(input: { fileKey?: string; nodeId?: string; url?: string; renderImage?: boolean }): Promise<FigmaResponse> {
  const { fileKey, nodeId } = normalizeFigmaInput(input);
  if (!fileKey || !nodeId) return { success: false, error: "fileKey and nodeId (or url containing both) required" };

  const nodesResp = await getNodes(fileKey, [nodeId]);
  if (!nodesResp.success) return nodesResp;

  const node = (nodesResp.data as any)?.nodes?.[nodeId]?.document;
  if (!node) return { success: false, error: `Node ${nodeId} not found in file ${fileKey}` };

  const result: any = {
    fileKey,
    nodeId,
    summary: summarizeNodeTree(node, 0, 3),
  };

  if (input.renderImage !== false) {
    const img = await renderImages(fileKey, [nodeId], { format: "png", scale: 2 });
    if (img.success) {
      result.imageUrl = (img.data as any)?.images?.[nodeId];
    } else {
      result.imageError = img.error;
    }
  }

  return { success: true, data: result };
}
