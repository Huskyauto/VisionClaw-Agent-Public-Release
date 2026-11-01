import { useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  BookOpenText,
  Check,
  Clipboard,
  FileText,
  Printer,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DECISION_REVIEW_DOCUMENTS,
  DECISION_REVIEW_META,
  buildDecisionReviewMarkdown,
} from "../../../shared/ai-stack-decision-package";

type Feedback = { kind: "success" | "error"; message: string } | null;

const audienceStyle: Record<string, string> = {
  "Customer-ready copy": "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  "Illustrative sample": "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  "Owner operations": "border-primary/30 bg-primary/10 text-primary",
};

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function renderInline(text: string, keyPrefix: string) {
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s<]+|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith("[") && match[2] && match[3]) {
      const href = safeHref(match[3]);
      parts.push(href
        ? <a key={key} href={href} target="_blank" rel="noreferrer" className="break-words text-primary underline underline-offset-4">{match[2]}</a>
        : match[2]);
    } else if (token.startsWith("http")) {
      const trimmed = token.replace(/[.,;!?]+$/, "");
      const href = safeHref(trimmed);
      parts.push(href
        ? <a key={key} href={href} target="_blank" rel="noreferrer" className="break-all text-primary underline underline-offset-4">{trimmed}</a>
        : token);
      if (trimmed.length < token.length) parts.push(token.slice(trimmed.length));
    } else if (token.startsWith("**")) {
      parts.push(<strong key={key} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">{token.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return /^#{1,6}\s/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^---+\s*$/.test(line) ||
    (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1]));
}

function MarkdownContent({ markdown }: { markdown: string }) {
  const lines = markdown.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const common = "scroll-mt-6 font-semibold tracking-tight text-foreground";
      const key = `heading-${index}`;
      if (level === 1) blocks.push(<h1 key={key} className={`${common} mb-5 mt-2 text-3xl sm:text-4xl`}>{renderInline(text, key)}</h1>);
      else if (level === 2) blocks.push(<h2 key={key} className={`${common} mb-3 mt-9 border-b border-border/70 pb-2 text-xl sm:text-2xl`}>{renderInline(text, key)}</h2>);
      else blocks.push(<h3 key={key} className={`${common} mb-2 mt-6 text-lg`}>{renderInline(text, key)}</h3>);
      index += 1;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} className="my-7 border-border" />);
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className="decision-review-table my-5 sm:rounded-lg sm:border sm:border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/70">
              <tr>{headers.map((cell, cellIndex) => <th key={cellIndex} className="border-b px-3 py-2.5 font-semibold">{renderInline(cell, `th-${index}-${cellIndex}`)}</th>)}</tr>
            </thead>
            <tbody>{rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex % 2 === 1 ? "bg-muted/25" : ""}>
                {headers.map((header, cellIndex) => <td key={cellIndex} data-label={header} className="border-b border-border/70 px-3 py-2.5 align-top leading-6">{renderInline(row[cellIndex] ?? "", `td-${index}-${rowIndex}-${cellIndex}`)}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`} className="my-4 border-l-2 border-primary/50 pl-4 text-muted-foreground">{quoteLines.map((item, quoteIndex) => <p key={quoteIndex}>{renderInline(item, `quote-${index}-${quoteIndex}`)}</p>)}</blockquote>);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`} className="my-4 list-disc space-y-2 pl-6 marker:text-primary">{items.map((item, itemIndex) => <li key={itemIndex} className="pl-1 leading-7">{renderInline(item, `ul-${index}-${itemIndex}`)}</li>)}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`} className="my-4 list-decimal space-y-2 pl-6 marker:font-semibold marker:text-primary">{items.map((item, itemIndex) => <li key={itemIndex} className="pl-1 leading-7">{renderInline(item, `ol-${index}-${itemIndex}`)}</li>)}</ol>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`} className="my-4 leading-7 text-foreground/90">{renderInline(paragraph.join(" "), `p-${index}`)}</p>);
  }

  return <div className="decision-markdown min-w-0 break-words [overflow-wrap:anywhere]">{blocks}</div>;
}

