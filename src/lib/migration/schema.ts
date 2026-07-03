// schema.ts — Zod boundary schema for migration input validation.
//
// Parses unknown persisted blobs into a validated shape with safe defaults on
// every field. Permissive by design: a corrupted version degrades to 0, a
// corrupted chapters degrades to {}, but neither fails the whole parse. Only
// a non-object root fails safeParse and returns EMPTY_META.
//
// .passthrough() on the root and legacy sub-objects keeps unknown keys (acts,
// chapterBeats) so v1 can inspect them. chapters is optional (not .catch({}))
// so isNewShapeMeta can distinguish "absent" from "present but empty".

import { z } from "zod";

const continuityFlagSchema = z.object({
  sev: z.enum(["ok", "warn", "flag"]).catch("ok"),
  tag: z.string().catch(""),
  text: z.string().catch(""),
  blockIds: z.array(z.string()).catch([]),
});

const cardSchema = z.object({
  id: z.string().catch(""),
  title: z.string().catch(""),
  intention: z.string().catch(""),
  characterIds: z.array(z.string()).catch([]),
  loreIds: z.array(z.string()).catch([]),
  continuityFlags: z.array(continuityFlagSchema).catch([]),
});

const chapterOutlineSchema = z.object({
  act: z.enum(["setup", "confrontation", "resolution"]).nullable().catch(null),
  plotPoint: z.enum(["plot-point", "inciting", "pinch", "action", "midpoint", "climax", "resolution"]).nullable().catch(null),
  premise: z.string().catch(""),
  goal: z.string().catch(""),
  conflict: z.string().catch(""),
  turn: z.string().catch(""),
  characterIds: z.array(z.string()).catch([]),
  cards: z.array(cardSchema).catch([]),
});

const characterSchema = z.object({
  id: z.string().catch(""),
  name: z.string().catch(""),
  color: z.string().catch(""),
  role: z.string().catch(""),
});

const loreEntrySchema = z.object({
  id: z.string().catch(""),
  title: z.string().catch(""),
  description: z.string().catch(""),
  characterIds: z.array(z.string()).catch([]),
  tags: z.array(z.string()).catch([]),
});

// Legacy fields — parsed for v1 migration, absent on new-shape blobs.
const legacyBeatSchema = z.object({
  title: z.string().catch(""),
  intention: z.string().catch(""),
  chapterIds: z.array(z.string()).catch([]),
  type: z.enum(["plot-point", "inciting", "pinch", "action", "midpoint", "climax", "resolution"]).catch("plot-point"),
  characterIds: z.array(z.string()).catch([]),
  loreIds: z.array(z.string()).catch([]),
  continuityFlags: z.array(continuityFlagSchema).catch([]),
}).passthrough();

const legacyActSchema = z.object({
  kind: z.enum(["setup", "confrontation", "resolution"]).catch("setup"),
  beats: z.array(legacyBeatSchema).catch([]),
}).passthrough();

const legacyChapterBeatSchema = z.object({
  goal: z.string().catch(""),
  conflict: z.string().catch(""),
  turn: z.string().catch(""),
}).passthrough();

/** Parses any historical meta blob (unknown) into a validated shape with safe
 *  defaults on every field. Passthrough keeps legacy fields for v1 to read. */
export const metaBlobSchema = z.object({
  version: z.number().int().nonnegative().catch(0),
  characters: z.array(characterSchema).catch([]),
  lore: z.array(loreEntrySchema).catch([]),
  statuses: z.record(z.string(), z.enum(["active", "draft", "outline", "planned"]).catch("active")).catch({}),
  outline: z.object({
    premise: z.string().catch(""),
    acts: z.array(legacyActSchema).optional(),
  }).passthrough().catch({ premise: "" }),
  chapters: z.record(z.string(), chapterOutlineSchema).optional(),
  chapterBeats: z.record(z.string(), legacyChapterBeatSchema).optional(),
}).passthrough();

export type MetaBlob = z.infer<typeof metaBlobSchema>;