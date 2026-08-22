import fs from "fs";
import path from "path";
import { uploadAndShare } from "./google-drive";

const OUTPUT_DIR = path.join(process.cwd(), "uploads");

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface DocxSection {
  heading?: string;
  content?: string;
  bullets?: string[];
  level?: number;
  table?: { headers: string[]; rows: string[][] };
}

interface DocxOptions {
  title: string;
  subtitle?: string;
  author?: string;
  sections: DocxSection[];
  headerText?: string;
  footerText?: string;
  fileName?: string;
  folderLabel?: string;
}

export async function createDocx(opts: DocxOptions): Promise<{
  success: boolean;
  viewUrl?: string;
  downloadUrl?: string;
  localPath?: string;
  error?: string;
}> {
  try {
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel,
      AlignmentType, Header, Footer,
      Table, TableRow, TableCell, WidthType, BorderStyle,
      PageNumber, ShadingType,
    } = await import("docx");

    const children: any[] = [];

    children.push(new Paragraph({
      children: [new TextRun({ text: opts.title, bold: true, size: 56, font: "Arial", color: "1a1a2e" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }));

    if (opts.subtitle) {
      children.push(new Paragraph({
        children: [new TextRun({ text: opts.subtitle, size: 28, font: "Arial", color: "0f3460", italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }));
    }

    if (opts.author) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `Author: ${opts.author}`, size: 22, font: "Arial", color: "666666" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      }));
    }

    for (const sec of opts.sections) {
      if (sec.heading) {
        const headingLevel = sec.level === 2 ? HeadingLevel.HEADING_2 :
                             sec.level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_1;
        children.push(new Paragraph({
          text: sec.heading,
          heading: headingLevel,
          spacing: { before: 300, after: 150 },
        }));
      }

      if (sec.content) {
        const paragraphs = sec.content.split("\n").filter((p: string) => p.trim());
        for (const p of paragraphs) {
          children.push(new Paragraph({
            children: [new TextRun({ text: p, size: 22, font: "Arial" })],
            spacing: { after: 120 },
          }));
        }
      }

      if (sec.bullets && sec.bullets.length > 0) {
        for (const bullet of sec.bullets) {
          const boldMatch = bullet.match(/^(.+?):\s(.+)$/);
          if (boldMatch) {
            children.push(new Paragraph({
              children: [
                new TextRun({ text: `${boldMatch[1]}: `, bold: true, size: 22, font: "Arial" }),
                new TextRun({ text: boldMatch[2], size: 22, font: "Arial" }),
              ],
              bullet: { level: 0 },
              spacing: { after: 60 },
            }));
          } else {
            children.push(new Paragraph({
              children: [new TextRun({ text: bullet, size: 22, font: "Arial" })],
              bullet: { level: 0 },
              spacing: { after: 60 },
            }));
          }
        }
      }

      if (sec.table) {
        const headerRow = new TableRow({
          children: sec.table.headers.map((h: string) => new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: h, bold: true, size: 20, font: "Arial", color: "FFFFFF" })],
              alignment: AlignmentType.CENTER,
            })],
            shading: { type: ShadingType.SOLID, color: "1a1a2e" },
            width: { size: Math.floor(9000 / sec.table!.headers.length), type: WidthType.DXA },
          })),
        });

        const dataRows = sec.table.rows.map((row: string[], rowIdx: number) => new TableRow({
          children: row.map((cell: string) => new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: cell, size: 20, font: "Arial" })],
            })],
            shading: rowIdx % 2 === 0 ? { type: ShadingType.SOLID, color: "f5f5f5" } : undefined,
            width: { size: Math.floor(9000 / sec.table!.headers.length), type: WidthType.DXA },
          })),
        }));

        children.push(new Paragraph({ spacing: { before: 100 } }));
        children.push(new Table({
          rows: [headerRow, ...dataRows],
          width: { size: 9000, type: WidthType.DXA },
        }));
        children.push(new Paragraph({ spacing: { after: 200 } }));
      }
    }

    const headerContent = opts.headerText ? [new Paragraph({
      children: [new TextRun({ text: opts.headerText, size: 16, font: "Arial", color: "999999" })],
      alignment: AlignmentType.RIGHT,
    })] : [new Paragraph({ children: [new TextRun({ text: (process.env.SITE_PLATFORM_NAME || "VisionClaw") + " Agent Platform", size: 16, font: "Arial", color: "999999" })], alignment: AlignmentType.RIGHT })];

    const defaultFooter = `${process.env.SITE_COMPANY_LEGAL || process.env.SITE_COMPANY_NAME || "VisionClaw"} — Confidential`;
    const footerContent = [new Paragraph({
      children: [
        new TextRun({ text: opts.footerText || defaultFooter, size: 16, font: "Arial", color: "999999" }),
        new TextRun({ text: "  |  Page ", size: 16, font: "Arial", color: "999999" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: "999999" }),
      ],
      alignment: AlignmentType.CENTER,
    })];

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: { default: new Header({ children: headerContent }) },
        footers: { default: new Footer({ children: footerContent }) },
        children,
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const slug = (opts.fileName || opts.title).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const filename = `${slug}.docx`;
    const filePath = path.join(OUTPUT_DIR, filename);

    ensureOutputDir();
    fs.writeFileSync(filePath, buffer);
    console.log(`[docx] Created: ${filename} (${buffer.length} bytes)`);

    let viewUrl: string | undefined;
    let downloadUrl: string | undefined;

    try {
      const driveResult = await uploadAndShare({
        filePath,
        fileName: `${opts.title}.docx`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        folderLabel: opts.folderLabel || "deliverables",
        share: true,
        parentFolderId: (opts as any)._projectDriveFolderId || undefined,
      });
      if (driveResult?.viewUrl) {
        viewUrl = driveResult.viewUrl;
        downloadUrl = driveResult.downloadUrl;
        console.log(`[docx] Uploaded to Drive: ${viewUrl}`);
      }
    } catch (err: any) {
      console.warn(`[docx] Drive upload failed: ${err.message}`);
    }

    return { success: true, viewUrl, downloadUrl, localPath: `/uploads/${filename}` };
  } catch (err: any) {
    console.error(`[docx] Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

interface XlsxSheet {
  name: string;
  headers: string[];
  rows: (string | number)[][];
  columnWidths?: number[];
  formulas?: Array<{ cell: string; formula: string }>;
}

interface XlsxOptions {
  title: string;
  sheets: XlsxSheet[];
  author?: string;
  fileName?: string;
  folderLabel?: string;
}

export async function createXlsx(opts: XlsxOptions): Promise<{
  success: boolean;
  viewUrl?: string;
  downloadUrl?: string;
  localPath?: string;
  error?: string;
}> {
  try {
    // @ts-ignore - exceljs types not bundled
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.default.Workbook();
    const { siteConfig: _sc } = await import("./site-config");
    workbook.creator = opts.author || `${_sc.platformName} Agent Platform`;
    workbook.created = new Date();

    for (const sheetDef of opts.sheets) {
      const sheet = workbook.addWorksheet(sheetDef.name);

      const headerRow = sheet.addRow(sheetDef.headers);
      headerRow.eachCell((cell: any) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a1a2e" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Arial" };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin", color: { argb: "FF333333" } },
          bottom: { style: "thin", color: { argb: "FF333333" } },
          left: { style: "thin", color: { argb: "FF333333" } },
          right: { style: "thin", color: { argb: "FF333333" } },
        };
      });
      headerRow.height = 24;

      sheetDef.rows.forEach((rowData: (string | number)[], rowIdx: number) => {
        const row = sheet.addRow(rowData);
        row.eachCell((cell: any) => {
          cell.font = { size: 10, name: "Arial" };
          cell.alignment = { vertical: "middle" };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE0E0E0" } },
            bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
            left: { style: "thin", color: { argb: "FFE0E0E0" } },
            right: { style: "thin", color: { argb: "FFE0E0E0" } },
          };
          if (rowIdx % 2 === 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
          }
          if (typeof cell.value === "number") {
            cell.alignment = { horizontal: "right", vertical: "middle" };
            if (Math.abs(cell.value) >= 1000) {
              cell.numFmt = "#,##0";
            }
            if (cell.value > 0 && cell.value < 1 && String(rowData[cell.col - 1]).includes("%")) {
              cell.numFmt = "0.0%";
            }
          }
        });
      });

      if (sheetDef.formulas) {
        for (const f of sheetDef.formulas) {
          const cell = sheet.getCell(f.cell);
          cell.value = { formula: f.formula } as any;
          cell.font = { size: 10, name: "Arial", bold: true };
        }
      }

      if (sheetDef.columnWidths) {
        sheetDef.columnWidths.forEach((w: number, i: number) => {
          const col = sheet.getColumn(i + 1);
          col.width = w;
        });
      } else {
        sheetDef.headers.forEach((_: string, i: number) => {
          const col = sheet.getColumn(i + 1);
          let maxLen = sheetDef.headers[i].length;
          for (const row of sheetDef.rows) {
            const cellLen = String(row[i] || "").length;
            if (cellLen > maxLen) maxLen = cellLen;
          }
          col.width = Math.min(Math.max(maxLen + 4, 10), 50);
        });
      }

      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheetDef.headers.length },
      };

      sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];
    }

    const slug = (opts.fileName || opts.title).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const filename = `${slug}.xlsx`;
    const filePath = path.join(OUTPUT_DIR, filename);

    ensureOutputDir();
    await workbook.xlsx.writeFile(filePath);
    const stats = fs.statSync(filePath);
    console.log(`[xlsx] Created: ${filename} (${stats.size} bytes)`);

    let viewUrl: string | undefined;
    let downloadUrl: string | undefined;

    try {
      const driveResult = await uploadAndShare({
        filePath,
        fileName: `${opts.title}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        folderLabel: opts.folderLabel || "deliverables",
        share: true,
        parentFolderId: (opts as any)._projectDriveFolderId || undefined,
      });
      if (driveResult?.viewUrl) {
        viewUrl = driveResult.viewUrl;
        downloadUrl = driveResult.downloadUrl;
        console.log(`[xlsx] Uploaded to Drive: ${viewUrl}`);
      }
    } catch (err: any) {
      console.warn(`[xlsx] Drive upload failed: ${err.message}`);
    }

    return { success: true, viewUrl, downloadUrl, localPath: `/uploads/${filename}` };
  } catch (err: any) {
    console.error(`[xlsx] Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}
