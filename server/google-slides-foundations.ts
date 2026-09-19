export interface SlideContent {
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  speakerNotes?: string;
  layout?: "TITLE" | "TITLE_AND_BODY" | "SECTION_HEADER" | "TWO_COLUMNS" | "IMAGE_RIGHT" | "IMAGE_LEFT" | "IMAGE_FULL" | "BIG_NUMBER" | "QUOTE" | "BLANK" | "FLOWCHART" | "TABLE" | "ARCHITECTURE" | "TIMELINE" | "COMPARISON" | "METRICS_DASHBOARD" | "PROCESS";
  imageUrl?: string;
  imageCaption?: string;
  leftColumn?: { title?: string; bullets?: string[] };
  rightColumn?: { title?: string; bullets?: string[] };
  table?: { headers: string[]; rows: string[][] };
  bigNumber?: string;
  bigNumberLabel?: string;
  quote?: string;
  quoteAttribution?: string;
  accentColor?: string;
  flowSteps?: { label: string; description?: string; color?: string }[];
  timelineItems?: { date: string; title: string; description?: string }[];
  architectureTiers?: { label: string; items: string[]; color?: string }[];
  comparisonItems?: { title: string; bullets: string[]; highlight?: boolean }[];
  metrics?: { value: string; label: string; trend?: string }[];
  processSteps?: { number: string; title: string; description?: string }[];
}

export interface SlideThemePreset {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  titleBgColor: string;
  textColor: string;
  subtextColor: string;
  accentColor: string;
  fontFamily: string;
  headingFont: string;
}

const THEME_PRESETS: Record<string, SlideThemePreset> = {
  "dark-tech": {
    primaryColor: "#00d4ff",
    secondaryColor: "#7c3aed",
    backgroundColor: "#0f172a",
    titleBgColor: "#1e293b",
    textColor: "#e2e8f0",
    subtextColor: "#94a3b8",
    accentColor: "#00d4ff",
    fontFamily: "Roboto",
    headingFont: "Montserrat",
  },
  "corporate": {
    primaryColor: "#1e40af",
    secondaryColor: "#3b82f6",
    backgroundColor: "#ffffff",
    titleBgColor: "#1e40af",
    textColor: "#1e293b",
    subtextColor: "#64748b",
    accentColor: "#3b82f6",
    fontFamily: "Open Sans",
    headingFont: "Montserrat",
  },
  "startup": {
    primaryColor: "#7c3aed",
    secondaryColor: "#ec4899",
    backgroundColor: "#faf5ff",
    titleBgColor: "#7c3aed",
    textColor: "#1e1b4b",
    subtextColor: "#6b7280",
    accentColor: "#ec4899",
    fontFamily: "Inter",
    headingFont: "Inter",
  },
  "minimal": {
    primaryColor: "#18181b",
    secondaryColor: "#71717a",
    backgroundColor: "#ffffff",
    titleBgColor: "#18181b",
    textColor: "#18181b",
    subtextColor: "#71717a",
    accentColor: "#ef4444",
    fontFamily: "Roboto",
    headingFont: "Roboto",
  },
  "neon": {
    primaryColor: "#22d3ee",
    secondaryColor: "#a855f7",
    backgroundColor: "#030712",
    titleBgColor: "#111827",
    textColor: "#f9fafb",
    subtextColor: "#9ca3af",
    accentColor: "#22d3ee",
    fontFamily: "Roboto Mono",
    headingFont: "Montserrat",
  },
};

export interface SlidesCreateOptions {
  title: string;
  slides: SlideContent[];
  theme?: string | {
    primaryColor?: string;
    backgroundColor?: string;
    fontFamily?: string;
  };
  logoUrl?: string;
  _projectDriveFolderId?: string;
}

export function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255,
  };
}

