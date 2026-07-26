import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts, PDFTextField, PDFCheckBox, PDFDropdown } from "pdf-lib";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { fileStorage } from "@shared/schema";
import { uploadAndShare } from "./google-drive";
import fetch from "node-fetch";

// R117.1 — tenant isolation hardening for PDF persistence (architect HIGH finding).
// All persistToDb writes MUST scope by tenantId; callers without explicit tenantId
// fall back to ADMIN with a loud warning so we can find unmigrated sites.
const PDF_ADMIN_TENANT_ID = 1;
function resolveTenantOrAdmin(tenantId: number | undefined | null, caller: string): number {
  if (Number.isInteger(tenantId as number) && (tenantId as number) > 0) return tenantId as number;
  console.warn(`[pdf-create] ${caller}: no tenantId provided, defaulting to ADMIN_TENANT_ID=${PDF_ADMIN_TENANT_ID} — caller should pass tenantId`);
  return PDF_ADMIN_TENANT_ID;
}
// R98.27.6 — bounded leaf timeouts on Browserless calls. Browserless can
// legitimately take 60s on heavy PDFs but never 10+ min; cap at 90s so a
// stuck render can't trip Replit Temporal StartToClose.
const BROWSERLESS_PDF_TIMEOUT_MS = 90_000;

import { logSilentCatch } from "./lib/silent-catch";
const WORKSPACE_ROOT = process.cwd();
const OUTPUT_DIR = path.join(WORKSPACE_ROOT, "uploads");

async function persistToDb(filename: string, originalName: string, pdfBytes: Uint8Array, tenantId: number) {
  // R117.1 — fail-closed tenant isolation. Reject invalid tenantId at the boundary
  // rather than running a tenant-less query that could overwrite another tenant's row.
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    console.error(`[pdf] persistToDb refusing: invalid tenantId=${tenantId} for filename=${filename}`);
    return;
  }
  try {
    console.log(`[pdf] Persisting ${filename} to DB (${pdfBytes.length} bytes, tenant=${tenantId})...`);
    const base64 = Buffer.from(pdfBytes).toString("base64");
    const existing = await db.select({ id: fileStorage.id }).from(fileStorage)
      .where(and(eq(fileStorage.filename, filename), eq(fileStorage.tenantId, tenantId)))
      .limit(1);
    if (existing.length > 0) {
      await db.update(fileStorage).set({
        originalName,
        mimeType: "application/pdf",
        size: pdfBytes.length,
        data: base64,
      }).where(and(eq(fileStorage.filename, filename), eq(fileStorage.tenantId, tenantId)));
      console.log(`[pdf] Updated existing DB record for ${filename} (tenant=${tenantId})`);
    } else {
      await (db.insert(fileStorage) as any).values({
        filename,
        originalName,
        mimeType: "application/pdf",
        size: pdfBytes.length,
        data: base64,
        tenantId,
      });
      console.log(`[pdf] Persisted ${filename} to DB successfully (tenant=${tenantId})`);
    }
  } catch (err: any) {
    console.error("[pdf] DB persist failed:", err.message, err.stack);
  }
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function safePath(filePath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, filePath);
  if (!resolved.startsWith(WORKSPACE_ROOT)) throw new Error("Path escapes workspace");
  return resolved;
}

function resolveUploadPath(filePath: string): string {
  if (filePath.startsWith("/uploads/")) {
    return path.join(WORKSPACE_ROOT, filePath);
  }
  if (filePath.startsWith("uploads/")) {
    return path.join(WORKSPACE_ROOT, filePath);
  }
  const inUploads = path.join(WORKSPACE_ROOT, "uploads", filePath);
  if (fs.existsSync(inUploads)) return inUploads;
  const direct = path.resolve(WORKSPACE_ROOT, filePath);
  if (direct.startsWith(WORKSPACE_ROOT)) return direct;
  return inUploads;
}

interface FieldDef {
  name: string;
  type: "text" | "checkbox" | "dropdown";
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  value?: string;
  options?: string[];
  required?: boolean;
  fontSize?: number;
  multiline?: boolean;
}

interface HeaderImageDef {
  path: string;
  width?: number;
  height?: number;
  alignment?: "left" | "center" | "right";
}

interface CreatePdfParams {
  title?: string;
  content?: string;
  sections?: { heading?: string; body: string }[];
  fields?: FieldDef[];
  headerImage?: HeaderImageDef;
  fontSize?: number;
  pageSize?: "letter" | "a4" | "legal";
  outputPath?: string;
  customerName?: string;
  folderLabel?: string;
  tenantId?: number;
}

interface FillPdfParams {
  inputPath: string;
  fields: Record<string, string | boolean>;
  outputPath?: string;
  flatten?: boolean;
  tenantId?: number;
}

