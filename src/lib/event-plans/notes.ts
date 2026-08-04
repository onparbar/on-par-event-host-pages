import type { EventPlanOperationalNote } from "./types";

export const MAX_EVENT_PLAN_OPERATIONAL_NOTES = 100;
export const MAX_EVENT_PLAN_OPERATIONAL_NOTE_LENGTH = 1_000;

export type EventPlanOperationalNoteCandidate = {
  body: string;
  id?: string | number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type EventPlanOperationalNoteExtraction = {
  notes: EventPlanOperationalNote[];
  available: boolean;
  truncated: boolean;
  omittedFragmentCount: number;
  shortenedFragmentCount: number;
};

type ExtractedFragment = {
  note: EventPlanOperationalNote;
  candidateOrder: number;
  fragmentOrder: number;
  dedupeKey: string;
  fullText: string;
};

const OPERATIONAL_NOTE_PATTERN =
  /\b(?:access(?:ibility|ible)?|ada|after|allerg(?:y|ies|en|ens|ic)?|appetizer|arrival|arrive|audio|award|bar|bartender|before|beverage|birthday|bowling|breakdown|buffet|cake|celiac|chair|check[\s-]?in|cleanup|coffee|dairy|dart|decor(?:ation|ations)?|deliver(?:y|ed)?|depart(?:ure)?|dessert|dietary|dinner|door|drink|early|elevator|end|entertainment|entrance|event|exit|food|fries|gift|gluten|golf|group|guest|halal|hearing|host|interpreter|juice|karaoke|kosher|lane|late|layout|load[\s-]?(?:in|out)|lunch|meal|meeting|menu|microphone|mobility|mozzarella|nut|pan|parking|party|patio|pickup|platter|podium|pool|prepar(?:ation|e|ed|ing)|prep|presentation|ramp|ranch|registration|room|sauce|schedule|seat(?:ing|s)?|serve(?:d|s|r|rs|ice|ices|ing)?|setup|set[\s-]?up|shellfish|shuffleboard|signage|snack|soda|speaker|sponsor|staff|stage|start|table|taco|tater|tender|timing|tray|tv|vegan|vegetarian|veggie|vendor|vip|water|wheelchair|wing)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)?\b|\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b/i;

const FINANCIAL_NOTE_PATTERN =
  /(?:\$|\bamount due\b|\bbalance\b|\bbilling\b|\bcharge(?:d|s)?\b|\bcredit card\b|\bdeposit\b|\bgratuity\b|\binvoice\b|\bminimum spend\b|\bpaid\b|\bpayment\b|\bprice\b|\brefund\b|\btax\b|\btotal due\b)/i;

const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN =
  /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<]+/gi;

function decodeMarkup(value: string) {
  return value
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|li|p|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "\n");
}

function noteFragments(value: string) {
  return decodeMarkup(value)
    .split(/\n+|[;；]+|\s+[•·]\s+|(?<=[.!?])\s+(?=[A-Z0-9])/)
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

function normalizedText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLocaleLowerCase("en-US");
}

function normalizedOptional(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function sourceId(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" ? normalizedOptional(value) : null;
}

function timestampValue(value: string | null) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? timestamp
    : Number.NEGATIVE_INFINITY;
}

function candidateSortKey(candidate: EventPlanOperationalNoteCandidate) {
  const createdAt = normalizedOptional(candidate.createdAt);
  const updatedAt = normalizedOptional(candidate.updatedAt);
  return {
    timestamp: timestampValue(updatedAt ?? createdAt),
    updatedAt: updatedAt ?? "",
    createdAt: createdAt ?? "",
    id: sourceId(candidate.id) ?? "",
    body: normalizedText(candidate.body),
  };
}

function compareCandidates(
  left: EventPlanOperationalNoteCandidate,
  right: EventPlanOperationalNoteCandidate,
) {
  const leftKey = candidateSortKey(left);
  const rightKey = candidateSortKey(right);
  return (
    leftKey.timestamp - rightKey.timestamp ||
    leftKey.updatedAt.localeCompare(rightKey.updatedAt) ||
    leftKey.createdAt.localeCompare(rightKey.createdAt) ||
    leftKey.id.localeCompare(rightKey.id) ||
    leftKey.body.localeCompare(rightKey.body)
  );
}

function truncateText(value: string) {
  const codePoints = Array.from(value);
  if (codePoints.length <= MAX_EVENT_PLAN_OPERATIONAL_NOTE_LENGTH) {
    return { text: value, shortened: false };
  }
  return {
    text: `${codePoints
      .slice(0, MAX_EVENT_PLAN_OPERATIONAL_NOTE_LENGTH - 1)
      .join("")
      .trimEnd()}…`,
    shortened: true,
  };
}

export function extractEventPlanOperationalNotes(
  candidates: readonly EventPlanOperationalNoteCandidate[] | null | undefined,
): EventPlanOperationalNoteExtraction {
  if (candidates == null) {
    return {
      notes: [],
      available: false,
      truncated: false,
      omittedFragmentCount: 0,
      shortenedFragmentCount: 0,
    };
  }

  const sortedCandidates = [...candidates].sort(compareCandidates);
  const fragmentsByText = new Map<string, ExtractedFragment>();

  sortedCandidates.forEach((candidate, candidateOrder) => {
    const createdAt = normalizedOptional(candidate.createdAt);
    const updatedAt = normalizedOptional(candidate.updatedAt);

    noteFragments(candidate.body).forEach((fragment, fragmentOrder) => {
      if (
        FINANCIAL_NOTE_PATTERN.test(fragment) ||
        !OPERATIONAL_NOTE_PATTERN.test(fragment)
      ) {
        return;
      }

      const fullText = redactContactDetails(fragment).trim();
      const dedupeKey = normalizedText(fullText);
      if (!fullText || !dedupeKey) {
        return;
      }

      fragmentsByText.set(dedupeKey, {
        note: {
          source: "event-note",
          sourceId: sourceId(candidate.id),
          sourceCreatedAt: createdAt,
          sourceUpdatedAt: updatedAt,
          text: fullText,
        },
        candidateOrder,
        fragmentOrder,
        dedupeKey,
        fullText,
      });
    });
  });

  const uniqueFragments = [...fragmentsByText.values()].sort(
    (left, right) =>
      left.candidateOrder - right.candidateOrder ||
      left.fragmentOrder - right.fragmentOrder ||
      left.dedupeKey.localeCompare(right.dedupeKey),
  );
  const omittedFragmentCount = Math.max(
    0,
    uniqueFragments.length - MAX_EVENT_PLAN_OPERATIONAL_NOTES,
  );
  const retainedFragments = uniqueFragments.slice(
    omittedFragmentCount,
  );
  let shortenedFragmentCount = 0;
  const notes = retainedFragments.map((fragment) => {
    const truncated = truncateText(fragment.fullText);
    if (truncated.shortened) {
      shortenedFragmentCount += 1;
    }
    return {
      ...fragment.note,
      text: truncated.text,
    };
  });

  return {
    notes,
    available: true,
    truncated:
      omittedFragmentCount > 0 || shortenedFragmentCount > 0,
    omittedFragmentCount,
    shortenedFragmentCount,
  };
}