export function resolveTheme(themeInput?: string | { primaryColor?: string; backgroundColor?: string; fontFamily?: string }): SlideThemePreset {
  if (!themeInput) return THEME_PRESETS["dark-tech"];
  if (typeof themeInput === "string") {
    const key = themeInput.toLowerCase().replace(/[\s_]+/g, "-");
    if (THEME_PRESETS[key]) return THEME_PRESETS[key];
    for (const [k, v] of Object.entries(THEME_PRESETS)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
    if (key.includes("dark")) return THEME_PRESETS["dark-tech"];
    if (key.includes("corp") || key.includes("business")) return THEME_PRESETS["corporate"];
    if (key.includes("startup") || key.includes("pitch")) return THEME_PRESETS["startup"];
    if (key.includes("neon") || key.includes("cyber")) return THEME_PRESETS["neon"];
    return THEME_PRESETS["dark-tech"];
  }
  const base = { ...THEME_PRESETS["dark-tech"] };
  if (themeInput.primaryColor) base.primaryColor = themeInput.primaryColor;
  if (themeInput.backgroundColor) base.backgroundColor = themeInput.backgroundColor;
  if (themeInput.fontFamily) { base.fontFamily = themeInput.fontFamily; base.headingFont = themeInput.fontFamily; }
  return base;
}

export const EMU_INCH = 914400;
export const SLIDE_W = 9144000;
export const SLIDE_H = 5143500;
export const MARGIN = 457200;

export function eid(prefix: string, index: number): string {
  return `vc_${prefix}_${index}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function safeHexToRgb(hex: string | undefined, fallback: { red: number; green: number; blue: number }): { red: number; green: number; blue: number } {
  if (!hex || typeof hex !== "string") return fallback;
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
  return hexToRgb(hex);
}

export function isValidImageUrl(url: string | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.startsWith("127.") || hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname === "0.0.0.0" || hostname.startsWith("169.254.") || hostname.endsWith(".local") || hostname.startsWith("172.") && parseInt(hostname.split(".")[1]) >= 16 && parseInt(hostname.split(".")[1]) <= 31) return false;
    const lower = url.toLowerCase();
    if (lower.includes("placeholder") || lower.includes("example.com") || lower.includes("1abc123") || lower.includes("your-image") || lower.includes("sample-image") || lower.includes("fake") || lower.includes("dummy") || /id=1[a-z]+$/i.test(lower)) return false;
    return true;
  } catch { return false; }
}

export function makeTextBox(id: string, slideId: string, x: number, y: number, w: number, h: number): any {
  return {
    createShape: {
      objectId: id,
      shapeType: "TEXT_BOX",
      elementProperties: {
        pageObjectId: slideId,
        size: { width: { magnitude: w, unit: "EMU" }, height: { magnitude: h, unit: "EMU" } },
        transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "EMU" },
      },
    },
  };
}

export function makeRect(id: string, slideId: string, x: number, y: number, w: number, h: number): any {
  return {
    createShape: {
      objectId: id,
      shapeType: "RECTANGLE",
      elementProperties: {
        pageObjectId: slideId,
        size: { width: { magnitude: w, unit: "EMU" }, height: { magnitude: h, unit: "EMU" } },
        transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "EMU" },
      },
    },
  };
}

export function fillRect(id: string, color: { red: number; green: number; blue: number }): any {
  return {
    updateShapeProperties: {
      objectId: id,
      shapeProperties: {
        shapeBackgroundFill: { solidFill: { color: { rgbColor: color } } },
        outline: { propertyState: "NOT_RENDERED" },
      },
      fields: "shapeBackgroundFill.solidFill.color,outline",
    },
  };
}

export function styleText(id: string, opts: { font: string; size: number; color: { red: number; green: number; blue: number }; bold?: boolean; italic?: boolean }): any {
  const style: any = {
    fontFamily: opts.font,
    fontSize: { magnitude: opts.size, unit: "PT" },
    foregroundColor: { opaqueColor: { rgbColor: opts.color } },
  };
  const fields = ["fontFamily", "fontSize", "foregroundColor"];
  if (opts.bold !== undefined) { style.bold = opts.bold; fields.push("bold"); }
  if (opts.italic !== undefined) { style.italic = opts.italic; fields.push("italic"); }
  return {
    updateTextStyle: {
      objectId: id,
      style,
      textRange: { type: "ALL" },
      fields: fields.join(","),
    },
  };
}

export function alignText(id: string, alignment: string): any {
  return {
    updateParagraphStyle: {
      objectId: id,
      style: { alignment },
      textRange: { type: "ALL" },
      fields: "alignment",
    },
  };
}

export function makeBullets(id: string): any[] {
  return [
    { createParagraphBullets: { objectId: id, textRange: { type: "ALL" }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } },
    { updateParagraphStyle: { objectId: id, style: { spaceAbove: { magnitude: 4, unit: "PT" }, spaceBelow: { magnitude: 4, unit: "PT" }, lineSpacing: 130 }, textRange: { type: "ALL" }, fields: "spaceAbove,spaceBelow,lineSpacing" } },
  ];
}