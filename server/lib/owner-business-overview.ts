export const OWNER_OVERVIEW_SECTIONS = [
  "storedIdeas",
  "builtinIdeas",
  "registeredProducts",
  "builtinProducts",
  "serviceOfferings",
] as const;

export type OverviewSection = typeof OWNER_OVERVIEW_SECTIONS[number];
export interface OverviewSource {
  count(): Promise<number>;
  page(offset: number, limit: number): Promise<unknown[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDatabaseCount(value: unknown): number {
  const validNumber = typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const validDigits = typeof value === "string" && /^\d+$/.test(value);
  if (!validNumber && !validDigits) throw new Error("Malformed database count; coverage is unknown");
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Database count exceeds the supported nonnegative integer range");
  }
  return count;
}

export function parseDrizzleOverviewCountResult(result: unknown): number {
  if (!Array.isArray(result) || result.length !== 1 || !isRecord(result[0]) ||
      !Object.prototype.hasOwnProperty.call(result[0], "total")) {
    throw new Error("Malformed database count result; coverage is unknown");
  }
  return parseDatabaseCount(result[0].total);
}

export function parsePostgresOverviewCountResult(result: unknown): number {
  if (!isRecord(result) || !Array.isArray(result.rows) || result.rows.length !== 1 ||
      !isRecord(result.rows[0]) || !Object.prototype.hasOwnProperty.call(result.rows[0], "total")) {
    throw new Error("Malformed PostgreSQL count result; coverage is unknown");
  }
  return parseDatabaseCount(result.rows[0].total);
}

export function parsePostgresOverviewPageResult(result: unknown): unknown[] {
  if (!isRecord(result) || !Array.isArray(result.rows)) {
    throw new Error("Malformed PostgreSQL page result; coverage is unknown");
  }
  return result.rows;
}

export function parseDrizzleOverviewPageResult(result: unknown): unknown[] {
  if (!Array.isArray(result)) throw new Error("Malformed database page result; coverage is unknown");
  return result;
}

const MAX_PAGE_SIZE = 8;
const DEFAULT_PAGE_SIZE = 5;
const MAX_OFFSET = 100_000;
const MAX_RESPONSE_CHARS = 5_000;
const MAX_ITEM_TEXT_CHARS = 400;

export function createArrayOverviewSource(records: readonly unknown[]): OverviewSource {
  return {
    count: async () => records.length,
    page: async (offset, limit) => records.slice(offset, offset + limit),
  };
}

export interface ParsedOverviewRequest {
  mode: "summary" | "page";
  section?: OverviewSection;
  offset?: number;
  pageSize?: number;
}

export function parseOwnerBusinessOverviewParams(params: unknown): ParsedOverviewRequest {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Arguments must be an object");
  }
  const input = params as Record<string, unknown>;
  const allowed = new Set(["section", "cursor", "pageSize"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Unknown overview argument");
  if (input.section === undefined) {
    if (input.cursor !== undefined || input.pageSize !== undefined) {
      throw new Error("A section is required for pagination arguments");
    }
    return { mode: "summary" };
  }
  if (typeof input.section !== "string" ||
      !OWNER_OVERVIEW_SECTIONS.includes(input.section as OverviewSection)) {
    throw new Error("Invalid overview section");
  }

  let offset = 0;
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== "string") throw new Error("Cursor must be a string");
    const match = /^obv1:(storedIdeas|builtinIdeas|registeredProducts|builtinProducts|serviceOfferings):([0-9]{1,6})$/.exec(input.cursor);
    if (!match || match[1] !== input.section) throw new Error("Malformed or mismatched cursor");
    offset = Number(match[2]);
    if (!Number.isSafeInteger(offset) || offset > MAX_OFFSET) throw new Error("Cursor offset exceeds the allowed range");
  }

  const pageSize = input.pageSize === undefined ? DEFAULT_PAGE_SIZE : input.pageSize;
  if (typeof pageSize !== "number" || !Number.isSafeInteger(pageSize) ||
      pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  return { mode: "page", section: input.section as OverviewSection, offset, pageSize };
}

function countValue(value: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Overview source returned an invalid count");
  }
  return value;
}

