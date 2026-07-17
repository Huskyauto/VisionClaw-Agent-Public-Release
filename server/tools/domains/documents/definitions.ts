/**
 * Tools-layer-split S11 — documents-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical.
 */

import type { ToolDefinition } from "../../types";

export const analyzePdfDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "analyze_pdf",
    description: "Extract and analyze text from a PDF document. Accepts a URL or local file path. Returns extracted text, page count, and metadata. Use for reading documents, reports, contracts, or any PDF content.",
    parameters: {
      type: "object",
      properties: {
        pdf: { type: "string", description: "PDF URL (https://...) or local file path" },
        pages: { type: "string", description: "Optional page filter like '1-5' or '1,3,7-9'. Omit to extract all pages." },
        prompt: { type: "string", description: "Optional analysis prompt — what to focus on or extract from the PDF" },
        maxBytesMb: { type: "number", description: "Max PDF size in MB (default 10)" },
      },
      required: ["pdf"],
    },
  },
};

export const createPdfDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_pdf",
    description: "Low-level PDF tool for fillable forms and simple documents ONLY. For reports, analyses, deliverables, or any professional document, use create_styled_pdf instead — it produces premium executive-quality output with branded cover pages, stats grids, data tables, highlight boxes, and two-column layouts. This tool (create_pdf) supports multi-page documents, header logos, and fillable form fields. Auto-uploads to Google Drive. NEVER use this for reports or deliverables — always prefer create_styled_pdf.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title (appears at top and in metadata)" },
        content: { type: "string", description: "Main text content. Use \\n for line breaks and paragraphs." },
        sections: {
          type: "array",
          description: "Optional structured sections with headings and body text",
          items: {
            type: "object",
            properties: {
              heading: { type: "string", description: "Section heading" },
              body: { type: "string", description: "Section body text" },
            },
            required: ["body"],
          },
        },
        fields: {
          type: "array",
          description: "Fillable form fields — makes the PDF interactive and editable",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Unique field name (used to reference the field)" },
              type: { type: "string", enum: ["text", "checkbox", "dropdown"], description: "Field type" },
              label: { type: "string", description: "Label shown above the field" },
              x: { type: "number", description: "X position from left edge (points, 72 = 1 inch)" },
              y: { type: "number", description: "Y position from bottom edge (points)" },
              width: { type: "number", description: "Field width in points (default 200)" },
              height: { type: "number", description: "Field height in points (default 24)" },
              value: { type: "string", description: "Default value" },
              options: { type: "array", items: { type: "string" }, description: "Options for dropdown fields" },
              required: { type: "boolean", description: "Whether the field is required" },
              multiline: { type: "boolean", description: "Whether text field supports multiple lines" },
            },
            required: ["name", "type", "x", "y"],
          },
        },
        headerImage: {
          type: "object",
          description: "Logo or image to display at the top of the first page. Supports PNG and JPG. Use list_uploads to find previously uploaded images.",
          properties: {
            path: { type: "string", description: "Path to the image file (e.g. 'uploads/abc123.png' or just the filename)" },
            width: { type: "number", description: "Display width in points (72 = 1 inch). Height auto-calculated to maintain aspect ratio." },
            height: { type: "number", description: "Display height in points (optional, overrides auto-calculation)" },
            alignment: { type: "string", enum: ["left", "center", "right"], description: "Horizontal alignment (default center)" },
          },
          required: ["path"],
        },
        fontSize: { type: "number", description: "Base font size (default 12)" },
        pageSize: { type: "string", enum: ["letter", "a4", "legal"], description: "Page size (default letter)" },
        outputPath: { type: "string", description: "Output filename (default auto-generated)" },
        customerName: { type: "string", description: "Customer name — used to label the Google Drive dated folder (e.g. '2026-03-15_14-30-00_JohnSmith')" },
        folderLabel: { type: "string", description: "Custom label for the Drive subfolder. If omitted, uses customerName or title." },
      },
    },
  },
};

