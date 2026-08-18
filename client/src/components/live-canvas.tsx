import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, X, ExternalLink } from "lucide-react";
import DOMPurify from "dompurify";

interface LiveCanvasProps {
  html: string;
  title?: string;
}

export default function LiveCanvas({ html, title = "Agent Dashboard" }: LiveCanvasProps) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const sanitizedHtml = DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    ADD_ATTR: ["target", "rel", "colspan", "rowspan"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
  });

  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(getSandboxedHtml(sanitizedHtml, title));
        doc.close();
      }
    }
  }, [sanitizedHtml, title]);

  if (!visible) return null;

  return (
    <Card className={`my-3 overflow-hidden ${expanded ? "fixed inset-4 z-50 shadow-2xl" : ""}`} data-testid="live-canvas">
      <CardHeader className="py-2 px-3 flex flex-row items-center justify-between bg-muted/50">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
            const safeHtml = getSandboxedHtml(sanitizedHtml, title);
            const newWindow = window.open("about:blank", "_blank", "noopener,noreferrer");
            if (newWindow) {
              newWindow.opener = null;
              newWindow.document.open();
              newWindow.document.write(safeHtml);
              newWindow.document.close();
            }
          }}>
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setVisible(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <iframe
          ref={iframeRef}
          sandbox="allow-scripts"
          className={`w-full border-0 ${expanded ? "h-[calc(100vh-8rem)]" : "h-80"}`}
          title={title}
          data-testid="canvas-iframe"
        />
      </CardContent>
    </Card>
  );
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function getSandboxedHtml(html: string, title: string): string {
  if (html.trim().startsWith("<!DOCTYPE") || html.trim().startsWith("<html")) {
    return html;
  }

  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 16px;
      background: #fafafa;
      color: #1a1a1a;
      line-height: 1.6;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e5e5e5; }
    }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e5e5; }
    th { font-weight: 600; background: #f5f5f5; }
    @media (prefers-color-scheme: dark) {
      th { background: #2a2a2a; }
      th, td { border-color: #333; }
    }
    .card { background: white; border-radius: 8px; padding: 16px; margin: 8px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    @media (prefers-color-scheme: dark) { .card { background: #2a2a2a; } }
    .metric { text-align: center; padding: 16px; }
    .metric-value { font-size: 2em; font-weight: 700; color: #3b82f6; }
    .metric-label { font-size: 0.85em; color: #666; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.75em; font-weight: 500; }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .badge-yellow { background: #fef9c3; color: #854d0e; }
    h1, h2, h3 { margin: 12px 0 8px 0; }
    ul, ol { padding-left: 20px; margin: 8px 0; }
    pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.85em; }
    @media (prefers-color-scheme: dark) { pre { background: #2a2a2a; } }
  </style>
</head>
<body>${html}</body>
</html>`;
}

export function extractCanvasBlocks(text: string): { before: string; canvasHtml: string; canvasTitle: string; after: string } | null {
  const canvasRegex = /```(?:html-canvas|canvas|dashboard)\s*(?:\[([^\]]*)\])?\n([\s\S]*?)```/;
  const match = text.match(canvasRegex);

  if (!match) return null;

  const canvasTitle = match[1] || "Agent Dashboard";
  const canvasHtml = match[2].trim();
  const before = text.slice(0, match.index).trim();
  const after = text.slice(match.index! + match[0].length).trim();

  return { before, canvasHtml, canvasTitle, after };
}