function downloadMarkdown(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function filenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function AdminAiStackDecisionReviewPage() {
  const [activeId, setActiveId] = useState(DECISION_REVIEW_DOCUMENTS[0]?.id ?? "");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const activeDocument = DECISION_REVIEW_DOCUMENTS.find((document) => document.id === activeId) ?? DECISION_REVIEW_DOCUMENTS[0];

  async function copyDocument(documentId: string) {
    const document = DECISION_REVIEW_DOCUMENTS.find((item) => item.id === documentId);
    if (!document) return;
    try {
      await navigator.clipboard.writeText(document.content);
      setFeedback({ kind: "success", message: `Copied “${document.title}” to the clipboard.` });
    } catch {
      setFeedback({ kind: "error", message: "Clipboard access failed. Check browser permissions and try again." });
    }
  }

  function downloadDocument(documentId: string) {
    const document = DECISION_REVIEW_DOCUMENTS.find((item) => item.id === documentId);
    if (!document) return;
    try {
      downloadMarkdown(`${filenamePart(document.title)}.md`, document.content);
      setFeedback({ kind: "success", message: `Download requested for “${document.title}”. Check your browser downloads.` });
    } catch {
      setFeedback({ kind: "error", message: "The document could not be downloaded. Try again in this browser." });
    }
  }

  function downloadPackage() {
    try {
      downloadMarkdown("ai-stack-decision-review-launch-package.md", buildDecisionReviewMarkdown());
      setFeedback({ kind: "success", message: "Download requested for the complete eight-document owner package. Check your browser downloads." });
    } catch {
      setFeedback({ kind: "error", message: "The complete package could not be downloaded. Try again in this browser." });
    }
  }

  function printDocument(documentId: string) {
    if (documentId !== activeId) setActiveId(documentId);
    setFeedback(null);
    window.setTimeout(() => {
      try {
        window.print();
      } catch {
        setFeedback({ kind: "error", message: "Printing could not start. Download the document and print from your editor instead." });
      }
    }, 50);
  }

  if (!activeDocument) return null;

  return (
    <div className="h-full min-h-[100dvh] w-full min-w-0 overflow-y-auto bg-muted/20">
      <style>{`
          .decision-review-page,
          .decision-review-page * { min-width: 0; }
          .decision-review-page { overflow-wrap: anywhere; }
          .decision-review-table { width: 100%; min-width: 0; }
          .decision-review-table th,
          .decision-review-table td { overflow-wrap: anywhere; }
          @media screen and (max-width: 639px) {
            .decision-review-table,
            .decision-review-table table,
            .decision-review-table tbody,
            .decision-review-table tr,
            .decision-review-table td { display: block; width: 100%; }
            .decision-review-table thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
            .decision-review-table tr { margin-bottom: .75rem; border: 1px solid hsl(var(--border)); border-radius: .65rem; background: hsl(var(--background)); }
            .decision-review-table td { display: grid; grid-template-columns: minmax(5.25rem, 34%) minmax(0, 1fr); gap: .55rem; border-bottom: 1px solid hsl(var(--border) / .7); padding: .65rem .75rem; }
            .decision-review-table td:last-child { border-bottom: 0; }
            .decision-review-table td::before { content: attr(data-label); color: hsl(var(--muted-foreground)); font-size: .7rem; font-weight: 700; line-height: 1.4; }
          }
        @media print {
          html, body, #root { height: auto !important; overflow: visible !important; }
          body * { visibility: hidden; }
          body *:has(.decision-review-print-shell) { height: auto !important; min-height: 0 !important; overflow: visible !important; }
          .decision-review-print-shell, .decision-review-print-shell * { visibility: visible; }
          .decision-review-print-shell { position: absolute; inset: 0 auto auto 0; width: 100%; }
          body { background: #fff !important; }
          .decision-review-screen-only { display: none !important; }
          .decision-review-print-shell { display: block !important; max-width: none !important; padding: 0 !important; }
          .decision-review-print-content { border: 0 !important; box-shadow: none !important; padding: 0 !important; }
          .decision-markdown { color: #111 !important; font-size: 10.5pt !important; }
          .decision-markdown h1 { font-size: 25pt !important; }
          .decision-markdown h2 { break-after: avoid; }
          .decision-markdown table { font-size: 8.5pt !important; }
          .decision-markdown a { color: #111 !important; }
        }
      `}</style>
      <div className="decision-review-page decision-review-print-shell mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-7 sm:py-8">
        <header className="decision-review-screen-only relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-background to-amber-500/10 p-5 sm:p-8">
          <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border border-primary/10" />
          <div className="pointer-events-none absolute -right-2 -top-10 h-44 w-44 rounded-full border border-primary/10" />
          <div className="relative flex min-w-0 flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 max-w-3xl">
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge variant="secondary">Owner workspace</Badge>
                <Badge variant="outline">Manual-first</Badge>
                <Badge variant="outline">Version {DECISION_REVIEW_META.version}</Badge>
              </div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Income opportunities / launch file</p>
              <h1 className="max-w-2xl break-words text-3xl font-bold tracking-tight sm:text-4xl">{DECISION_REVIEW_META.name}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Sell a clear decision, not another generic AI summary. Everything here is prepared for Bob to review, adapt, and operate by hand.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <span className="font-semibold">${DECISION_REVIEW_META.price} pilot hypothesis</span>
                <span className="text-muted-foreground">{DECISION_REVIEW_META.status}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap lg:shrink-0">
              <Button type="button" onClick={downloadPackage} className="min-h-11">
                <ArrowDownToLine className="mr-2 h-4 w-4" /> Download complete package
              </Button>
            </div>
          </div>
        </header>

        <div className="decision-review-screen-only my-4 grid gap-3 sm:grid-cols-3">
          <Card className="border-primary/15 bg-background/80">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary"><BookOpenText className="h-4 w-4" /></div>
              <div><p className="text-sm font-semibold">Eight usable documents</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Offer, sample, intake, method, operations, economics, launch and templates.</p></div>
            </CardContent>
          </Card>
          <Card className="border-amber-500/20 bg-background/80">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="rounded-lg bg-amber-500/10 p-2 text-amber-700"><TriangleAlert className="h-4 w-4" /></div>
              <div><p className="text-sm font-semibold">Demand is unvalidated</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The $350 founding pilot is a hypothesis, not paid validation or a forecast.</p></div>
            </CardContent>
          </Card>
          <Card className="border-primary/15 bg-background/80">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary"><ShieldCheck className="h-4 w-4" /></div>
              <div><p className="text-sm font-semibold">Preparation only</p><p className="mt-1 text-xs leading-5 text-muted-foreground">No customer intake, payment, outreach, fulfillment or send is enabled here.</p></div>
            </CardContent>
          </Card>
        </div>

        {feedback && (
          <div className={`decision-review-screen-only mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${feedback.kind === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/25 bg-primary/5 text-foreground"}`} role={feedback.kind === "error" ? "alert" : "status"}>
            {feedback.kind === "success" ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{feedback.message}</span>
            <button type="button" onClick={() => setFeedback(null)} className="ml-auto text-xs underline underline-offset-4">Dismiss</button>
          </div>
        )}

        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
          <aside className="decision-review-screen-only min-w-0 rounded-xl border bg-background p-3 lg:sticky lg:top-4">
            <div className="px-2 pb-3 pt-1">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Package contents</p>
              <p className="mt-1 text-sm text-muted-foreground">Select a document to read and export.</p>
            </div>
            <nav aria-label="Decision review documents" className="grid min-w-0 grid-cols-1 gap-2 pb-1 sm:grid-cols-2 lg:grid-cols-1">
              {DECISION_REVIEW_DOCUMENTS.map((document, index) => {
                const selected = document.id === activeDocument.id;
                return (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => { setActiveId(document.id); setFeedback(null); }}
                    aria-current={selected ? "page" : undefined}
                    className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${selected ? "border-primary/35 bg-primary/8 shadow-sm" : "border-transparent hover:border-border hover:bg-muted/50"}`}
                  >
                    <span className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px] ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{String(index + 1).padStart(2, "0")}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-5">{document.title}</span>
                        <span className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${audienceStyle[document.audience]}`}>{document.audience}</span>
                        <span className="mt-2 block text-xs leading-5 text-muted-foreground">{document.description}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="min-w-0">
            <div className="decision-review-screen-only mb-3 flex flex-col gap-3 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="hidden rounded-lg bg-muted p-2 text-muted-foreground sm:block"><FileText className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{activeDocument.title}</p>
                  <p className="text-xs text-muted-foreground">{activeDocument.audience}</p>
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                <Button variant="outline" size="sm" className="min-h-11 flex-[1_0_7rem] sm:flex-none" onClick={() => downloadDocument(activeDocument.id)}>
                  <ArrowDownToLine className="mr-1.5 h-4 w-4" /> <span>Download</span>
                </Button>
                <Button variant="outline" size="sm" className="min-h-11 flex-[1_0_7rem] sm:flex-none" onClick={() => void copyDocument(activeDocument.id)}>
                  <Clipboard className="mr-1.5 h-4 w-4" /> <span>Copy</span>
                </Button>
                <Button variant="outline" size="sm" className="min-h-11 flex-[1_0_7rem] sm:flex-none" onClick={() => printDocument(activeDocument.id)}>
                  <Printer className="mr-1.5 h-4 w-4" /> <span>Print</span>
                </Button>
              </div>
            </div>

            <article className="decision-review-print-content min-w-0 rounded-xl border bg-background px-3 py-4 shadow-sm sm:px-9 sm:py-8">
              <div className="mb-5 hidden border-b pb-3 print:block">
                <p className="text-xs font-semibold uppercase tracking-widest">{DECISION_REVIEW_META.name} · Owner preparation</p>
                <p className="mt-1 text-xs text-muted-foreground">{activeDocument.title} · Version {DECISION_REVIEW_META.version}</p>
              </div>
              <div className="mb-6 hidden print:block">
                <Badge variant="outline">{activeDocument.audience}</Badge>
              </div>
              <MarkdownContent markdown={activeDocument.content} />
              <p className="mt-10 border-t pt-4 text-xs leading-5 text-muted-foreground">
                Owner preparation material · Manual-first · Demand unvalidated · Not a paid validation or public launch.
              </p>
            </article>
          </main>
        </div>

        <footer className="decision-review-screen-only mt-6 flex flex-col gap-2 border-t py-4 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Exports are the owner package and may include internal operations. The illustrative sample is a separate document and is not a commissioned customer report.</span>
          <span>Nothing on this page stores customer data.</span>
        </footer>
      </div>
    </div>
  );
}