export const createStyledReportDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_styled_report",
    description: "Create a PREMIUM styled PDF report with professional cover page, branded colors, stats grid, data tables, highlight boxes, two-column layouts, and auto-uploaded to Google Drive. This is the TOP-TIER PDF system — use it for ALL reports, analyses, deliverables, and professional documents. Produces polished, executive-quality output with dark gradient cover, section headers, bullet formatting, and responsive tables. ALWAYS prefer this over create_pdf for any report or document.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Report title (appears on cover page, large text)" },
        subtitle: { type: "string", description: "Subtitle (appears below title on cover, e.g. 'Q2 2026 Analysis')" },
        companyLines: {
          type: "array",
          items: { type: "string" },
          description: "Company info lines on cover (e.g. ['Your Company LLC', 'City, State', 'April 2026'])",
        },
        coverStats: {
          type: "array",
          description: "Key metrics displayed in a grid on the cover page",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Metric label (e.g. 'Total Revenue')" },
              value: { type: "string", description: "Metric value (e.g. '$1.2M')" },
            },
            required: ["label", "value"],
          },
        },
        sections: {
          type: "array",
          description: "Report sections — each can have content, bullets, tables, highlights, subsections, or two-column layouts",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Section heading" },
              content: { type: "string", description: "Paragraph text for this section" },
              highlight: { type: "string", description: "Highlighted callout box text (appears in a colored box)" },
              bullets: {
                type: "array",
                items: { type: "string" },
                description: "Bullet points. Use 'Bold Label: description' format for auto-bold labels.",
              },
              subsections: {
                type: "array",
                description: "Sub-sections within this section",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    content: { type: "string" },
                    bullets: { type: "array", items: { type: "string" } },
                  },
                  required: ["title"],
                },
              },
              table: {
                type: "object",
                description: "Data table with headers and rows",
                properties: {
                  headers: { type: "array", items: { type: "string" }, description: "Column headers" },
                  rows: {
                    type: "array",
                    items: { type: "array", items: { type: "string" } },
                    description: "Row data (array of arrays)",
                  },
                },
                required: ["headers", "rows"],
              },
              twoColumn: {
                type: "object",
                description: "Two-column layout — left and right sections side by side",
                properties: {
                  left: { type: "object", description: "Left column section (same structure: title, content, bullets)" },
                  right: { type: "object", description: "Right column section" },
                },
              },
            },
            required: ["title"],
          },
        },
        footerLines: {
          type: "array",
          items: { type: "string" },
          description: "Footer text lines (e.g. ['Confidential', 'Your Company © 2026'])",
        },
        orientation: { type: "string", enum: ["portrait", "landscape"], description: "Page orientation (default portrait)" },
        fileName: { type: "string", description: "Output filename (without .pdf extension)" },
        folderLabel: { type: "string", description: "Google Drive subfolder label (default 'deliverables')" },
      },
      required: ["title", "sections"],
    },
  },
};

export const fillPdfDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "fill_pdf",
    description: "Fill in form fields of an existing fillable PDF. Set values for text fields, check/uncheck checkboxes, and select dropdown options. Optionally flatten the form (make it non-editable). Use for completing forms, applications, or any fillable PDF.",
    parameters: {
      type: "object",
      properties: {
        inputPath: { type: "string", description: "Path to the fillable PDF file" },
        fields: {
          type: "object",
          description: "Field name-value pairs. Use strings for text/dropdown, true/false for checkboxes.",
          additionalProperties: true,
        },
        outputPath: { type: "string", description: "Output filename (default adds _filled suffix)" },
        flatten: { type: "boolean", description: "If true, flattens the form — fields become static text and can no longer be edited" },
      },
      required: ["inputPath", "fields"],
    },
  },
};

export const createDocumentDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_document",
    description: "Create a professional Word document (.docx) with styled headings, body text, bullet lists, and data tables. Includes headers, footers with page numbers, and VisionClaw branding. Automatically uploads to Google Drive. Use for contracts, proposals, memos, reports, project plans, SOWs, and any formal business document.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title (displayed on first page)" },
        subtitle: { type: "string", description: "Optional subtitle under the title" },
        author: { type: "string", description: "Author name" },
        sections: {
          type: "array",
          description: "Document sections — each can have a heading, content paragraphs, bullet lists, and/or data tables",
          items: {
            type: "object",
            properties: {
              heading: { type: "string", description: "Section heading" },
              level: { type: "number", description: "Heading level: 1 (default), 2, or 3" },
              content: { type: "string", description: "Body text (supports multiple paragraphs separated by newlines)" },
              bullets: { type: "array", items: { type: "string" }, description: "Bullet points. Use 'Label: text' format for bold-label bullets" },
              table: {
                type: "object",
                description: "Data table with headers and rows",
                properties: {
                  headers: { type: "array", items: { type: "string" } },
                  rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                },
                required: ["headers", "rows"],
              },
            },
          },
        },
        headerText: { type: "string", description: "Custom header text (default: VisionClaw Agent Platform)" },
        footerText: { type: "string", description: "Custom footer text (default: Company — Confidential)" },
        fileName: { type: "string", description: "Output filename (without .docx extension)" },
        folderLabel: { type: "string", description: "Google Drive subfolder label (default 'deliverables')" },
      },
      required: ["title", "sections"],
    },
  },
};

