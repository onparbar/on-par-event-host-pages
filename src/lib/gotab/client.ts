import "server-only";

import {
  requireGoTabConfiguration,
  type GoTabConfiguration,
} from "./config";

const GOTAB_ORIGIN = "https://gotab.io";
const GOTAB_ORDERING_ORIGIN = "https://gotab.io/api";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TEMPORARY_RETRIES = 2;
const TOKEN_REFRESH_SKEW_MS = 60_000;

type FetchImplementation = typeof fetch;
type UnknownRecord = Record<string, unknown>;

export type GoTabLocation = {
  locationUuid: string;
  locationId: number | string;
  name: string;
  timezone: string | null;
  urlName: string | null;
};

export type GoTabCatalogProduct = {
  productId: string;
  productUuid: string | null;
  name: string;
  description: string | null;
  shortName: string | null;
  productCode: string | null;
  hasVariants: boolean;
};

export type GoTabCatalogCategory = {
  label: string;
  products: GoTabCatalogProduct[];
};

export type GoTabCatalogMenu = {
  name: string;
  categories: GoTabCatalogCategory[];
};

export type GoTabEventFoodProduct = {
  productId: string;
  productUuid: string;
  name: string;
};

export type GoTabEventFoodTabResult = {
  tabUuid: string | null;
  orderUuid: string | null;
  itemUuid: string | null;
};

export type GoTabCapabilityCheck = {
  connected: boolean;
  configuredLocationUuid: string;
  matchedLocation: GoTabLocation | null;
  locationAuthorized: boolean;
  menuRead: "allowed" | "denied" | "not-checked";
  catalogRead: "allowed" | "denied" | "not-checked";
  spotRead: "not-checked";
  stationRead: "not-checked";
  productWrite: "not-checked";
  orderCreate: "not-checked";
  multipleOrdersPerTab: "not-checked";
  zeroDollarOrders: "not-checked";
  checkedAt: string;
  lastError: string | null;
};

export class GoTabApiError extends Error {
  readonly kind: "authentication" | "authorization" | "temporary" | "response";
  readonly status: number | null;

