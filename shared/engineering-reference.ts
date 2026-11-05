import { z } from "zod";

export const engineeringCategories = ["Agents", "Retrieval", "Evaluation", "Production", "Cost", "Safety", "Protocols"] as const;
export const engineeringVerdicts = ["aligned", "difference", "gap", "unverified", "not-applicable"] as const;
export const verdictLabels: Record<typeof engineeringVerdicts[number], string> = {
  aligned: "Aligned in reviewed path",
  difference: "Deliberate difference",
  gap: "Confirmed gap",
  unverified: "Needs verification",
  "not-applicable": "Not applicable",
};
export type EngineeringReference = {
  id: string;
  category: typeof engineeringCategories[number];
  question: string;
  answer: string;
  sourceUrl: string;
  guidance: string;
  verdict: typeof engineeringVerdicts[number];
  evidence: { path: string; detail: string }[];
  nextCheck: string;
  reviewedAt: string;
};

export const engineeringNoteSchema = z.object({
  id: z.string().uuid(),
  question: z.string().trim().min(3).max(400),
  answer: z.string().trim().max(12000),
  category: z.enum(engineeringCategories),
  sourceUrl: z.union([z.literal(""), z.string().max(2048).url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use an HTTPS link without credentials.")]),
  relatedReferenceId: z.string().max(100).optional(),
}).strict();
export type EngineeringNote = z.infer<typeof engineeringNoteSchema>;
export const engineeringLibraryWriteSchema = z.object({
  version: z.number().int().nonnegative().max(2147483646),
  notes: z.array(engineeringNoteSchema).max(200),
}).strict().refine(value => new Set(value.notes.map(note => note.id)).size === value.notes.length, {
  message: "Each question must have a unique ID.",
});
export type EngineeringLibrary = { version: number; notes: EngineeringNote[] };
export type EngineeringReferenceResponse = EngineeringLibrary & {
  references: EngineeringReference[];
  scope: string;
};