function recordOf(section: OverviewSection, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Malformed ${section} record; coverage is unknown`);
  return value;
}

function identityText(section: OverviewSection, key: string, value: unknown, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`Malformed ${section} record: missing ${key}; coverage is unknown`);
    return undefined;
  }
  if (typeof value !== "string" || !value.trim() || value.length >= 600) {
    throw new Error(`Malformed ${section} record: invalid ${key}; coverage is unknown`);
  }
  return value;
}

function identityId(section: OverviewSection, value: unknown, required = false): string | number | null | undefined {
  if (value === undefined) {
    if (required) throw new Error(`Malformed ${section} record: missing id; coverage is unknown`);
    return undefined;
  }
  if (value === null) {
    if (required) throw new Error(`Malformed ${section} record: missing id; coverage is unknown`);
    return null;
  }
  if (typeof value === "string" && value.trim() && value.length < 600) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  throw new Error(`Malformed ${section} record: invalid id; coverage is unknown`);
}

function optionalStringField(
  section: OverviewSection,
  row: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return undefined;
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Malformed ${section} record: invalid ${key}; coverage is unknown`);
  }
  return value;
}

function requiredStringField(section: OverviewSection, row: Record<string, unknown>, key: string): string {
  const value = optionalStringField(section, row, key);
  if (value === undefined || value === null) {
    throw new Error(`Malformed ${section} record: missing ${key}; coverage is unknown`);
  }
  return value;
}

function requiredPriceCents(section: OverviewSection, value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Malformed ${section} record: invalid priceCents; coverage is unknown`);
  }
  return value;
}

function requiredProductKind(section: OverviewSection, value: unknown): "static" | "service" {
  if (value !== "static" && value !== "service") {
    throw new Error(`Malformed ${section} record: invalid kind; coverage is unknown`);
  }
  return value;
}

function requiredBooleanField(section: OverviewSection, key: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Malformed ${section} record: invalid ${key}; coverage is unknown`);
  }
  return value;
}

function identityTextAlias(
  section: OverviewSection,
  row: Record<string, unknown>,
  keys: string[],
  label: string,
): string {
  const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(row, key));
  if (present.length === 0) throw new Error(`Malformed ${section} record: missing ${label}; coverage is unknown`);
  const values = present.map((key) => identityText(section, label, row[key], true)!);
  if (values.some((value) => value !== values[0])) {
    throw new Error(`Malformed ${section} record: conflicting ${label}; coverage is unknown`);
  }
  return values[0];
}

function requiredPriceCentsAlias(section: OverviewSection, row: Record<string, unknown>, keys: string[]): number {
  const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(row, key));
  if (present.length === 0) throw new Error(`Malformed ${section} record: missing priceCents; coverage is unknown`);
  const values = present.map((key) => requiredPriceCents(section, row[key]));
  if (values.some((value) => value !== values[0])) {
    throw new Error(`Malformed ${section} record: conflicting priceCents; coverage is unknown`);
  }
  return values[0];
}

function optionalStringAlias(
  section: OverviewSection,
  row: Record<string, unknown>,
  keys: string[],
  label: string,
): string | null | undefined {
  const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(row, key));
  const values = present.map((key) => optionalStringField(section, row, key));
  if (values.some((value) => value !== values[0])) {
    throw new Error(`Malformed ${section} record: conflicting ${label}; coverage is unknown`);
  }
  return values[0];
}