  constructor(
    kind: GoTabApiError["kind"],
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "GoTabApiError";
    this.kind = kind;
    this.status = status;
  }
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function temporaryStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelay(attempt: number, response?: Response) {
  const retryAfter = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, 5_000);
  }
  return 250 * 2 ** attempt;
}

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class GoTabClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly configuration: GoTabConfiguration = requireGoTabConfiguration(),
    private readonly fetchImpl: FetchImplementation = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async authenticateGoTab(force = false) {
    if (
      !force &&
      this.token &&
      this.token.expiresAt - TOKEN_REFRESH_SKEW_MS > this.now()
    ) {
      return this.token.value;
    }

    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${GOTAB_ORIGIN}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          api_access_id: this.configuration.apiAccessId,
          api_access_secret: this.configuration.apiAccessSecret,
        }),
      });
    } catch {
      throw new GoTabApiError(
        "temporary",
        "GoTab authentication is temporarily unavailable.",
      );
    }
    if (!response.ok) {
      throw new GoTabApiError(
        "authentication",
        "GoTab authentication failed. Verify the server-side Vercel credentials.",
        response.status,
      );
    }
    const payload = record(await response.json().catch(() => null));
    const accessToken = text(payload?.token) ?? text(payload?.access_token);
    const expiresIn = number(payload?.expiresIn) ?? number(payload?.expires_in);
    if (!accessToken || !expiresIn || expiresIn <= 0) {
      throw new GoTabApiError(
        "response",
        "GoTab returned an invalid authentication response.",
      );
    }
    this.token = {
      value: accessToken,
      expiresAt: this.now() + expiresIn * 1_000,
    };
    return accessToken;
  }

  private async authorizedRequest(path: string, init: RequestInit = {}) {
    let refreshed = false;
    for (let attempt = 0; attempt <= MAX_TEMPORARY_RETRIES; attempt += 1) {
      const token = await this.authenticateGoTab(refreshed);
      let response: Response;
      try {
        response = await this.fetchWithTimeout(`${GOTAB_ORIGIN}${path}`, {
          ...init,
          headers: {
            accept: "application/json",
            ...init.headers,
            authorization: `Bearer ${token}`,
          },
        });
      } catch {
        if (attempt < MAX_TEMPORARY_RETRIES) {
          await pause(retryDelay(attempt));
          continue;
        }
        throw new GoTabApiError(
          "temporary",
          "GoTab is temporarily unavailable.",
        );
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.token = null;
        continue;
      }
      if (temporaryStatus(response.status) && attempt < MAX_TEMPORARY_RETRIES) {
        await pause(retryDelay(attempt, response));
        continue;
      }
      if (!response.ok) {
        const kind = response.status === 401
          ? "authentication"
          : response.status === 403
            ? "authorization"
            : temporaryStatus(response.status)
              ? "temporary"
              : "response";
        throw new GoTabApiError(
          kind,
          kind === "authorization"
            ? "GoTab denied access to the requested resource."
            : kind === "authentication"
              ? "GoTab authentication failed. Verify the server-side Vercel credentials."
              : "GoTab could not complete the requested operation.",
          response.status,
        );
      }
      return response;
    }
    throw new GoTabApiError("temporary", "GoTab is temporarily unavailable.");
  }

  async createEventFoodTab(input: {
    externalId: string;
    ticketName: string;
    productUuid: string;
    quantity: number;
    itemName: string;
    itemNotes: Record<string, unknown>;
  }): Promise<GoTabEventFoodTabResult> {
    if (!input.externalId.trim() || !input.ticketName.trim() || !input.productUuid.trim()) {
      throw new GoTabApiError("response", "The Event Food order is incomplete.");
    }
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
      throw new GoTabApiError("response", "The Event Food quantity is invalid.");
    }
    const payload = {
      externalId: input.externalId,
      openTab: true,
      spotUuid: this.configuration.eventSpotUuid,
      phoneNumber: this.configuration.eventCustomerPhone,
      name: input.ticketName.slice(0, 80),
      items: [{
        externalId: input.externalId,
        quantity: input.quantity,
        productUuid: input.productUuid,
        name: input.itemName.slice(0, 20),
        modifiers: [],
        notes: { event_host: input.itemNotes },
      }],
    };
    const token = await this.authenticateGoTab();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(
        `${GOTAB_ORDERING_ORIGIN}/loc/${encodeURIComponent(this.configuration.locationUuid)}/tabs`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
    } catch {
      throw new GoTabApiError("temporary", "GoTab ordering is temporarily unavailable.");
    }
    if (!response.ok) {
      throw new GoTabApiError(
        response.status === 401 ? "authentication" : temporaryStatus(response.status) ? "temporary" : "response",
        response.status === 401
          ? "GoTab authentication failed. Verify the server-side Vercel credentials."
          : "GoTab could not create the Event Food order.",
        response.status,
      );
    }
    const result = record(await response.json().catch(() => null));
    const orders = Array.isArray(result?.orders) ? result.orders.map(record) : [];
    const firstOrder = orders.find(Boolean) ?? record(result?.order);
    const items = Array.isArray(firstOrder?.items) ? firstOrder.items.map(record) : [];
    return {
      tabUuid: text(result?.tabUuid) ?? text(result?.tab_uuid),
      orderUuid: text(firstOrder?.orderUuid) ?? text(firstOrder?.order_uuid),
      itemUuid: text(items.find(Boolean)?.itemUuid) ?? text(items.find(Boolean)?.item_uuid),
    };
  }

  async getAuthorizedLocations(): Promise<GoTabLocation[]> {
    const response = await this.authorizedRequest("/api/loc");
    const payload = await response.json().catch(() => null);
    const responseRecord = record(payload);
    const locations = Array.isArray(payload)
      ? payload
      : Array.isArray(responseRecord?.data)
        ? responseRecord.data
        : null;
    if (!locations) {
      throw new GoTabApiError("response", "GoTab returned an invalid location response.");
    }
    return locations.flatMap((item) => {
      const value = record(item);
      const locationUuid = text(value?.locationUuid);
      const locationId = number(value?.locationId) ?? text(value?.locationId);
      const name = text(value?.name);
      return locationUuid && locationId != null && name
        ? [{
            locationUuid,
            locationId,
            name,
            timezone: text(value?.timezone),
            urlName: text(value?.urlName),
          }]
        : [];
    });
  }

  async verifyConfiguredLocation() {
    const locations = await this.getAuthorizedLocations();
    const match = locations.find(
      (location) => location.locationUuid === this.configuration.locationUuid,
    );
    if (!match) {
      throw new GoTabApiError(
        "authorization",
        "The GoTab credentials are valid, but they do not have access to the configured On Par Entertainment location.",
        403,
      );
    }
    return match;
  }

  async getGoTabMenus() {
    const location = await this.verifyConfiguredLocation();
    const response = await this.authorizedRequest(
      `/api/loc/${encodeURIComponent(location.locationUuid)}/menus`,
    );
    return response.json() as Promise<unknown>;
  }

  async getGoTabCatalog(): Promise<GoTabCatalogMenu[]> {
    const location = await this.verifyConfiguredLocation();
    const response = await this.authorizedRequest("/api/graph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query EventFoodCatalog($locationUuid: String!) {
          location(locationUuid: $locationUuid) {
            availableMenusList {
              name
              availableCategoriesList {
                label
                availableProductsList {
                  productId productUuid name description shortName productCode hasVariants
                }
              }
            }
          }
        }`,
        variables: { locationUuid: location.locationUuid },
      }),
    });
    const payload = record(await response.json().catch(() => null));
    if (Array.isArray(payload?.errors)) {
      throw new GoTabApiError("response", "GoTab could not read the product catalog.");
    }
    const data = record(payload?.data);
    const locationData = record(data?.location);
    const menus = locationData?.availableMenusList;
    if (!Array.isArray(menus)) {
      throw new GoTabApiError("response", "GoTab returned an invalid catalog response.");
    }
    return menus.flatMap((menuValue) => {
      const menu = record(menuValue);
      const name = text(menu?.name);
      const categoryValues = menu?.availableCategoriesList;
      if (!name || !Array.isArray(categoryValues)) return [];
      return [{
        name,
        categories: categoryValues.flatMap((categoryValue) => {
          const category = record(categoryValue);
          const label = text(category?.label);
          const productValues = category?.availableProductsList;
          if (!label || !Array.isArray(productValues)) return [];
          return [{
            label,
            products: productValues.flatMap((productValue) => {
              const product = record(productValue);
              const productId = text(product?.productId);
              const productName = text(product?.name);
              if (!productId || !productName) return [];
              return [{
                productId,
                productUuid: text(product?.productUuid),
                name: productName,
                description: text(product?.description),
                shortName: text(product?.shortName),
                productCode: text(product?.productCode),
                hasVariants: product?.hasVariants === true,
              }];
            }),
          }];
        }),
      }];
    });
  }

  async getEventFoodProducts(): Promise<GoTabEventFoodProduct[]> {
    const location = await this.verifyConfiguredLocation();
    const response = await this.authorizedRequest("/api/graph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query EventFoodProducts($locationId: BigInt!) {
          location(locationId: $locationId) {
            categoriesList(includeArchived: NO) { categoryId label }
            productsList(includeArchived: NO) { productId productUuid name categoryId }
          }
        }`,
        variables: { locationId: String(location.locationId) },
      }),
    });
    const payload = record(await response.json().catch(() => null));
    if (Array.isArray(payload?.errors)) {
      throw new GoTabApiError("response", "GoTab could not read the Event Food catalog.");
    }
    const locationData = record(record(payload?.data)?.location);
    const categories = locationData?.categoriesList;
    const products = locationData?.productsList;
    if (!Array.isArray(categories) || !Array.isArray(products)) {
      throw new GoTabApiError("response", "GoTab returned an invalid Event Food catalog response.");
    }
    const eventFoodCategory = categories
      .map(record)
      .find((category) => text(category?.label)?.toLowerCase() === "event food");
    const categoryId = text(eventFoodCategory?.categoryId) ?? number(eventFoodCategory?.categoryId)?.toString();
    if (!categoryId) return [];
    return products.flatMap((productValue) => {
      const product = record(productValue);
      const productId = text(product?.productId) ?? number(product?.productId)?.toString();
      const productUuid = text(product?.productUuid);
      const name = text(product?.name);
      const productCategoryId = text(product?.categoryId) ?? number(product?.categoryId)?.toString();
      return productId && productUuid && name && productCategoryId === categoryId
        ? [{ productId, productUuid, name }]
        : [];
    });
  }

  async checkCapabilities(): Promise<GoTabCapabilityCheck> {
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const matchedLocation = await this.verifyConfiguredLocation();
      let menuRead: GoTabCapabilityCheck["menuRead"] = "not-checked";
      let catalogRead: GoTabCapabilityCheck["catalogRead"] = "not-checked";
      try {
        await this.getGoTabMenus();
        menuRead = "allowed";
      } catch (error) {
        menuRead = error instanceof GoTabApiError && error.kind === "authorization"
          ? "denied"
          : "not-checked";
      }
      try {
        await this.getGoTabCatalog();
        catalogRead = "allowed";
      } catch (error) {
        catalogRead = error instanceof GoTabApiError && error.kind === "authorization"
          ? "denied"
          : "not-checked";
      }
      return {
        connected: true,
        configuredLocationUuid: this.configuration.locationUuid,
        matchedLocation,
        locationAuthorized: true,
        menuRead,
        catalogRead,
        spotRead: "not-checked",
        stationRead: "not-checked",
        productWrite: "not-checked",
        orderCreate: "not-checked",
        multipleOrdersPerTab: "not-checked",
        zeroDollarOrders: "not-checked",
        checkedAt,
        lastError: null,
      };
    } catch (error) {
      return {
        connected: false,
        configuredLocationUuid: this.configuration.locationUuid,
        matchedLocation: null,
        locationAuthorized: false,
        menuRead: "not-checked",
        catalogRead: "not-checked",
        spotRead: "not-checked",
        stationRead: "not-checked",
        productWrite: "not-checked",
        orderCreate: "not-checked",
        multipleOrdersPerTab: "not-checked",
        zeroDollarOrders: "not-checked",
        checkedAt,
        lastError: error instanceof Error ? error.message : "GoTab connection failed.",
      };
    }
  }
}