export const createSpreadsheetDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_spreadsheet",
    description: "Create a professional Excel spreadsheet (.xlsx) with formatted headers, alternating row colors, auto-filters, frozen header row, and Excel formulas. Supports multiple sheets. Automatically uploads to Google Drive. Use for financial models, data analysis, budgets, project trackers, KPI dashboards, comparison matrices, and any structured data output.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Workbook title (used in filename and Drive)" },
        author: { type: "string", description: "Author name" },
        sheets: {
          type: "array",
          description: "One or more worksheet definitions",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Sheet tab name (e.g., 'Revenue Model', 'KPIs')" },
              headers: { type: "array", items: { type: "string" }, description: "Column headers" },
              rows: {
                type: "array",
                description: "Data rows — each row is an array of values (strings or numbers)",
                items: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
              },
              columnWidths: { type: "array", items: { type: "number" }, description: "Optional column widths (auto-sized if omitted)" },
              formulas: {
                type: "array",
                description: "Optional Excel formulas to insert",
                items: {
                  type: "object",
                  properties: {
                    cell: { type: "string", description: "Target cell (e.g., 'D12')" },
                    formula: { type: "string", description: "Excel formula (e.g., 'SUM(D2:D11)')" },
                  },
                  required: ["cell", "formula"],
                },
              },
            },
            required: ["name", "headers", "rows"],
          },
        },
        fileName: { type: "string", description: "Output filename (without .xlsx extension)" },
        folderLabel: { type: "string", description: "Google Drive subfolder label (default 'deliverables')" },
      },
      required: ["title", "sheets"],
    },
  },
};

export const editPdfDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "edit_pdf",
    description: "Edit an existing PDF — add text, add fillable form fields, add blank pages, or remove pages. The output remains editable. Use for modifying, annotating, or extending existing PDFs.",
    parameters: {
      type: "object",
      properties: {
        inputPath: { type: "string", description: "Path to the PDF file to edit" },
        addText: {
          type: "array",
          description: "Text overlays to add to the PDF",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              x: { type: "number", description: "X position from left (points)" },
              y: { type: "number", description: "Y position from bottom (points)" },
              page: { type: "number", description: "Page number (1-based, default 1)" },
              fontSize: { type: "number", description: "Font size (default 12)" },
              color: { type: "string", description: "Hex color like #FF0000 (default black)" },
            },
            required: ["text", "x", "y"],
          },
        },
        addFields: {
          type: "array",
          description: "Fillable form fields to add",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["text", "checkbox", "dropdown"] },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              options: { type: "array", items: { type: "string" } },
            },
            required: ["name", "type", "x", "y"],
          },
        },
        addPages: { type: "number", description: "Number of blank pages to append" },
        removePages: { type: "array", items: { type: "number" }, description: "Page numbers to remove (1-based)" },
        outputPath: { type: "string", description: "Output filename" },
      },
      required: ["inputPath"],
    },
  },
};

export const listPdfFieldsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_pdf_fields",
    description: "Use BEFORE filling a PDF form so you know exactly which field names exist and what type (text/checkbox/dropdown) each accepts. Required first step in the PDF-fill workflow — guessing field names usually fails. Returns field name, type, and current value for every fillable field.",
    parameters: {
      type: "object",
      properties: {
        inputPath: { type: "string", description: "Path to the PDF file" },
      },
      required: ["inputPath"],
    },
  },
};

/** Splice order mirrors the legacy TOOL_DEFINITIONS positions (analyze_pdf →
 * list_pdf_fields, contiguous). Consumed by the facade splice + the barrel. */
export const documentsDomainDefinitions: ToolDefinition[] = [
  analyzePdfDefinition,
  createPdfDefinition,
  createStyledReportDefinition,
  fillPdfDefinition,
  createDocumentDefinition,
  createSpreadsheetDefinition,
  editPdfDefinition,
  listPdfFieldsDefinition,
];