function boundedProjection(fields: Array<[string, unknown, number]>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let remaining = MAX_ITEM_TEXT_CHARS;
  let shortened = false;
  for (const [key, raw, perFieldLimit] of fields) {
    if (raw == null || (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean")) continue;
    if (typeof raw === "number" && !Number.isFinite(raw)) continue;
    if (typeof raw !== "string") {
      result[key] = raw;
      continue;
    }
    const available = Math.min(perFieldLimit, remaining);
    const value = raw.slice(0, available);
    if (value.length < raw.length) shortened = true;
    result[key] = value;
    remaining -= value.length;
  }
  if (shortened) result.textTruncated = true;
  return result;
}

export function projectOwnerBusinessItem(section: OverviewSection, value: unknown): Record<string, unknown> {
  const row = recordOf(section, value);
  if (section === "storedIdeas" || section === "builtinIdeas") {
    for (const key of ["category", "buyer", "problem", "entryOffer", "nextStep", "evidence"]) {
      requiredStringField(section, row, key);
    }
    if (section === "storedIdeas") requiredStringField(section, row, "source");
    optionalStringField(section, row, "price");
    optionalStringField(section, row, "expansion");
    const identity = {
      id: section === "builtinIdeas" ? null : identityId(section, row.id, true),
      slug: identityText(section, "slug", row.slug, true),
      name: identityText(section, "name", row.name, true),
    };
    return {
      ...identity,
      ...boundedProjection([
        ["category", row.category, 24],
        ["buyer", row.buyer, 48],
        ["problem", row.problem, 72],
        ["entryOffer", row.entryOffer, 48],
        ["price", row.price, 32],
        ["expansion", row.expansion, 32],
        ["nextStep", row.nextStep, 48],
        ["evidence", row.evidence, 40],
        ["source", section === "builtinIdeas" ? "catalog" : row.source, 16],
      ]),
    };
  }
  if (section === "registeredProducts") {
    const priceCents = requiredPriceCentsAlias(section, row, ["price_cents", "priceCents"]);
    const kind = requiredProductKind(section, row.kind);
    const active = requiredBooleanField(section, "active", row.active);
    const serviceType = optionalStringAlias(section, row, ["service_type", "serviceType"], "serviceType");
    const serviceTypeOutput = serviceType === null
      ? { serviceType: null }
      : serviceType !== undefined
        ? boundedProjection([["serviceType", serviceType, 32]])
        : {};
    return {
      id: identityId(section, row.id, true),
      sku: identityText(section, "sku", row.sku, true),
      name: identityTextAlias(section, row, ["product_name", "name"], "name"),
      priceCents,
      kind,
      ...serviceTypeOutput,
      active,
    };
  }
  if (section === "builtinProducts") {
    const priceCents = requiredPriceCents(section, row.priceCents);
    const kind = requiredProductKind(section, row.kind);
    const tagline = optionalStringField(section, row, "tagline");
    const description = optionalStringField(section, row, "description");
    const identity = {
      ...(row.id !== undefined ? { id: identityId(section, row.id) } : {}),
      sku: identityText(section, "sku", row.sku, true),
      name: identityTextAlias(section, row, ["productName", "name"], "name"),
    };
    return {
      ...identity,
      ...boundedProjection([
        ["priceCents", priceCents, 0],
        ["kind", kind, 24],
        ["tagline", tagline, 80],
        ["description", description, 120],
      ]),
    };
  }

  const identity: Record<string, unknown> = {};
  for (const key of ["id", "slug", "sku", "name", "title", "servicePath", "service_path", "path", "actionPath"]) {
    if (row[key] === undefined) continue;
    if (key === "id") identity.id = identityId(section, row.id);
    else if (row[key] === null && ["servicePath", "service_path", "path", "actionPath"].includes(key)) {
      identity[key] = null;
    } else identity[key] = identityText(section, key, row[key], true);
  }
  if (!identity.name && !identity.title) {
    throw new Error(`Malformed ${section} record: missing name/title identity; coverage is unknown`);
  }
  const summary = identityText(section, "summary", row.summary, true);
  const availability = identityText(section, "availability", row.availability, true);
  for (const key of ["category", "serviceType", "price", "description", "details"]) {
    optionalStringField(section, row, key);
  }
  const serviceFields: Array<[string, unknown, number]> = [];
  for (const key of ["category", "serviceType", "price", "description", "details"]) {
    serviceFields.push([key, row[key], key === "description" || key === "details" ? 180 : 64]);
  }
  return { ...identity, summary, availability, ...boundedProjection(serviceFields) };
}

export async function readOwnerBusinessOverview(
  params: unknown,
  sources: Record<OverviewSection, OverviewSource>,
): Promise<Record<string, any>> {
  const request = parseOwnerBusinessOverviewParams(params);
  if (request.mode === "summary") {
    const counts = Object.fromEntries(await Promise.all(OWNER_OVERVIEW_SECTIONS.map(async (section) => [
      section,
      countValue(await sources[section].count()),
    ] as const))) as Record<OverviewSection, number>;
    return {
      mode: "summary",
      counts,
      continuation: {
        instruction: "Request one section at a time; pass its returned nextCursor with the same section until hasMore is false.",
        maxPageSize: MAX_PAGE_SIZE,
        defaultPageSize: DEFAULT_PAGE_SIZE,
        maxOffset: MAX_OFFSET,
      },
      evidence: {
        sales: "Not checked. Catalog or product presence, page counts, and service descriptions are not evidence of sales or delivery.",
        customersAndOrders: "Not returned or checked.",
        duplication: "Sources are reported separately; matching slugs or SKUs can be catalog counterparts, not additional distinct offers.",
        coverage: `Pagination offsets are capped at ${MAX_OFFSET}; if that bound is reached, continuation fails explicitly and coverage remains unknown.`,
      },
      coverage: "Counts are point-in-time source counts; records are intentionally omitted from this compact summary.",
    };
  }

  const section = request.section!;
  const offset = request.offset!;
  const pageSize = request.pageSize!;
  const source = sources[section];
  const [totalCount, rows] = await Promise.all([source.count(), source.page(offset, pageSize)]);
  const total = countValue(totalCount);
  if (!Array.isArray(rows) || rows.length > pageSize) throw new Error("Overview source returned an invalid page");
  if (rows.length === 0 && offset < total) throw new Error("Overview count and page disagree; coverage is unknown");
  if (rows.length > 0 && offset + rows.length > total) {
    throw new Error("Overview count and page disagree; coverage is unknown");
  }
  const sourceHasMore = offset + rows.length < total;
  if (sourceHasMore && rows.length !== pageSize) throw new Error("Overview page is short; coverage is unknown");
  const items = rows.map((row) => projectOwnerBusinessItem(section, row));
  const evidence = {
    sales: "Not checked. Product or idea presence is not evidence of a sale, payment, or delivery; service entries are descriptions, not proof of a live checkout.",
    customersAndOrders: "Not returned or checked.",
    coverage: "Only the bounded page is returned; use nextCursor when hasMore is true. Counts and pages can shift if records change between requests.",
    duplication: "This source is reported separately; matching slugs or SKUs may be catalog counterparts, not additional distinct offers.",
    projection: "Only allowlisted bounded fields are shown; clipped text is marked textTruncated and nested/private fields are omitted.",
    ...(section === "builtinIdeas" ? { builtinIdea: "id=null marks a built-in catalog reference, not a saved Opportunity Bank row." } : {}),
  };

  // Keep a prefix only, adjusting the cursor to the actual returned length.
  // This guarantees the downstream compressor never samples returned records.
  for (let returned = items.length; returned >= 0; returned--) {
    const nextOffset = offset + returned;
    const hasMore = nextOffset < total;
    if (hasMore && nextOffset >= MAX_OFFSET) continue;
    if (returned === 0 && hasMore) continue;
    const result = {
      mode: "page",
      section,
      pagination: {
        hasMore,
        nextCursor: hasMore ? `obv1:${section}:${nextOffset}` : null,
        offset,
        pageSize,
        returned,
        totalCount: total,
      },
      evidence,
      items: items.slice(0, returned),
    };
    if (JSON.stringify(result).length <= MAX_RESPONSE_CHARS) return result;
  }
  throw new Error("Overview page cannot fit safely; coverage is unknown");
}