interface EditPdfParams {
  inputPath: string;
  addText?: { text: string; x: number; y: number; page?: number; fontSize?: number; color?: string }[];
  addFields?: FieldDef[];
  addPages?: number;
  removePages?: number[];
  outputPath?: string;
  tenantId?: number;
}

const PAGE_SIZES = {
  letter: { width: 612, height: 792 } as const,
  a4: { width: 595.28, height: 841.89 } as const,
  legal: { width: 612, height: 1008 } as const,
};

function parseColor(color?: string) {
  if (!color) return rgb(0, 0, 0);
  const hex = color.replace("#", "");
  if (hex.length === 6) {
    return rgb(
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255
    );
  }
  return rgb(0, 0, 0);
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(test, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function sanitizeForPdf(text: string): string {
  const replacements: Record<string, string> = {
    '\u2713': '[x]',  // ✓
    '\u2714': '[x]',  // ✔
    '\u2715': '[ ]',  // ✕
    '\u2716': '[ ]',  // ✖
    '\u2717': '[ ]',  // ✗
    '\u2718': '[ ]',  // ✘
    '\u2022': '*',    // •
    '\u2023': '>',    // ‣
    '\u25B8': '>',    // ▸
    '\u25BA': '>',    // ►
    '\u25CF': '*',    // ●
    '\u25CB': 'o',    // ○
    '\u25A0': '#',    // ■
    '\u25A1': '[]',   // □
    '\u2192': '->',   // →
    '\u2190': '<-',   // ←
    '\u2191': '^',    // ↑
    '\u2193': 'v',    // ↓
    '\u21D2': '=>',   // ⇒
    '\u2014': '--',   // —
    '\u2013': '-',    // –
    '\u2018': "'",    // '
    '\u2019': "'",    // '
    '\u201C': '"',    // "
    '\u201D': '"',    // "
    '\u2026': '...',  // …
    '\u00A0': ' ',    // non-breaking space
    '\u2212': '-',    // −
    '\u2264': '<=',   // ≤
    '\u2265': '>=',   // ≥
    '\u2260': '!=',   // ≠
    '\u221E': 'inf',  // ∞
    '\u2248': '~=',   // ≈
    '\u00B7': '*',    // ·
    '\u2605': '*',    // ★
    '\u2606': '*',    // ☆
  };

  let result = text;
  for (const [unicode, ascii] of Object.entries(replacements)) {
    result = result.split(unicode).join(ascii);
  }
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[^\x00-\xFF]/g, '?');
  return result;
}

export async function createPdf(params: CreatePdfParams): Promise<{ success: boolean; path?: string; url?: string; pages?: number; fields?: number; error?: string }> {
  try {
    ensureOutputDir();
    const doc = await PDFDocument.create();
    const size = PAGE_SIZES[params.pageSize || "letter"];
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const baseFontSize = params.fontSize || 12;
    const margin = 50;
    const maxWidth = size.width - margin * 2;

    if (params.title) {
      doc.setTitle(params.title);
      const { siteConfig: _sc } = await import("./site-config");
      doc.setProducer(`${_sc.platformName} Agent`);
      doc.setCreator(`${_sc.platformName} PDF Toolkit`);
    }

    let page = doc.addPage([size.width, size.height]);
    let yPos = size.height - margin;
    let embeddedHeaderImage: { image: any; width: number; height: number; alignment: string } | null = null;

    if (params.headerImage) {
      try {
        const imgPath = resolveUploadPath(params.headerImage.path);
        if (fs.existsSync(imgPath)) {
          const imgBytes = fs.readFileSync(imgPath);
          const ext = path.extname(imgPath).toLowerCase();
          let image;
          if (ext === ".png") {
            image = await doc.embedPng(imgBytes);
          } else if (ext === ".jpg" || ext === ".jpeg") {
            image = await doc.embedJpg(imgBytes);
          } else {
            console.warn(`[pdf] Unsupported image format: ${ext}, trying as PNG`);
            try { image = await doc.embedPng(imgBytes); } catch { image = await doc.embedJpg(imgBytes); }
          }
          const origW = image.width;
          const origH = image.height;
          let drawW = params.headerImage.width || Math.min(origW, maxWidth);
          let drawH = params.headerImage.height || (drawW / origW) * origH;
          if (drawW > maxWidth) {
            drawH = (maxWidth / drawW) * drawH;
            drawW = maxWidth;
          }
          embeddedHeaderImage = { image, width: drawW, height: drawH, alignment: params.headerImage.alignment || "center" };
        } else {
          console.warn(`[pdf] Header image not found: ${imgPath}`);
        }
      } catch (imgErr: any) {
        console.warn(`[pdf] Failed to embed header image: ${imgErr.message}`);
      }
    }

    function drawHeaderImage() {
      if (!embeddedHeaderImage) return;
      const { image, width: drawW, height: drawH, alignment } = embeddedHeaderImage;
      let imgX = margin;
      if (alignment === "center") imgX = (size.width - drawW) / 2;
      else if (alignment === "right") imgX = size.width - margin - drawW;
      page.drawImage(image, { x: imgX, y: yPos - drawH, width: drawW, height: drawH });
      yPos -= drawH + 15;
    }

    function ensureSpace(needed: number) {
      if (yPos - needed < margin) {
        page = doc.addPage([size.width, size.height]);
        yPos = size.height - margin;
        drawHeaderImage();
      }
    }

    drawHeaderImage();

    if (params.title) {
      const titleSize = baseFontSize + 8;
      ensureSpace(titleSize + 20);
      page.drawText(sanitizeForPdf(params.title), { x: margin, y: yPos, size: titleSize, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
      yPos -= titleSize + 20;
    }

    if (params.content) {
      const paragraphs = sanitizeForPdf(params.content).split("\n");
      for (const para of paragraphs) {
        if (!para.trim()) { yPos -= baseFontSize; continue; }
        const lines = wrapText(para, font, baseFontSize, maxWidth);
        for (const line of lines) {
          ensureSpace(baseFontSize + 4);
          page.drawText(line, { x: margin, y: yPos, size: baseFontSize, font, color: rgb(0.15, 0.15, 0.15) });
          yPos -= baseFontSize + 4;
        }
        yPos -= 4;
      }
    }

    let parsedSections = params.sections;
    if (parsedSections && typeof parsedSections === "string") {
      try {
        parsedSections = JSON.parse(parsedSections);
      } catch {
        parsedSections = [{ heading: "Content", body: parsedSections as any }];
      }
    }
    if (parsedSections && !Array.isArray(parsedSections)) {
      parsedSections = [parsedSections];
    }

    if (parsedSections) {
      for (const section of parsedSections) {
        if (section.heading) {
          const headingSize = baseFontSize + 4;
          ensureSpace(headingSize + 16);
          yPos -= 12;
          page.drawText(sanitizeForPdf(String(section.heading)), { x: margin, y: yPos, size: headingSize, font: boldFont, color: rgb(0.1, 0.1, 0.3) });
          yPos -= headingSize + 8;
        }
        if (!section.body && !(section as any).bullets) continue;
        if (section.body) {
          const paragraphs = sanitizeForPdf(String(section.body)).split("\n");
          for (const para of paragraphs) {
            if (!para.trim()) { yPos -= baseFontSize; continue; }
            const lines = wrapText(para, font, baseFontSize, maxWidth);
            for (const line of lines) {
              ensureSpace(baseFontSize + 4);
              page.drawText(line, { x: margin, y: yPos, size: baseFontSize, font, color: rgb(0.15, 0.15, 0.15) });
              yPos -= baseFontSize + 4;
            }
            yPos -= 4;
          }
        }
        if ((section as any).bullets && Array.isArray((section as any).bullets)) {
          for (const bullet of (section as any).bullets) {
            if (!bullet) continue;
            const bulletText = sanitizeForPdf(String(bullet));
            const lines = wrapText("* " + bulletText, font, baseFontSize, maxWidth - 10);
            for (const line of lines) {
              ensureSpace(baseFontSize + 4);
              page.drawText(line, { x: margin + 10, y: yPos, size: baseFontSize, font, color: rgb(0.15, 0.15, 0.15) });
              yPos -= baseFontSize + 4;
            }
            yPos -= 2;
          }
        }
      }
    }

    const form = doc.getForm();
    let fieldCount = 0;

    if (params.fields) {
      yPos -= 20;
      for (const f of params.fields) {
        const fieldY = f.y || yPos;
        const fieldX = f.x || margin;

        if (f.label) {
          const labelPage = doc.getPages()[doc.getPageCount() - 1];
          labelPage.drawText(sanitizeForPdf(f.label + ":"), { x: fieldX, y: fieldY + (f.height || 20) + 4, size: f.fontSize || 10, font, color: rgb(0.2, 0.2, 0.2) });
        }

        switch (f.type) {
          case "text": {
            const textField = form.createTextField(f.name);
            textField.addToPage(page, { x: fieldX, y: fieldY, width: f.width || 200, height: f.height || 24 });
            if (f.value) textField.setText(f.value);
            if (f.multiline) textField.enableMultiline();
            if (f.required) textField.enableRequired();
            fieldCount++;
            break;
          }
          case "checkbox": {
            const checkbox = form.createCheckBox(f.name);
            checkbox.addToPage(page, { x: fieldX, y: fieldY, width: f.width || 16, height: f.height || 16 });
            if (f.value === "true" || f.value === "checked") checkbox.check();
            fieldCount++;
            break;
          }
          case "dropdown": {
            const dropdown = form.createDropdown(f.name);
            dropdown.addToPage(page, { x: fieldX, y: fieldY, width: f.width || 200, height: f.height || 24 });
            if (f.options) dropdown.setOptions(f.options);
            if (f.value) dropdown.select(f.value);
            if (f.required) dropdown.enableRequired();
            fieldCount++;
            break;
          }
        }
        yPos -= (f.height || 24) + 30;
      }
    }

    const filename = params.outputPath || `pdf_${Date.now()}.pdf`;
    const outputPath = safePath(filename.startsWith("uploads/") ? filename : `uploads/${filename}`);
    const pdfBytes = await doc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    const baseName = path.basename(outputPath);
    const displayName = params.title ? `${params.title}.pdf` : baseName;
    await persistToDb(baseName, displayName, pdfBytes, resolveTenantOrAdmin(params.tenantId, "createPdf"));

    const relativePath = path.relative(WORKSPACE_ROOT, outputPath);
    const pageCount = doc.getPageCount();

    const sectionsArr = Array.isArray(parsedSections) ? parsedSections : [];
    const contentLength = (params.content?.length || 0) + (sectionsArr.reduce((sum: number, s: any) => sum + (s?.heading?.length || 0) + (s?.body?.length || 0), 0) || 0);
    console.log(`[pdf] Created "${displayName}": ${pageCount} pages, ${pdfBytes.length} bytes, ${contentLength} chars of input content, ${fieldCount} fields`);

    const result: any = {
      success: true,
      path: relativePath,
      url: `/uploads/${baseName}`,
      filename: baseName,
      pages: pageCount,
      size: pdfBytes.length,
      contentCharsReceived: contentLength,
      fields: fieldCount,
    };

    try {
      const driveResult = await uploadAndShare({
        filePath: relativePath,
        fileName: displayName,
        mimeType: "application/pdf",
        description: params.title ? `${params.title} — ${pageCount} pages, generated by ${(await import("./site-config")).siteConfig.platformName}` : undefined,
        customerName: params.customerName,
        folderLabel: params.folderLabel || params.title,
        parentFolderId: (params as any)._projectDriveFolderId || undefined,
      });
      if (driveResult.success) {
        result.googleDrive = {
          fileId: driveResult.fileId,
          shareableLink: driveResult.viewUrl,
          directDownloadLink: driveResult.downloadUrl,
          webViewLink: driveResult.viewUrl,
        };
        console.log(`[pdf] Auto-uploaded to Google Drive: ${driveResult.viewUrl}`);
      } else {
        console.warn(`[pdf] Google Drive auto-upload failed: ${driveResult.error}`);
        result.driveUploadError = driveResult.error;
      }
    } catch (driveErr: any) {
      console.warn(`[pdf] Google Drive auto-upload skipped: ${driveErr.message}`);
    }

    return result;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function fillPdf(params: FillPdfParams): Promise<{ success: boolean; path?: string; url?: string; filledFields?: string[]; error?: string }> {
  try {
    ensureOutputDir();
    const inputPath = safePath(params.inputPath);
    if (!fs.existsSync(inputPath)) throw new Error(`File not found: ${params.inputPath}`);

    const pdfBytes = fs.readFileSync(inputPath);
    const doc = await PDFDocument.load(pdfBytes);
    const form = doc.getForm();
    const filledFields: string[] = [];

    for (const [name, value] of Object.entries(params.fields)) {
      try {
        const field = form.getField(name);
        if (!field) continue;

        if (field instanceof PDFTextField) {
          field.setText(String(value));
          filledFields.push(name);
        } else if (field instanceof PDFCheckBox) {
          if (value === true || value === "true" || value === "checked") {
            field.check();
          } else {
            field.uncheck();
          }
          filledFields.push(name);
        } else if (field instanceof PDFDropdown) {
          field.select(String(value));
          filledFields.push(name);
        }
      } catch (fieldErr: any) {
        console.error(`[pdf] Failed to fill field "${name}": ${fieldErr.message}`);
      }
    }

    if (params.flatten) {
      form.flatten();
    }

    const filename = params.outputPath || params.inputPath.replace(".pdf", "_filled.pdf");
    const outputPath = safePath(filename.startsWith("uploads/") ? filename : `uploads/${filename}`);
    const savedBytes = await doc.save();
    fs.writeFileSync(outputPath, savedBytes);
    const baseName = path.basename(outputPath);
    await persistToDb(baseName, baseName, savedBytes, resolveTenantOrAdmin(params.tenantId, "fillPdf"));

    const relativePath = path.relative(WORKSPACE_ROOT, outputPath);
    return {
      success: true,
      path: relativePath,
      url: `/uploads/${baseName}`,
      filledFields,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function editPdf(params: EditPdfParams): Promise<{ success: boolean; path?: string; url?: string; pages?: number; fieldsAdded?: number; error?: string }> {
  try {
    ensureOutputDir();
    const inputPath = safePath(params.inputPath);
    if (!fs.existsSync(inputPath)) throw new Error(`File not found: ${params.inputPath}`);

    const pdfBytes = fs.readFileSync(inputPath);
    const doc = await PDFDocument.load(pdfBytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    if (params.removePages && params.removePages.length > 0) {
      const sorted = [...params.removePages].sort((a, b) => b - a);
      for (const pageNum of sorted) {
        const idx = pageNum - 1;
        if (idx >= 0 && idx < doc.getPageCount()) {
          doc.removePage(idx);
        }
      }
    }

    if (params.addPages) {
      for (let i = 0; i < params.addPages; i++) {
        doc.addPage();
      }
    }

    if (params.addText) {
      for (const t of params.addText) {
        const pageIdx = (t.page || 1) - 1;
        if (pageIdx < 0 || pageIdx >= doc.getPageCount()) continue;
        const pg = doc.getPages()[pageIdx];
        pg.drawText(sanitizeForPdf(t.text), {
          x: t.x,
          y: t.y,
          size: t.fontSize || 12,
          font,
          color: parseColor(t.color),
        });
      }
    }

    let fieldsAdded = 0;
    if (params.addFields) {
      const form = doc.getForm();
      for (const f of params.addFields) {
        const pageIdx = 0;
        const pg = doc.getPages()[pageIdx];

        switch (f.type) {
          case "text": {
            const textField = form.createTextField(f.name);
            textField.addToPage(pg, { x: f.x, y: f.y, width: f.width || 200, height: f.height || 24 });
            if (f.value) textField.setText(f.value);
            if (f.multiline) textField.enableMultiline();
            fieldsAdded++;
            break;
          }
          case "checkbox": {
            const checkbox = form.createCheckBox(f.name);
            checkbox.addToPage(pg, { x: f.x, y: f.y, width: f.width || 16, height: f.height || 16 });
            fieldsAdded++;
            break;
          }
          case "dropdown": {
            const dropdown = form.createDropdown(f.name);
            dropdown.addToPage(pg, { x: f.x, y: f.y, width: f.width || 200, height: f.height || 24 });
            if (f.options) dropdown.setOptions(f.options);
            fieldsAdded++;
            break;
          }
        }
      }
    }

    const filename = params.outputPath || params.inputPath.replace(".pdf", "_edited.pdf");
    const outputPath = safePath(filename.startsWith("uploads/") ? filename : `uploads/${filename}`);
    const savedBytes = await doc.save();
    fs.writeFileSync(outputPath, savedBytes);
    const baseName = path.basename(outputPath);
    await persistToDb(baseName, baseName, savedBytes, resolveTenantOrAdmin(params.tenantId, "editPdf"));

    const relativePath = path.relative(WORKSPACE_ROOT, outputPath);
    return {
      success: true,
      path: relativePath,
      url: `/uploads/${path.basename(outputPath)}`,
      pages: doc.getPageCount(),
      fieldsAdded,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function listPdfFields(inputPath: string): Promise<{ success: boolean; fields?: { name: string; type: string; value?: string }[]; error?: string }> {
  try {
    const resolved = safePath(inputPath);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${inputPath}`);

    const pdfBytes = fs.readFileSync(resolved);
    const doc = await PDFDocument.load(pdfBytes);
    const form = doc.getForm();
    const allFields = form.getFields();

    const fields = allFields.map((field) => {
      const name = field.getName();
      let type = "unknown";
      let value: string | undefined;

      if (field instanceof PDFTextField) {
        type = "text";
        value = field.getText() || undefined;
      } else if (field instanceof PDFCheckBox) {
        type = "checkbox";
        value = field.isChecked() ? "checked" : "unchecked";
      } else if (field instanceof PDFDropdown) {
        type = "dropdown";
        const selected = field.getSelected();
        value = selected.length > 0 ? selected[0] : undefined;
      }

      return { name, type, value };
    });

    return { success: true, fields };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function htmlToPdfAndUpload(html: string, title: string, folderLabel: string, tenantId?: number): Promise<any> {
  const browserlessKey = process.env.BROWSERLESS_API_KEY;
  if (!browserlessKey) {
    return { error: "BROWSERLESS_API_KEY not configured — cannot convert HTML to PDF" };
  }

  const fullHtml = html.includes("<html") ? html : `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: letter landscape; margin: 0.5in; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; }
</style>
</head><body>${html}</body></html>`;

  console.log(`[pdf] Converting HTML to PDF via Browserless (${html.length} chars)...`);

  const _bl1Ctrl = new AbortController();
  const _bl1Timer = setTimeout(() => _bl1Ctrl.abort(), BROWSERLESS_PDF_TIMEOUT_MS);
  const resp = await fetch(`https://production-sfo.browserless.io/pdf?token=${browserlessKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: _bl1Ctrl.signal as any,
    body: JSON.stringify({
      html: fullHtml,
      options: {
        format: "Letter",
        landscape: true,
        printBackground: true,
        margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
      },
    }),
  }).finally(() => clearTimeout(_bl1Timer));

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[pdf] Browserless PDF failed: ${resp.status} ${errText.slice(0, 200)}`);
    return { error: `Browserless PDF conversion failed: ${resp.status}` };
  }

  const pdfBuffer = Buffer.from(await resp.arrayBuffer());
  console.log(`[pdf] Browserless PDF generated: ${pdfBuffer.length} bytes`);

  const slug = title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const filename = `${slug}-${Date.now()}.pdf`;
  const filePath = path.join(OUTPUT_DIR, filename);

  ensureOutputDir();
  fs.writeFileSync(filePath, pdfBuffer);

  await persistToDb(filename, `${title}.pdf`, new Uint8Array(pdfBuffer), resolveTenantOrAdmin(tenantId, "htmlToPdfAndUpload"));

  let driveUrl: string | null = null;
  try {
    const driveResult = await uploadAndShare({ filePath, fileName: `${title}.pdf`, mimeType: "application/pdf", folderLabel, share: true });
    if ((driveResult as any)?.webViewLink) {
      driveUrl = (driveResult as any).webViewLink;
      console.log(`[pdf] Uploaded to Drive: ${driveUrl}`);
    }
  } catch (err: any) {
    console.warn(`[pdf] Drive upload failed: ${err.message}`);
  }

  return {
    success: true,
    title,
    filename,
    size: pdfBuffer.length,
    driveUrl,
    localPath: `/uploads/${filename}`,
    message: driveUrl
      ? `Presentation "${title}" created and uploaded to Google Drive: ${driveUrl}`
      : `Presentation "${title}" created: /uploads/${filename}`,
  };
}

export interface PdfSection {
  title: string;
  content?: string;
  bullets?: string[];
  subsections?: Array<{ title: string; content?: string; bullets?: string[] }>;
  table?: { headers: string[]; rows: string[][] };
  highlight?: string;
  twoColumn?: { left: PdfSection; right: PdfSection };
}

export interface PdfCoverStats {
  label: string;
  value: string;
}

export interface StyledPdfOptions {
  title: string;
  subtitle?: string;
  companyLines?: string[];
  coverStats?: PdfCoverStats[];
  sections: PdfSection[];
  footerLines?: string[];
  orientation?: "portrait" | "landscape";
  fileName?: string;
  folderLabel?: string;
  uploadToDrive?: boolean;
  tenantId?: number;
}

function escHtml(s: string | undefined | null): string {
  if (s === undefined || s === null) {
    console.warn(`[pdf] escHtml received ${s} — returning empty string (caller passed undefined field; check section schema: title/content/bullets)`);
    return "";
  }
  const str = typeof s === "string" ? s : String(s);
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderSection(sec: PdfSection): string {
  let html = "";

  if (sec.highlight) {
    html += `<div class="highlight-box"><p>${escHtml(sec.highlight)}</p></div>`;
  }

  if (sec.content) {
    html += `<p>${escHtml(sec.content)}</p>`;
  }

  if (sec.bullets && sec.bullets.length > 0) {
    html += "<ul>" + sec.bullets.map(b => {
      const boldMatch = b.match(/^(.+?):\s(.+)$/);
      if (boldMatch) return `<li><strong>${escHtml(boldMatch[1])}:</strong> ${escHtml(boldMatch[2])}</li>`;
      return `<li>${escHtml(b)}</li>`;
    }).join("") + "</ul>";
  }

  if (sec.table) {
    html += `<table class="data-table"><tr>${sec.table.headers.map(h => `<th>${escHtml(h)}</th>`).join("")}</tr>`;
    for (const row of sec.table.rows) {
      html += `<tr>${row.map((cell, i) => i === 1 ? `<td><strong>${escHtml(cell)}</strong></td>` : `<td>${escHtml(cell)}</td>`).join("")}</tr>`;
    }
    html += "</table>";
  }

  if (sec.subsections) {
    for (const sub of sec.subsections) {
      html += `<div class="sub-title">${escHtml(sub.title)}</div>`;
      html += renderSection(sub);
    }
  }

  if (sec.twoColumn) {
    html += `<div class="two-col"><div>${renderSection(sec.twoColumn.left)}</div><div>${renderSection(sec.twoColumn.right)}</div></div>`;
  }

  return html;
}

function buildStyledHtml(opts: StyledPdfOptions): string {
  let qrDataUri = "";
  try {
    const qrFile = process.env.SITE_QR_CODE_FILE || "data/qr-code-agenticcorporation.png";
    const qrPath = path.resolve(WORKSPACE_ROOT, qrFile);
    const qrBuf = fs.readFileSync(qrPath);
    qrDataUri = `data:image/png;base64,${qrBuf.toString("base64")}`;
  } catch (_silentErr) { logSilentCatch("server/pdf-create.ts", _silentErr); }

  let logoDataUri = "";
  try {
    const logoPath = path.resolve(WORKSPACE_ROOT, "data/visionclaw-logo.png");
    const logoBuf = fs.readFileSync(logoPath);
    logoDataUri = `data:image/png;base64,${logoBuf.toString("base64")}`;
  } catch (_silentErr) { logSilentCatch("server/pdf-create.ts", _silentErr); }

  const companyHtml = (opts.companyLines || []).map(l => `<div class="company">${escHtml(l)}</div>`).join("");

  const statsHtml = opts.coverStats && opts.coverStats.length > 0
    ? `<div class="stats-grid">${opts.coverStats.map(s => `<div class="stat"><div class="num">${escHtml(s.value)}</div><div class="label">${escHtml(s.label)}</div></div>`).join("")}</div>`
    : "";

  const sectionsHtml = opts.sections.map(sec => {
    return `<div class="section-title">${escHtml(sec.title)}</div>${renderSection(sec)}`;
  }).join("");

  const footerHtml = opts.footerLines && opts.footerLines.length > 0
    ? `<div class="footer">${opts.footerLines.map(l => `<p>${escHtml(l)}</p>`).join("")}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(opts.title)}</title>
<style>
  @page { size: letter${opts.orientation === "landscape" ? " landscape" : ""}; margin: 0.5in 0.6in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; color: #1a1a2e; font-size: 10px; line-height: 1.5; }

  .cover { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); color: white; padding: 60px 40px; page-break-after: always; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; }
  .cover h1 { font-size: 36px; font-weight: 800; margin-bottom: 8px; letter-spacing: -0.5px; }
  .cover .subtitle { font-size: 16px; color: #00d4ff; margin-bottom: 30px; font-weight: 600; }
  .cover .company { font-size: 13px; color: #aab; margin-bottom: 4px; }
  .cover .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 30px; }
  .cover .stat { background: rgba(255,255,255,0.08); border-radius: 8px; padding: 14px; border-left: 3px solid #00d4ff; }
  .cover .stat .num { font-size: 22px; font-weight: 700; color: #00d4ff; }
  .cover .stat .label { font-size: 9px; color: #aab; text-transform: uppercase; letter-spacing: 0.5px; }

  .section-title { background: #1a1a2e; color: #00d4ff; padding: 6px 12px; font-size: 12px; font-weight: 700; margin: 16px 0 8px 0; border-radius: 3px; page-break-after: avoid; text-transform: uppercase; letter-spacing: 0.5px; }
  .sub-title { font-size: 10.5px; font-weight: 700; color: #1a1a2e; margin: 8px 0 3px 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 2px; page-break-after: avoid; }
  p { margin: 3px 0; font-size: 9.5px; color: #333; }
  ul { margin: 2px 0 6px 16px; padding: 0; }
  li { font-size: 9.5px; color: #333; margin: 1.5px 0; }
  li strong { color: #1a1a2e; }

  .data-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9px; }
  .data-table th { background: #1a1a2e; color: #00d4ff; padding: 4px 8px; text-align: left; font-size: 8.5px; text-transform: uppercase; }
  .data-table td { padding: 3px 8px; border-bottom: 1px solid #eee; }
  .data-table tr:nth-child(even) td { background: #f8f9fa; }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
  .highlight-box { background: #f0f7ff; border-left: 3px solid #00d4ff; padding: 8px 12px; margin: 6px 0; border-radius: 0 4px 4px 0; }
  .highlight-box p { font-size: 9px; }
  .footer { margin-top: 20px; padding-top: 8px; border-top: 2px solid #1a1a2e; font-size: 8px; color: #999; text-align: center; }
</style>
</head>
<body>
<div class="cover">
  ${logoDataUri ? `<img src="${logoDataUri}" alt="${process.env.SITE_PLATFORM_NAME || "Platform"}" style="max-width:280px;height:auto;margin-bottom:20px;" />` : ""}
  <h1>${escHtml(opts.title)}</h1>
  ${opts.subtitle ? `<div class="subtitle">${escHtml(opts.subtitle)}</div>` : ""}
  ${companyHtml}
  ${process.env.SITE_OWNER_PHONE ? `<div class="company">Ph. ${process.env.SITE_OWNER_PHONE}</div>` : ""}
  ${statsHtml}
</div>
${sectionsHtml}
${footerHtml}
<div class="platform-url" style="page-break-before:always;text-align:center;padding:60px 40px 40px;">
  <div style="background:linear-gradient(135deg,#1a1a2e,#0f3460);border-radius:12px;padding:40px;max-width:500px;margin:0 auto;">
    <p style="color:#00d4ff;font-size:18px;font-weight:700;letter-spacing:1px;margin:0 0 24px;">Visit Us</p>
    ${logoDataUri ? `<img src="${logoDataUri}" alt="${process.env.SITE_PLATFORM_NAME || "Platform"}" style="max-width:240px;height:auto;margin:0 auto 20px;display:block;" />` : ""}
    ${qrDataUri ? `<img src="${qrDataUri}" alt="QR Code" style="width:220px;height:220px;margin:0 auto 24px;display:block;border-radius:8px;border:3px solid #00d4ff;" />` : ""}
    ${process.env.SITE_WEBSITE_URL ? `<a href="${process.env.SITE_WEBSITE_URL}" style="color:#fff;font-size:20px;font-weight:800;text-decoration:none;letter-spacing:0.5px;">${process.env.SITE_WEBSITE_URL.replace(/^https?:\/\//, "")}</a>` : ""}
    <p style="color:#8899aa;font-size:12px;margin-top:16px;">${[process.env.SITE_COMPANY_LEGAL || process.env.SITE_COMPANY_NAME, process.env.SITE_LOCATION, process.env.SITE_OWNER_PHONE ? "Ph. " + process.env.SITE_OWNER_PHONE : ""].filter(Boolean).join(" | ")}</p>
  </div>
</div>
</body>
</html>`;
}

export async function generateStyledPdf(opts: StyledPdfOptions): Promise<{
  success: boolean;
  fileId?: string;
  viewUrl?: string;
  downloadUrl?: string;
  localPath?: string;
  size?: number;
  error?: string;
}> {
  const browserlessKey = process.env.BROWSERLESS_API_KEY;
  if (!browserlessKey) {
    return { success: false, error: "BROWSERLESS_API_KEY not configured" };
  }

  const html = buildStyledHtml(opts);
  console.log(`[pdf] Generating styled PDF: "${opts.title}" (${html.length} chars HTML)...`);

  const _bl2Ctrl = new AbortController();
  const _bl2Timer = setTimeout(() => _bl2Ctrl.abort(), BROWSERLESS_PDF_TIMEOUT_MS);
  try {
    const resp = await fetch(`https://production-sfo.browserless.io/pdf?token=${browserlessKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: _bl2Ctrl.signal as any,
      body: JSON.stringify({
        html,
        options: {
          format: "Letter",
          landscape: opts.orientation === "landscape",
          printBackground: true,
          margin: { top: "0.4in", bottom: "0.4in", left: "0.5in", right: "0.5in" },
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[pdf] Browserless failed: ${resp.status} ${errText.slice(0, 200)}`);
      return { success: false, error: `PDF render failed: ${resp.status}` };
    }

    const pdfBuffer = Buffer.from(await resp.arrayBuffer());
    console.log(`[pdf] Browserless rendered: ${pdfBuffer.length} bytes`);

    const slug = (opts.fileName || opts.title).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const filename = `${slug}.pdf`;
    const filePath = path.join(OUTPUT_DIR, filename);

    ensureOutputDir();
    fs.writeFileSync(filePath, pdfBuffer);
    await persistToDb(filename, `${opts.title}.pdf`, new Uint8Array(pdfBuffer), resolveTenantOrAdmin(opts.tenantId, "generateStyledPdf"));

    let viewUrl: string | undefined;
    let downloadUrl: string | undefined;
    let fileId: string | undefined;

    if (opts.uploadToDrive !== false) {
      try {
        const driveResult = await uploadAndShare({
          filePath,
          fileName: `${opts.title}.pdf`,
          mimeType: "application/pdf",
          folderLabel: opts.folderLabel || "deliverables",
          share: true,
          parentFolderId: (opts as any)._projectDriveFolderId || undefined,
        });
        if (driveResult?.viewUrl) {
          viewUrl = driveResult.viewUrl;
          downloadUrl = driveResult.downloadUrl;
          fileId = driveResult.fileId;
          console.log(`[pdf] Uploaded to Drive: ${viewUrl}`);
        }
      } catch (err: any) {
        console.warn(`[pdf] Drive upload failed: ${err.message}`);
      }
    }

    return {
      success: true,
      fileId,
      viewUrl,
      downloadUrl,
      localPath: `/uploads/${filename}`,
      size: pdfBuffer.length,
    };
  } catch (err: any) {
    console.error(`[pdf] generateStyledPdf error: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    clearTimeout(_bl2Timer);
  }
}
