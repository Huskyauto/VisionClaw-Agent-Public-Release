import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeUrl } from "@/lib/safe-url";
import {
  Loader2, FileText, Video, Music, Image as ImageIcon,
  Presentation, Sheet, FileCode, File as FileIcon, ExternalLink, Play,
} from "lucide-react";

interface GalleryItem {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  driveUrl: string | null;
  hasDriveLink: boolean;
  fileUrl: string;
  createdAt: string;
  kind: "video" | "audio" | "image" | "pdf" | "slides" | "spreadsheet" | "document" | "html" | "file";
}

interface GalleryResponse {
  generatedAt: string;
  count: number;
  items: GalleryItem[];
}

const KIND_ICON: Record<GalleryItem["kind"], any> = {
  video: Video,
  audio: Music,
  image: ImageIcon,
  pdf: FileText,
  slides: Presentation,
  spreadsheet: Sheet,
  document: FileText,
  html: FileCode,
  file: FileIcon,
};

const KIND_COLOR: Record<GalleryItem["kind"], string> = {
  video: "text-rose-500",
  audio: "text-amber-500",
  image: "text-violet-500",
  pdf: "text-red-500",
  slides: "text-orange-500",
  spreadsheet: "text-emerald-500",
  document: "text-blue-500",
  html: "text-cyan-500",
  file: "text-muted-foreground",
};

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtAge(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export default function GalleryPage() {
  const { data, isLoading, error } = useQuery<GalleryResponse>({
    queryKey: ["/api/public/gallery"],
    refetchInterval: 5 * 60_000,
  });

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-gallery">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          Deliverable Gallery
        </h1>
        <p className="text-muted-foreground mt-2" data-testid="text-page-description">
          Real outputs produced by the VisionClaw agent team — videos, PDFs, slide decks, spreadsheets, audio, and more. Every file here was generated end-to-end from a single business request.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16" data-testid="state-loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive" data-testid="state-error">
            Failed to load gallery.
          </CardContent>
        </Card>
      )}

      {data && data.items.length === 0 && (
        <Card>
          <CardContent className="pt-6" data-testid="state-empty">
            <p className="text-muted-foreground">
              No showcase deliverables yet. Generated outputs will appear here automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <Badge variant="secondary" data-testid="badge-item-count">
              {data.count} showcase {data.count === 1 ? "deliverable" : "deliverables"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Updated {fmtAge(data.generatedAt)}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="grid-gallery">
            {data.items.map((item) => {
              const Icon = KIND_ICON[item.kind];
              const iconColor = KIND_COLOR[item.kind];
              return (
                <Card
                  key={item.id}
                  className="hover:border-primary/40 transition-colors"
                  data-testid={`card-deliverable-${item.id}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />
                        <CardTitle
                          className="text-base truncate"
                          title={item.name}
                          data-testid={`text-deliverable-name-${item.id}`}
                        >
                          {item.name}
                        </CardTitle>
                      </div>
                      <Badge variant="outline" className="shrink-0" data-testid={`badge-kind-${item.id}`}>
                        {item.kind}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* R125+12+sec (architect HIGH closed 2026-05-24): safeUrl gates every
                        DB-sourced URL sink so a tainted fileUrl/driveUrl can't become a
                        `javascript:` / `data:` / private-host anchor or img src. */}
                    {item.kind === "image" && safeUrl(item.fileUrl) && (
                      <div className="rounded border overflow-hidden bg-muted/30 aspect-video">
                        <img
                          src={safeUrl(item.fileUrl)}
                          alt={item.name}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          data-testid={`img-preview-${item.id}`}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span data-testid={`text-size-${item.id}`}>{fmtBytes(item.size)}</span>
                      <span data-testid={`text-age-${item.id}`}>{fmtAge(item.createdAt)}</span>
                    </div>
                    <div className="flex gap-2">
                      {safeUrl(item.fileUrl) && (
                        <Button
                          asChild
                          size="sm"
                          variant="secondary"
                          className="flex-1"
                          data-testid={`button-watch-${item.id}`}
                        >
                          <a href={safeUrl(item.fileUrl)} target="_blank" rel="noopener noreferrer">
                            <Play className="h-3 w-3 mr-1" /> Open
                          </a>
                        </Button>
                      )}
                      {item.driveUrl && safeUrl(item.driveUrl) && (
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          data-testid={`button-drive-${item.id}`}
                        >
                          <a href={safeUrl(item.driveUrl)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3 mr-1" /> Drive
                          </a>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
