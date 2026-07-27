/**
 * Tools-layer-split S11 — documents-domain migrated handlers.
 *
 * Selection: the 8 PDF / office-document tools that cluster contiguously in
 * both the legacy TOOL_DEFINITIONS array and the legacy switch — `analyze_pdf`,
 * `create_pdf`, `create_styled_report`, `fill_pdf`, `create_document`,
 * `create_spreadsheet`, `edit_pdf`, `list_pdf_fields`. Their only trust
 * channel is `_tenantId`, covered by the trusted ToolContext seam.
 * `_projectDriveFolderId` and `_projectId` are NOT trust signals — the
 * dispatcher's `stripTrustSignals` removes only `_tenantId` / `_personaId` /
 * `_conversationId` / `_approvedByGate` / `_rateLimitChecked`, so those
 * runtime-context fields survive on `params` exactly as the legacy arms read
 * them. Adjacent tools stay legacy per the smallest-safe-batch precedent (S3):
 * `create_slides` / `generate_chart` cluster with the media/presentation
 * region (later slice) and `project` is workspace-domain.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). The ONLY
 * edits: caller-supplied `params._tenantId` reads become `ctx.tenantId` (the
 * dispatcher strips + re-stamps it from the trusted context), and every external
 * dependency (../../../pdf-tool, ../../../pdf-create, ../../../doc-create) is
 * pulled via a call-time dynamic `import(...)` inside the handler — NOT a
 * top-level static import — so the domain module statically imports only within
 * server/tools/ and cannot recurse back into the app graph (acyclicity
 * invariant, plan.md S2; same seam S8/S9 used). No tools.ts module-scope
 * helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  analyzePdfDefinition,
  createPdfDefinition,
  createStyledReportDefinition,
  fillPdfDefinition,
  createDocumentDefinition,
  createSpreadsheetDefinition,
  editPdfDefinition,
  listPdfFieldsDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function analyzePdfHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { extractPdfText } = await import("../../../pdf-tool");
  return extractPdfText(params.pdf, {
    pages: params.pages,
    maxBytes: params.maxBytesMb,
  });
}

async function createPdfHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { createPdf } = await import("../../../pdf-create");
  return createPdf({
    title: params.title,
    content: params.content,
    sections: params.sections,
    fields: params.fields,
    headerImage: params.headerImage,
    fontSize: params.fontSize,
    pageSize: params.pageSize,
    outputPath: params.outputPath,
    customerName: params.customerName,
    folderLabel: params.folderLabel,
    tenantId: ctx.tenantId,
    _projectDriveFolderId: params._projectDriveFolderId,
  } as any);
}

async function createStyledReportHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { generateStyledPdf } = await import("../../../pdf-create");
  return generateStyledPdf({
    title: params.title,
    subtitle: params.subtitle,
    companyLines: params.companyLines,
    coverStats: params.coverStats,
    sections: (params.sections || []).map((s: any) => ({
      title: s.title || "Section",
      content: s.content,
      bullets: s.bullets,
      highlight: s.highlight,
      subsections: s.subsections,
      table: s.table,
      twoColumn: s.twoColumn,
    })),
    footerLines: params.footerLines,
    orientation: params.orientation,
    fileName: params.fileName,
    folderLabel: params.folderLabel || "deliverables",
    tenantId: ctx.tenantId,
    _projectDriveFolderId: params._projectDriveFolderId,
  } as any);
}

async function fillPdfHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { fillPdf } = await import("../../../pdf-create");
  return fillPdf({
    inputPath: params.inputPath,
    fields: params.fields,
    outputPath: params.outputPath,
    flatten: params.flatten,
    tenantId: ctx.tenantId,
  });
}

async function createDocumentHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  if (!params.title || typeof params.title !== "string") return { error: "title is required and must be a string" };
  const sections = Array.isArray(params.sections) ? params.sections : [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (typeof s !== "object" || s === null) return { error: `sections[${i}] must be an object` };
    if (s.table && (!Array.isArray(s.table.headers) || !Array.isArray(s.table.rows))) {
      return { error: `sections[${i}].table must have headers (array) and rows (array of arrays)` };
    }
    if (s.bullets && !Array.isArray(s.bullets)) return { error: `sections[${i}].bullets must be an array` };
  }
  const { createDocx } = await import("../../../doc-create");
  return createDocx({
    title: params.title,
    subtitle: typeof params.subtitle === "string" ? params.subtitle : undefined,
    author: typeof params.author === "string" ? params.author : undefined,
    sections,
    headerText: typeof params.headerText === "string" ? params.headerText : undefined,
    footerText: typeof params.footerText === "string" ? params.footerText : undefined,
    fileName: typeof params.fileName === "string" ? params.fileName : undefined,
    folderLabel: typeof params.folderLabel === "string" ? params.folderLabel : undefined,
    _projectDriveFolderId: params._projectDriveFolderId,
  } as any);
}

async function createSpreadsheetHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  if (!params.title || typeof params.title !== "string") return { error: "title is required and must be a string" };
  const sheets = Array.isArray(params.sheets) ? params.sheets : [];
  if (sheets.length === 0) return { error: "At least one sheet is required" };
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    if (typeof sh !== "object" || sh === null) return { error: `sheets[${i}] must be an object` };
    if (!sh.name || typeof sh.name !== "string") return { error: `sheets[${i}].name is required` };
    if (!Array.isArray(sh.headers) || sh.headers.length === 0) return { error: `sheets[${i}].headers must be a non-empty array` };
    if (!Array.isArray(sh.rows)) return { error: `sheets[${i}].rows must be an array` };
    if (sh.formulas && !Array.isArray(sh.formulas)) return { error: `sheets[${i}].formulas must be an array` };
  }
  const { createXlsx } = await import("../../../doc-create");
  return createXlsx({
    title: params.title,
    sheets,
    author: typeof params.author === "string" ? params.author : undefined,
    fileName: typeof params.fileName === "string" ? params.fileName : undefined,
    folderLabel: typeof params.folderLabel === "string" ? params.folderLabel : undefined,
    _projectDriveFolderId: params._projectDriveFolderId,
  } as any);
}

async function editPdfHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { editPdf } = await import("../../../pdf-create");
  return editPdf({
    inputPath: params.inputPath,
    addText: params.addText,
    addFields: params.addFields,
    addPages: params.addPages,
    removePages: params.removePages,
    outputPath: params.outputPath,
    tenantId: ctx.tenantId,
  });
}

async function listPdfFieldsHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { listPdfFields } = await import("../../../pdf-create");
  return listPdfFields(params.inputPath);
}

/** Registered by ./index.ts at import time. */
export const documentsDomainTools: RegisteredTool[] = [
  defineTool(analyzePdfDefinition, analyzePdfHandler),
  defineTool(createPdfDefinition, createPdfHandler),
  defineTool(createStyledReportDefinition, createStyledReportHandler),
  defineTool(fillPdfDefinition, fillPdfHandler),
  defineTool(createDocumentDefinition, createDocumentHandler),
  defineTool(createSpreadsheetDefinition, createSpreadsheetHandler),
  defineTool(editPdfDefinition, editPdfHandler),
  defineTool(listPdfFieldsDefinition, listPdfFieldsHandler),
];
