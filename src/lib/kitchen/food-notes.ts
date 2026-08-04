import type {
  KitchenFoodNote,
  KitchenFoodNoteSource,
} from "./types";

export type KitchenFoodNoteCandidate = {
  body: string;
  foodContext?: boolean;
  source: KitchenFoodNoteSource;
  sourceId?: string | null;
  sourceUpdatedAt?: string | null;
};

const FOOD_NOTE_PATTERN =
  /\b(?:allerg(?:y|ies|en|ens|ic)?|appetizer|buffet|cake|celiac|chafing|chef|cookie|dairy|dessert|dietary|dinner|food|fried|fries|gluten|halal|kitchen|kosher|lunch|marinara|meal|menu|mozzarella|nut(?:s)?|pan(?:s)?|platter|prep|ranch|sauce|serve(?:d|s|ing)?|shellfish|snack|taco|tater|tender|tray|vegan|vegetarian|veggie|wing)\b/i;

const FINANCIAL_NOTE_PATTERN =
  /(?:\$|\bbalance\b|\bbilling\b|\bcredit card\b|\bdeposit\b|\bgratuity\b|\binvoice\b|\bpayment\b|\bprice\b|\btax\b|\btotal due\b)/i;

const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN =
  /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/g;
const URL_PATTERN = /\bhttps?:\/\/\S+/gi;

function decodeMarkup(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|li|p)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "\n");
}

function noteFragments(value: string) {
  return decodeMarkup(value)
    .split(
      /\n+|\s+[•·]\s+|(?<=[.!?])\s+(?=[A-Z0-9])/,
    )
    .map((fragment) =>
      fragment
        .replace(/^[\s\-–—*•·]+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

function redactContactDetails(value: string) {
  return value
    .replace(EMAIL_PATTERN, "[email redacted]")
    .replace(PHONE_PATTERN, "[phone redacted]")
    .replace(URL_PATTERN, "[link redacted]");
}

function noteKey(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function extractKitchenFoodNotes(
  candidates: readonly KitchenFoodNoteCandidate[],
): KitchenFoodNote[] {
  const notes: KitchenFoodNote[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    for (const fragment of noteFragments(candidate.body)) {
      if (
        FINANCIAL_NOTE_PATTERN.test(fragment) ||
        (!candidate.foodContext && !FOOD_NOTE_PATTERN.test(fragment))
      ) {
        continue;
      }

      const text = redactContactDetails(fragment).slice(0, 500).trim();
      const key = noteKey(text);
      if (!text || seen.has(key)) {
        continue;
      }

      seen.add(key);
      notes.push({
        text,
        source: candidate.source,
        sourceId: candidate.sourceId ?? null,
        sourceUpdatedAt: candidate.sourceUpdatedAt ?? null,
      });

      if (notes.length >= 40) {
        return notes;
      }
    }
  }

  return notes;
}

export function mergeKitchenFoodNotes(
  ...groups: readonly KitchenFoodNote[][]
) {
  const merged: KitchenFoodNote[] = [];
  const seen = new Set<string>();

  for (const note of groups.flat()) {
    const key = noteKey(note.text);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ ...note });
    }
  }

  return merged;
}
