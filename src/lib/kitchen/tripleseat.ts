import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { getMockKitchenEventsForDate } from "./fixtures";
import {
  extractKitchenFoodNotes,
  mergeKitchenFoodNotes,
} from "./food-notes";
import type {
  KitchenFoodNote,
  KitchenSourceEvent,
  KitchenSourceSelection,
} from "./types";
import {
  getKitchenStorage,
  type KitchenStorage,
} from "./storage";
import type {
  EntertainmentSourceEvent,
  EntertainmentSourceItem,
} from "../entertainment/types";
import { extractEventPlanOperationalNotes } from "../event-plans/notes";
import type { TripleseatEventPlanSource } from "../event-plans/types";

const DEFAULT_API_BASE_URL = "https://api.tripleseat.com/v1";
const DEFAULT_TOKEN_URL = "https://api.tripleseat.com/oauth2/token";
const DEFAULT_LOCATION_ID = "26059";
const REQUIRED_STATUS = "DEFINITE";
const TOKEN_AAD = Buffer.from("ope-kitchen:tripleseat-token-state:v1");
const MAX_EVENT_PAGES = 100;
const MAX_NOTE_PAGES = 20;
const UNASSIGNABLE_BOOKING_DOCUMENTS_NOTE =
  "Needs Review: Tripleseat booking documents were not imported because they could not be assigned to exactly one matching event. Review the source event.";
const UNVERIFIED_BOOKING_CONTRACT_NOTE =
  "Needs Review: Tripleseat booking contract data could not be verified. Review the source event.";
const CATEGORYLESS_TOP_LEVEL_FOOD_SELECTIONS = new Set([
  "mozzarella sticks",
  "wings",
  "chicken tenders",
  "fries",
]);

type UnknownRecord = Record<string, unknown>;
type FetchImplementation = typeof fetch;

type OAuthTokenState = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
};

export type TripleseatDocumentMetadata = {
  id: string | number | null;
  title: string | null;
  documentTemplateId: string | number | null;
  viewNames: string[];
};

export type TripleseatKitchenSourceEvent = KitchenSourceEvent & {
  documentMetadata: TripleseatDocumentMetadata[];
};

export type TripleseatDiagnostics = {
  sourceMode: "live" | "mock";
  missingEnvironmentVariables: string[];
  warnings: string[];
  locationId: string;
};

export interface TripleseatAdapter {
  readonly sourceMode: "live" | "mock";
  fetchEventsForDate(date: string): Promise<TripleseatKitchenSourceEvent[]>;
  fetchEventPlansForRange?(
    startDate: string,
    endDate: string,
  ): Promise<TripleseatEventPlanSource[]>;
  fetchEntertainmentEventsForDate?(
    date: string,
  ): Promise<EntertainmentSourceEvent[]>;
  fetchEventDateById(eventId: string): Promise<string | null>;
  getDiagnostics(): TripleseatDiagnostics;
}

type LiveAdapterOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchImplementation;
  storage?: KitchenStorage;
  apiBaseUrl?: string;
  tokenUrl?: string;
  now?: () => number;
};

type MockAdapterOptions = {
  missingEnvironmentVariables?: string[];
  locationId?: string;
};

class TripleseatApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Tripleseat API request failed (${status}).`);
    this.name = "TripleseatApiError";
    this.status = status;
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractArray(value: unknown, keys: readonly string[]) {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }
  return [];
}

function stripMarkup(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value: unknown) {
  const text = asString(value);
  if (!text) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) {
    return null;
  }
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

export function isValidKitchenDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function apiDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function envValue(
  env: NodeJS.ProcessEnv,
  currentName: string,
  legacyName?: string,
) {
  return (
    env[currentName]?.trim() ||
    (legacyName ? env[legacyName]?.trim() : "") ||
    ""
  );
}

export function getMissingTripleseatEnvironmentVariables(
  env: NodeJS.ProcessEnv = process.env,
) {
  const missing: string[] = [];
  if (!envValue(env, "TRIPLESEAT_CLIENT_ID", "CLIENT_ID")) {
    missing.push("TRIPLESEAT_CLIENT_ID");
  }
  if (!envValue(env, "TRIPLESEAT_CLIENT_SECRET", "CLIENT_SECRET")) {
    missing.push("TRIPLESEAT_CLIENT_SECRET");
  }
  const hasEncryptedPersistence =
    Boolean(env.TRIPLESEAT_TOKEN_ENCRYPTION_KEY?.trim());
  if (
    !envValue(env, "TRIPLESEAT_REFRESH_TOKEN") &&
    !hasEncryptedPersistence
  ) {
    missing.push("TRIPLESEAT_REFRESH_TOKEN");
  }
  if (
    !envValue(env, "TRIPLESEAT_ACCESS_TOKEN") &&
    !envValue(env, "TRIPLESEAT_REFRESH_TOKEN") &&
    !hasEncryptedPersistence
  ) {
    missing.push("TRIPLESEAT_ACCESS_TOKEN");
  }
  return missing;
}

function encryptionKey(value: string) {
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  const raw = Buffer.from(value, "utf8");
  if (raw.length === 32) {
    return raw;
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 32) {
    return decoded;
  }

  throw new Error(
    "TRIPLESEAT_TOKEN_ENCRYPTION_KEY must contain exactly 32 bytes (raw, hex, or base64).",
  );
}

export function encryptTripleseatTokenState(
  state: OAuthTokenState,
  configuredKey: string,
) {
  const key = encryptionKey(configuredKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptTripleseatTokenState(
  encrypted: string,
  configuredKey: string,
): OAuthTokenState {
  const [version, encodedIv, encodedTag, encodedCiphertext] =
    encrypted.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext
  ) {
    throw new Error("Unsupported Tripleseat token-state envelope.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(configuredKey),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAAD(TOKEN_AAD);
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<OAuthTokenState>;
  return {
    accessToken:
      typeof parsed.accessToken === "string" ? parsed.accessToken : null,
    refreshToken:
      typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
    expiresAt:
      typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt)
        ? parsed.expiresAt
        : null,
  };
}

function categoryName(value: unknown) {
  const record = asRecord(value);
  if (record) {
    return (
      asString(record.name) ||
      asString(record.internal_name) ||
      asString(record.display_name)
    );
  }
  return asString(value);
}

function isFoodDocumentCategory(value: string) {
  const normalized = normalizedSelectionName(value);
  return (
    normalized.startsWith("food") ||
    normalized === "dessert" ||
    normalized === "desserts" ||
    normalized === "taco bar" ||
    normalized === "wing bar" ||
    normalized === "appetizer bar"
  );
}

function documentLineItemCategory(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    const displayName = asString(value);
    return {
      displayName,
      isFood: displayName != null && isFoodDocumentCategory(displayName),
    };
  }

  const name = asString(record.name);
  const internalName = asString(record.internal_name);
  return {
    displayName:
      name || asString(record.display_name) || internalName,
    isFood: [name, internalName].some(
      (candidate) => candidate != null && isFoodDocumentCategory(candidate),
    ),
  };
}

function normalizeMenuSelectionRecord(
  value: unknown,
): KitchenSourceSelection | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const name =
    asString(record.display_name) ||
    asString(record.internal_name) ||
    asString(record.name);
  if (!name) {
    return null;
  }

  const sourceCategory = categoryName(record.category);
  return {
    name: stripMarkup(name),
    quantity: asNumber(record.quantity),
    sourceId: asString(record.id) ?? asString(record.menu_item_id),
    sourceCategory,
  };
}

function normalizeMenuSelection(value: unknown): KitchenSourceSelection[] {
  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const selection = normalizeMenuSelectionRecord(record);
  if (
    selection &&
    selection.sourceId != null &&
    selection.sourceCategory == null &&
    selection.quantity != null &&
    Number.isInteger(selection.quantity) &&
    selection.quantity > 0 &&
    CATEGORYLESS_TOP_LEVEL_FOOD_SELECTIONS.has(
      normalizedSelectionName(selection.name),
    )
  ) {
    selection.isFood = true;
  }
  const modifiers = extractArray(record.menu_modifier_selections, [
    "menu_modifier_selections",
  ]).flatMap((modifier) => {
    const normalized = normalizeMenuSelectionRecord(modifier);
    return normalized ? [normalized] : [];
  });

  return selection ? [selection, ...modifiers] : modifiers;
}

function foodDocumentSelections(event: UnknownRecord) {
  const selections: KitchenSourceSelection[] = [];
  for (const document of extractArray(event.documents, ["documents"])) {
    const documentRecord = asRecord(document);
    if (!documentRecord) {
      continue;
    }
    for (const lineItem of extractArray(documentRecord.line_items, [
      "line_items",
    ])) {
      const line = asRecord(lineItem);
      if (!line) {
        continue;
      }
      const category = documentLineItemCategory(line.category);
      if (!category.isFood) {
        continue;
      }
      const name =
        asString(line.description) ||
        asString(line.display_name) ||
        asString(line.internal_name) ||
        asString(line.name);
      if (!name) {
        continue;
      }
      selections.push({
        name: stripMarkup(name),
        quantity: asNumber(line.quantity),
        sourceId: asString(line.id),
        sourceCategory: category.displayName,
        isFood: true,
      });
    }
  }
  return selections;
}

function documentFoodNotes(
  event: UnknownRecord,
  source: "event-document" | "booking-document",
) {
  return extractKitchenFoodNotes(
    extractArray(event.documents, ["documents"]).flatMap((document) => {
      const documentRecord = asRecord(document);
      if (!documentRecord) {
        return [];
      }
      const documentId = asString(documentRecord.id);
      return extractArray(documentRecord.line_items, ["line_items"]).flatMap(
        (lineItem) => {
          const line = asRecord(lineItem);
          if (!line) {
            return [];
          }
          const category = documentLineItemCategory(line.category);
          const categoryKey = normalizedSelectionName(
            category.displayName ?? "",
          ).replace(/[_-]+/g, " ");
          if (!/^special instructions?$/.test(categoryKey)) {
            return [];
          }
          const candidates = [];
          const longDescription = asString(line.long_description);
          if (longDescription) {
            candidates.push({
              body: longDescription,
              source,
              sourceId:
                asString(line.id) ??
                (documentId ? `document:${documentId}` : null),
              sourceUpdatedAt:
                asString(line.updated_at) ??
                asString(documentRecord.updated_at),
            });
          }
          const description =
            asString(line.description) ||
            asString(line.display_name) ||
            asString(line.name);
          if (description) {
            candidates.push({
              body: description,
              source,
              sourceId:
                asString(line.id) ??
                (documentId ? `document:${documentId}` : null),
              sourceUpdatedAt:
                asString(line.updated_at) ??
                asString(documentRecord.updated_at),
            });
          }
          return candidates;
        },
      );
    }),
  );
}

function entertainmentDocumentItems(event: UnknownRecord) {
  const items: EntertainmentSourceItem[] = [];
  for (const document of extractArray(event.documents, ["documents"])) {
    const documentRecord = asRecord(document);
    if (!documentRecord) {
      continue;
    }
    const documentId = asString(documentRecord.id) ?? "unknown";
    for (const lineItem of extractArray(documentRecord.line_items, [
      "line_items",
    ])) {
      const line = asRecord(lineItem);
      if (!line) {
        continue;
      }
      const category = documentLineItemCategory(line.category);
      const name =
        asString(line.description) ||
        asString(line.display_name) ||
        asString(line.internal_name) ||
        asString(line.name);
      if (!name) {
        continue;
      }
      const description = [
        asString(line.description),
        asString(line.long_description),
        asString(line.section),
      ]
        .filter(Boolean)
        .map((value) => stripMarkup(value!))
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(" ")
        .slice(0, 2_000);
      items.push({
        sourceId: `document:${documentId}:line:${asString(line.id) ?? items.length}`,
        name: stripMarkup(name).slice(0, 500),
        description: description || null,
        categoryName: category.displayName,
        quantity: asNumber(line.quantity),
        startAt:
          asString(line.start_at) ||
          asString(line.start_time) ||
          asString(line.event_start_iso8601),
        endAt:
          asString(line.end_at) ||
          asString(line.end_time) ||
          asString(line.event_end_iso8601),
      });
    }
  }
  return items;
}

function normalizedSelectionName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function mergeSelections(
  menuSelections: KitchenSourceSelection[],
  documentSelections: KitchenSourceSelection[],
) {
  const merged = menuSelections.map((selection) => ({ ...selection }));
  const notes: string[] = [];
  const primaryByName = new Map(
    merged.map((selection) => [
      normalizedSelectionName(selection.name),
      selection,
    ]),
  );

  for (const selection of documentSelections) {
    const normalizedName = normalizedSelectionName(selection.name);
    const primary = primaryByName.get(normalizedName);
    if (primary) {
      if (!primary.sourceCategory && selection.sourceCategory) {
        primary.sourceCategory = selection.sourceCategory;
        primary.isFood = selection.isFood;
      }
      if (primary.quantity == null && selection.quantity != null) {
        primary.quantity = selection.quantity;
      } else if (
        primary.quantity != null &&
        selection.quantity != null &&
        primary.quantity !== selection.quantity
      ) {
        notes.push(
          `Conflicting structured and document quantities for ${selection.name}; verify the contract.`,
        );
      }
      continue;
    }

    const added = { ...selection };
    merged.push(added);
    primaryByName.set(normalizedName, added);
  }

  return { selections: merged, notes };
}

function documentMetadata(event: UnknownRecord) {
  return extractArray(event.documents, ["documents"]).flatMap((value) => {
    const record = asRecord(value);
    if (!record) {
      return [];
    }
    const viewNames = extractArray(record.views, ["views"]).flatMap((view) => {
      const viewRecord = asRecord(view);
      const name = viewRecord ? asString(viewRecord.name) : null;
      return name ? [name] : [];
    });
    return [
      {
        id: asString(record.id),
        title: asString(record.title),
        documentTemplateId: asString(record.document_template_id),
        viewNames,
      } satisfies TripleseatDocumentMetadata,
    ];
  });
}

function mergeDocumentMetadata(
  ...groups: TripleseatDocumentMetadata[][]
) {
  const merged: TripleseatDocumentMetadata[] = [];
  const seen = new Set<string>();
  for (const metadata of groups.flat()) {
    const key =
      metadata.id != null
        ? `id:${metadata.id}`
        : JSON.stringify([
            metadata.title,
            metadata.documentTemplateId,
            metadata.viewNames,
          ]);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(metadata);
    }
  }
  return merged;
}

function roomName(event: UnknownRecord) {
  const names = roomNames(event);
  return names.length > 0 ? names.join(", ") : null;
}

function roomNames(event: UnknownRecord) {
  const names = extractArray(event.rooms, ["rooms"]).flatMap((value) => {
    const record = asRecord(value);
    const name = record ? asString(record.name) : null;
    return name ? [stripMarkup(name).slice(0, 200)] : [];
  });
  if (names.length === 0) {
    const room = asRecord(event.room);
    const name = room ? asString(room.name) : null;
    if (name) {
      names.push(stripMarkup(name).slice(0, 200));
    }
  }
  return names.filter((name, index, all) => all.indexOf(name) === index);
}

function sourceEventId(event: UnknownRecord) {
  return asString(event.id);
}

export class LiveTripleseatAdapter implements TripleseatAdapter {
  readonly sourceMode = "live" as const;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchImplementation;
  private readonly storage: KitchenStorage;
  private readonly apiBaseUrl: string;
  private readonly tokenUrl: string;
  private readonly now: () => number;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly locationId: string;
  private readonly configuredEncryptionKey: string;
  private tokenState: OAuthTokenState;
  private initialized: Promise<void> | null = null;
  private refreshInFlight: Promise<string> | null = null;
  private readonly warnings = new Set<string>();

  constructor(options: LiveAdapterOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.storage = options.storage ?? getKitchenStorage();
    this.apiBaseUrl = normalizeBaseUrl(
      options.apiBaseUrl ??
        this.env.TRIPLESEAT_API_BASE_URL?.trim() ??
        DEFAULT_API_BASE_URL,
    );
    this.tokenUrl =
      options.tokenUrl ??
      this.env.TRIPLESEAT_TOKEN_URL?.trim() ??
      DEFAULT_TOKEN_URL;
    this.now = options.now ?? Date.now;
    this.clientId = envValue(
      this.env,
      "TRIPLESEAT_CLIENT_ID",
      "CLIENT_ID",
    );
    this.clientSecret = envValue(
      this.env,
      "TRIPLESEAT_CLIENT_SECRET",
      "CLIENT_SECRET",
    );
    this.locationId =
      this.env.TRIPLESEAT_LOCATION_ID?.trim() || DEFAULT_LOCATION_ID;
    this.configuredEncryptionKey =
      this.env.TRIPLESEAT_TOKEN_ENCRYPTION_KEY?.trim() || "";
    this.tokenState = {
      accessToken: envValue(this.env, "TRIPLESEAT_ACCESS_TOKEN") || null,
      refreshToken: envValue(this.env, "TRIPLESEAT_REFRESH_TOKEN") || null,
      expiresAt: null,
    };

    if (!this.configuredEncryptionKey) {
      this.warnings.add(
        "TRIPLESEAT_TOKEN_ENCRYPTION_KEY is not configured; refreshed tokens remain in environment/module memory and do not persist across server restarts.",
      );
    }
  }

  getDiagnostics(): TripleseatDiagnostics {
    return {
      sourceMode: "live",
      missingEnvironmentVariables:
        getMissingTripleseatEnvironmentVariables(this.env),
      warnings: [...this.warnings],
      locationId: this.locationId,
    };
  }

  private async initialize() {
    if (!this.configuredEncryptionKey) {
      return;
    }

    try {
      const stored = await this.storage.getEncryptedTokenState();
      if (stored) {
        this.tokenState = decryptTripleseatTokenState(
          stored.encryptedTokens,
          this.configuredEncryptionKey,
        );
      } else if (this.tokenState.accessToken || this.tokenState.refreshToken) {
        await this.persistTokens();
      }
    } catch {
      this.warnings.add(
        "Encrypted Tripleseat token persistence is unavailable; environment/module-memory tokens are being used.",
      );
    }
  }

  private async ensureInitialized() {
    if (
      !this.initialized ||
      (this.configuredEncryptionKey &&
        !this.tokenState.accessToken &&
        !this.tokenState.refreshToken)
    ) {
      this.initialized = this.initialize();
    }
    await this.initialized;
  }

  private async persistTokens() {
    if (!this.configuredEncryptionKey) {
      return;
    }
    const encryptedTokens = encryptTripleseatTokenState(
      this.tokenState,
      this.configuredEncryptionKey,
    );
    await this.storage.saveEncryptedTokenState({
      encryptedTokens,
      expiresAt: this.tokenState.expiresAt
        ? new Date(this.tokenState.expiresAt).toISOString()
        : null,
    });
  }

  private async refreshAccessToken() {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      const refreshToken = this.tokenState.refreshToken;
      if (!refreshToken || !this.clientId || !this.clientSecret) {
        throw new Error(
          "Tripleseat OAuth refresh configuration is incomplete.",
        );
      }

      const response = await this.fetchImpl(this.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Tripleseat OAuth refresh was rejected (${response.status}). Reconnect Tripleseat before refreshing Event Host.`,
        );
      }

      const payload = asRecord(await response.json());
      const accessToken = payload ? asString(payload.access_token) : null;
      if (!accessToken) {
        throw new Error("Tripleseat OAuth response did not include an access token.");
      }

      const expiresIn = payload ? asNumber(payload.expires_in) : null;
      this.tokenState = {
        accessToken,
        refreshToken:
          (payload ? asString(payload.refresh_token) : null) ?? refreshToken,
        expiresAt:
          expiresIn && expiresIn > 0
            ? this.now() + expiresIn * 1000
            : null,
      };

      try {
        await this.persistTokens();
      } catch {
        this.warnings.add(
          "Encrypted Tripleseat token persistence failed; the refreshed token is available only in module memory.",
        );
      }
      return accessToken;
    })();

    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async requestJson(
    path: string,
    init: RequestInit = {},
    canRetry = true,
  ): Promise<unknown> {
    await this.ensureInitialized();
    let accessToken = this.tokenState.accessToken;
    if (
      !accessToken ||
      (this.tokenState.expiresAt != null &&
        this.tokenState.expiresAt <= this.now() + 30_000)
    ) {
      accessToken = await this.refreshAccessToken();
    }

    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/${path.replace(/^\/+/, "")}`,
      {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(init.headers ?? {}),
        },
        cache: "no-store",
      },
    );

    if (response.status === 401 && canRetry) {
      await this.refreshAccessToken();
      return this.requestJson(path, init, false);
    }
    if (!response.ok) {
      throw new TripleseatApiError(response.status);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  private async eventSummaries(
    startDate: string,
    endDate = startDate,
    status: string | null = REQUIRED_STATUS,
  ) {
    const events: UnknownRecord[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= MAX_EVENT_PAGES; page += 1) {
      const query = new URLSearchParams({
        event_start_date: apiDate(startDate),
        event_end_date: apiDate(endDate),
        location_ids: this.locationId,
        order: "event_start",
        sort_direction: "asc",
        page: String(page),
      });
      if (status) {
        query.set("status", status);
      }
      const payload = await this.requestJson(`events/search?${query}`);
      const records = extractArray(payload, ["results", "events", "data"])
        .map(asRecord)
        .filter((record): record is UnknownRecord => record != null);
      let added = 0;
      for (const record of records) {
        const id = sourceEventId(record);
        if (id && !seen.has(id)) {
          seen.add(id);
          events.push(record);
          added += 1;
        }
      }

      const envelope = asRecord(payload);
      const totalPages = envelope ? asNumber(envelope.total_pages) : null;
      if (
        records.length === 0 ||
        added === 0 ||
        (totalPages != null && page >= totalPages)
      ) {
        break;
      }
    }

    return events;
  }

  private async eventDetail(eventId: string) {
    const payload = await this.requestJson(
      `events/${encodeURIComponent(eventId)}?show_financial=true`,
    );
    const envelope = asRecord(payload);
    const event = asRecord(envelope?.event ?? payload);
    if (!event) {
      throw new Error("Tripleseat event detail response was invalid.");
    }
    return event;
  }

  private async bookingDocuments(
    bookingId: string,
    eventId: string,
  ) {
    let payload: unknown;
    try {
      payload = await this.requestJson(
        `bookings/${encodeURIComponent(bookingId)}?show_financial=true`,
      );
    } catch (error) {
      if (
        error instanceof TripleseatApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        return {
          selections: [] as KitchenSourceSelection[],
          metadata: [] as TripleseatDocumentMetadata[],
          foodNotes: [] as KitchenFoodNote[],
          notes: [UNVERIFIED_BOOKING_CONTRACT_NOTE],
        };
      }
      throw error;
    }
    const envelope = asRecord(payload);
    const booking = asRecord(envelope?.booking ?? payload);
    if (!booking) {
      throw new Error("Tripleseat booking detail response was invalid.");
    }

    const rawEventIds = extractArray(booking.event_ids, ["event_ids"]);
    const eventIds = rawEventIds.flatMap((value) => {
      const record = asRecord(value);
      const id = asString(record?.id ?? value);
      return id ? [id] : [];
    });
    if (
      rawEventIds.length !== 1 ||
      eventIds.length !== 1 ||
      eventIds[0] !== eventId
    ) {
      return {
        selections: [] as KitchenSourceSelection[],
        metadata: [] as TripleseatDocumentMetadata[],
        foodNotes: [] as KitchenFoodNote[],
        notes: [UNASSIGNABLE_BOOKING_DOCUMENTS_NOTE],
      };
    }

    return {
      selections: foodDocumentSelections(booking),
      metadata: documentMetadata(booking),
      foodNotes: documentFoodNotes(booking, "booking-document"),
      notes: [] as string[],
    };
  }

  private async menuSelections(eventId: string) {
    try {
      const payload = await this.requestJson(
        `events/${encodeURIComponent(eventId)}/menu_item_selections`,
      );
      return extractArray(payload, [
        "menu_item_selections",
        "results",
        "data",
      ]).flatMap(normalizeMenuSelection);
    } catch (error) {
      if (error instanceof TripleseatApiError && error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  private async noteRecords(
    parent: "events" | "bookings",
    parentId: string,
    availability?: { available: boolean },
  ) {
    const records: UnknownRecord[] = [];
    for (let page = 1; page <= MAX_NOTE_PAGES; page += 1) {
      try {
        const query = new URLSearchParams({
          page: String(page),
          per_page: "50",
        });
        const payload = await this.requestJson(
          `${parent}/${encodeURIComponent(parentId)}/notes?${query}`,
        );
        const values = extractArray(payload, [
          "notes",
          "results",
          "data",
        ]);
        records.push(
          ...values
            .map(asRecord)
            .filter((record): record is UnknownRecord => record != null),
        );
        const envelope = asRecord(payload);
        const totalPages = envelope ? asNumber(envelope.total_pages) : null;
        if (
          values.length === 0 ||
          values.length < 50 ||
          (totalPages != null && page >= totalPages)
        ) {
          break;
        }
      } catch (error) {
        if (error instanceof TripleseatApiError && error.status === 404) {
          if (availability) {
            availability.available = false;
          }
          break;
        }
        throw error;
      }
    }
    return records;
  }

  private async noteCount(eventId: string) {
    return (await this.noteRecords("events", eventId)).length;
  }

  private async bookingEntertainmentItems(
    bookingId: string,
    eventId: string,
  ) {
    try {
      const payload = await this.requestJson(
        `bookings/${encodeURIComponent(bookingId)}?show_financial=true`,
      );
      const envelope = asRecord(payload);
      const booking = asRecord(envelope?.booking ?? payload);
      if (!booking) {
        return [];
      }
      const rawEventIds = extractArray(booking.event_ids, ["event_ids"]);
      const eventIds = rawEventIds.flatMap((value) => {
        const record = asRecord(value);
        const id = asString(record?.id ?? value);
        return id ? [id] : [];
      });
      if (
        rawEventIds.length !== 1 ||
        eventIds.length !== 1 ||
        eventIds[0] !== eventId
      ) {
        return [];
      }
      return entertainmentDocumentItems(booking);
    } catch (error) {
      if (
        error instanceof TripleseatApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        return [];
      }
      throw error;
    }
  }

  private async normalizeEntertainmentEvent(
    summary: UnknownRecord,
    requestedDate: string,
  ): Promise<EntertainmentSourceEvent | null> {
    const summaryId = sourceEventId(summary);
    if (!summaryId) {
      return null;
    }
    const detail = await this.eventDetail(summaryId);
    const eventId = sourceEventId(detail) ?? summaryId;
    const status = asString(detail.status);
    const locationId = asString(detail.location_id);
    if (status && status.toUpperCase() !== REQUIRED_STATUS) {
      return null;
    }
    if (locationId && locationId !== this.locationId) {
      return null;
    }
    const bookingId = asString(detail.booking_id);
    const documentItems = entertainmentDocumentItems(detail);
    const [menuSelections, noteCount, bookingItems] = await Promise.all([
      this.menuSelections(eventId),
      this.noteCount(eventId),
      bookingId && documentItems.length === 0
        ? this.bookingEntertainmentItems(bookingId, eventId)
        : Promise.resolve([]),
    ]);
    const verifiedLocalDate =
      normalizeDate(detail.event_date_iso8601) ||
      normalizeDate(detail.start_date) ||
      normalizeDate(detail.event_date) ||
      normalizeDate(summary.event_date_iso8601) ||
      normalizeDate(summary.start_date) ||
      normalizeDate(summary.event_date);
    const items =
      documentItems.length > 0 || bookingItems.length > 0
        ? [...documentItems, ...bookingItems]
        : menuSelections.map((selection, index) => ({
            sourceId: `menu:${selection.sourceId ?? index}`,
            name: selection.name,
            description: selection.name,
            categoryName: selection.sourceCategory ?? null,
            quantity: selection.quantity ?? null,
            startAt: null,
            endAt: null,
          }));
    const rooms = extractArray(detail.rooms, ["rooms"]).flatMap(
      (value, index) => {
        const room = asRecord(value);
        const name = room ? asString(room.name) : null;
        return name
          ? [
              {
                id: asString(room?.id) ?? String(index),
                name: stripMarkup(name).slice(0, 200),
              },
            ]
          : [];
      },
    );
    const categoryNames = extractArray(detail.category_totals, [
      "category_totals",
    ]).flatMap((value) => {
      const category = asRecord(value);
      const name = category ? asString(category.name) : null;
      return name ? [stripMarkup(name)] : [];
    });

    return {
      tripleseatEventId: eventId,
      tripleseatBookingId: bookingId,
      eventName: stripMarkup(
        asString(detail.name) ||
          asString(detail.post_as) ||
          "Unnamed event",
      ).slice(0, 200),
      localDate: verifiedLocalDate || requestedDate,
      eventStartAt:
        asString(detail.event_start_iso8601) ||
        asString(detail.event_start) ||
        asString(detail.start_time),
      eventEndAt:
        asString(detail.event_end_iso8601) ||
        asString(detail.event_end) ||
        asString(detail.end_time),
      status,
      rooms,
      items,
      categoryNames,
      sourceUpdatedAt: asString(detail.updated_at),
      noteCount,
    };
  }

  private async normalizeEvent(
    summary: UnknownRecord,
    requestedDate: string,
  ): Promise<TripleseatKitchenSourceEvent | null> {
    const summaryId = sourceEventId(summary);
    if (!summaryId) {
      return null;
    }
    const detail = await this.eventDetail(summaryId);
    const eventId = sourceEventId(detail) ?? summaryId;
    const status = asString(detail.status);
    const locationId = asString(detail.location_id);
    const bookingId = asString(detail.booking_id);

    if (status && status.toUpperCase() !== REQUIRED_STATUS) {
      return null;
    }
    if (locationId && locationId !== this.locationId) {
      return null;
    }

    const eventDocumentSelections = foodDocumentSelections(detail);
    const structuredSelections = await this.menuSelections(eventId);
    const bookingDocuments =
      bookingId
        ? await this.bookingDocuments(bookingId, eventId)
        : {
            selections: [] as KitchenSourceSelection[],
            metadata: [] as TripleseatDocumentMetadata[],
            foodNotes: [] as KitchenFoodNote[],
            notes: [] as string[],
          };
    const merged = mergeSelections(
      structuredSelections,
      [...eventDocumentSelections, ...bookingDocuments.selections],
    );
    const foodNotes = mergeKitchenFoodNotes(
      documentFoodNotes(detail, "event-document"),
      bookingDocuments.foodNotes,
    );
    const specialNotes = [
      ...bookingDocuments.notes,
      ...merged.notes,
    ].filter((note, index, all) => note && all.indexOf(note) === index);
    const verifiedLocalDate =
      normalizeDate(detail.event_date_iso8601) ||
      normalizeDate(detail.start_date) ||
      normalizeDate(detail.event_date) ||
      normalizeDate(summary.event_date_iso8601) ||
      normalizeDate(summary.start_date) ||
      normalizeDate(summary.event_date);
    const localDate = verifiedLocalDate || requestedDate;

    return {
      eventId,
      bookingId,
      eventName:
        asString(detail.name) || asString(detail.post_as) || "Unnamed event",
      localDate,
      localDateVerified: verifiedLocalDate != null,
      startTime:
        asString(detail.event_start_iso8601) ||
        asString(detail.event_start) ||
        asString(detail.start_time),
      endTime:
        asString(detail.event_end_iso8601) ||
        asString(detail.event_end) ||
        asString(detail.end_time),
      guestCount:
        asNumber(detail.guest_count) ??
        asNumber(detail.guaranteed_guest_count),
      status,
      statusVerified: status?.toUpperCase() === REQUIRED_STATUS,
      room: roomName(detail),
      selections: merged.selections,
      foodNotes,
      specialNotes,
      sourceUpdatedAt: asString(detail.updated_at),
      sourceState: "fresh",
      documentMetadata: mergeDocumentMetadata(
        documentMetadata(detail),
        bookingDocuments.metadata,
      ),
    };
  }

  private async normalizeEventPlan(
    summary: UnknownRecord,
    requestedStartDate: string,
  ): Promise<TripleseatEventPlanSource | null> {
    const summaryId = sourceEventId(summary);
    if (!summaryId) {
      return null;
    }

    const detail = await this.eventDetail(summaryId);
    const eventId = sourceEventId(detail) ?? summaryId;
    const status = asString(detail.status);
    const locationId = asString(detail.location_id);
    if (locationId && locationId !== this.locationId) {
      return null;
    }

    const bookingId = asString(detail.booking_id);
    const eventDocumentItems = entertainmentDocumentItems(detail);
    const noteAvailability = { available: true };
    const [structuredSelections, rawNotes, bookingDocumentItems] =
      await Promise.all([
        this.menuSelections(eventId),
        this.noteRecords("events", eventId, noteAvailability),
        bookingId && eventDocumentItems.length === 0
          ? this.bookingEntertainmentItems(bookingId, eventId)
          : Promise.resolve([]),
      ]);
    const merged = mergeSelections(
      structuredSelections,
      foodDocumentSelections(detail),
    );
    const operationalNoteResult = extractEventPlanOperationalNotes(
      noteAvailability.available
        ? rawNotes.flatMap((note) => {
            const body = asString(note.body);
            return body
              ? [
                  {
                    body,
                    id: asString(note.id),
                    createdAt: asString(note.created_at),
                    updatedAt: asString(note.updated_at),
                  },
                ]
              : [];
          })
        : null,
    );
    const verifiedLocalDate =
      normalizeDate(detail.event_date_iso8601) ||
      normalizeDate(detail.start_date) ||
      normalizeDate(detail.event_date) ||
      normalizeDate(summary.event_date_iso8601) ||
      normalizeDate(summary.start_date) ||
      normalizeDate(summary.event_date);

    return {
      eventId,
      bookingId,
      eventName: stripMarkup(
        asString(detail.name) ||
          asString(detail.post_as) ||
          "Unnamed event",
      ).slice(0, 200),
      localDate: verifiedLocalDate || requestedStartDate,
      eventStartAt:
        asString(detail.event_start_iso8601) ||
        asString(detail.event_start) ||
        asString(detail.start_time),
      eventEndAt:
        asString(detail.event_end_iso8601) ||
        asString(detail.event_end) ||
        asString(detail.end_time),
      guestCount:
        asNumber(detail.guest_count) ??
        asNumber(detail.guaranteed_guest_count),
      status,
      rooms: roomNames(detail),
      selections: merged.selections,
      documentItems: [
        ...eventDocumentItems,
        ...bookingDocumentItems,
      ],
      operationalNotes: operationalNoteResult.notes,
      operationalNotesAvailable: operationalNoteResult.available,
      operationalNotesTruncated: operationalNoteResult.truncated,
      omittedOperationalNoteFragmentCount:
        operationalNoteResult.omittedFragmentCount,
      shortenedOperationalNoteFragmentCount:
        operationalNoteResult.shortenedFragmentCount,
      sourceUpdatedAt: asString(detail.updated_at),
    };
  }

  async fetchEventsForDate(date: string) {
    if (!isValidKitchenDate(date)) {
      throw new Error("Kitchen sync date must use YYYY-MM-DD.");
    }
    await this.ensureInitialized();
    const missing = getMissingTripleseatEnvironmentVariables(this.env).filter(
      (name) =>
        name !== "TRIPLESEAT_ACCESS_TOKEN" &&
        name !== "TRIPLESEAT_REFRESH_TOKEN",
    );
    if (!this.tokenState.refreshToken) {
      missing.push("TRIPLESEAT_REFRESH_TOKEN");
    }
    if (!this.tokenState.accessToken && !this.tokenState.refreshToken) {
      missing.push("TRIPLESEAT_ACCESS_TOKEN");
    }
    if (missing.length > 0) {
      throw new Error(
        `Tripleseat OAuth configuration is incomplete: ${[
          ...new Set(missing),
        ].join(", ")}.`,
      );
    }

    const summaries = await this.eventSummaries(date);
    const events: TripleseatKitchenSourceEvent[] = [];
    for (const summary of summaries) {
      const event = await this.normalizeEvent(summary, date);
      if (event && event.localDate === date) {
        events.push(event);
      }
    }
    return events.sort((left, right) =>
      (left.startTime ?? "").localeCompare(right.startTime ?? ""),
    );
  }

  async fetchEventPlansForRange(startDate: string, endDate: string) {
    if (
      !isValidKitchenDate(startDate) ||
      !isValidKitchenDate(endDate) ||
      startDate > endDate
    ) {
      throw new Error(
        "Event-plan sync range must use ordered YYYY-MM-DD dates.",
      );
    }
    await this.ensureInitialized();
    const missing = getMissingTripleseatEnvironmentVariables(this.env).filter(
      (name) =>
        name !== "TRIPLESEAT_ACCESS_TOKEN" &&
        name !== "TRIPLESEAT_REFRESH_TOKEN",
    );
    if (!this.tokenState.refreshToken) {
      missing.push("TRIPLESEAT_REFRESH_TOKEN");
    }
    if (!this.tokenState.accessToken && !this.tokenState.refreshToken) {
      missing.push("TRIPLESEAT_ACCESS_TOKEN");
    }
    if (missing.length > 0) {
      throw new Error(
        `Tripleseat OAuth configuration is incomplete: ${[
          ...new Set(missing),
        ].join(", ")}.`,
      );
    }

    const summaries = await this.eventSummaries(startDate, endDate, null);
    const plans: TripleseatEventPlanSource[] = [];
    for (const summary of summaries) {
      const plan = await this.normalizeEventPlan(summary, startDate);
      if (
        plan &&
        plan.localDate >= startDate &&
        plan.localDate <= endDate
      ) {
        plans.push(plan);
      }
    }
    return plans.sort((left, right) => {
      const dateComparison = left.localDate.localeCompare(right.localDate);
      return (
        dateComparison ||
        (left.eventStartAt ?? "").localeCompare(
          right.eventStartAt ?? "",
        ) ||
        left.eventName.localeCompare(right.eventName)
      );
    });
  }

  async fetchEntertainmentEventsForDate(date: string) {
    if (!isValidKitchenDate(date)) {
      throw new Error("Entertainment sync date must use YYYY-MM-DD.");
    }
    await this.ensureInitialized();
    const missing = getMissingTripleseatEnvironmentVariables(this.env).filter(
      (name) =>
        name !== "TRIPLESEAT_ACCESS_TOKEN" &&
        name !== "TRIPLESEAT_REFRESH_TOKEN",
    );
    if (!this.tokenState.refreshToken) {
      missing.push("TRIPLESEAT_REFRESH_TOKEN");
    }
    if (!this.tokenState.accessToken && !this.tokenState.refreshToken) {
      missing.push("TRIPLESEAT_ACCESS_TOKEN");
    }
    if (missing.length > 0) {
      throw new Error(
        `Tripleseat OAuth configuration is incomplete: ${[
          ...new Set(missing),
        ].join(", ")}.`,
      );
    }
    const summaries = await this.eventSummaries(date);
    const events = await Promise.all(
      summaries.map((summary) =>
        this.normalizeEntertainmentEvent(summary, date),
      ),
    );
    return events
      .filter(
        (event): event is EntertainmentSourceEvent =>
          event != null && event.localDate === date,
      )
      .sort((left, right) =>
        (left.eventStartAt ?? "").localeCompare(right.eventStartAt ?? ""),
      );
  }

  async fetchEventDateById(eventId: string) {
    try {
      const detail = await this.eventDetail(eventId);
      return (
        normalizeDate(detail.event_date_iso8601) ||
        normalizeDate(detail.start_date) ||
        normalizeDate(detail.event_date)
      );
    } catch (error) {
      if (error instanceof TripleseatApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }
}

export class MockTripleseatAdapter implements TripleseatAdapter {
  readonly sourceMode = "mock" as const;
  private readonly missingEnvironmentVariables: string[];
  private readonly locationId: string;

  constructor(options: MockAdapterOptions = {}) {
    this.missingEnvironmentVariables =
      options.missingEnvironmentVariables ?? [];
    this.locationId = options.locationId ?? DEFAULT_LOCATION_ID;
  }

  getDiagnostics(): TripleseatDiagnostics {
    return {
      sourceMode: "mock",
      missingEnvironmentVariables: [...this.missingEnvironmentVariables],
      warnings:
        this.missingEnvironmentVariables.length > 0
          ? [
              "Tripleseat live configuration is incomplete; redacted mock events are in use.",
            ]
          : ["TRIPLESEAT_MOCK is enabled; redacted mock events are in use."],
      locationId: this.locationId,
    };
  }

  async fetchEventsForDate(date: string) {
    if (!isValidKitchenDate(date)) {
      throw new Error("Kitchen sync date must use YYYY-MM-DD.");
    }
    return getMockKitchenEventsForDate(date).map((event) => ({
      ...event,
      documentMetadata: [],
    }));
  }

  async fetchEventPlansForRange(startDate: string, endDate: string) {
    if (
      !isValidKitchenDate(startDate) ||
      !isValidKitchenDate(endDate) ||
      startDate > endDate
    ) {
      throw new Error(
        "Event-plan sync range must use ordered YYYY-MM-DD dates.",
      );
    }
    return [];
  }

  async fetchEntertainmentEventsForDate(date: string) {
    if (!isValidKitchenDate(date)) {
      throw new Error("Entertainment sync date must use YYYY-MM-DD.");
    }
    return [];
  }

  async fetchEventDateById(eventId: string) {
    return (
      getMockKitchenEventsForDate("2026-07-28").find(
        (event) => String(event.eventId) === eventId,
      )?.localDate ?? null
    );
  }
}

let defaultAdapter: TripleseatAdapter | null = null;

function mockRequested(env: NodeJS.ProcessEnv) {
  return /^(1|true|yes)$/i.test(
    env.TRIPLESEAT_MOCK?.trim() ||
      env.TRIPLESEAT_MOCK_MODE?.trim() ||
      "",
  );
}

export function createTripleseatAdapter(options: LiveAdapterOptions = {}) {
  const env = options.env ?? process.env;
  const missing = getMissingTripleseatEnvironmentVariables(env);
  if (mockRequested(env) || missing.length > 0) {
    return new MockTripleseatAdapter({
      missingEnvironmentVariables: missing,
      locationId: env.TRIPLESEAT_LOCATION_ID?.trim() || DEFAULT_LOCATION_ID,
    });
  }
  return new LiveTripleseatAdapter(options);
}

export function getTripleseatAdapter() {
  defaultAdapter ??= createTripleseatAdapter();
  return defaultAdapter;
}

export function setTripleseatAdapterForTests(
  adapter: TripleseatAdapter | null,
) {
  defaultAdapter = adapter;
}
