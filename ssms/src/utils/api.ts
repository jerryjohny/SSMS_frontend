import { mockExpiryAlerts, mockPendingItems, mockProducts, mockStores } from "../data/shops";
import {
  AuditEvent,
  AccountingSnapshot,
  AuthResponse,
  AuthUser,
  CustomerAccount,
  ExpiryAlert,
  Inventory,
  PendingItem,
  PendingRegularizePayload,
  Product,
  ProductPayload,
  QueueSyncEvent,
  QueuedSale,
  RestockPayload,
  SaleDraftState,
  SalePayload,
  SaleSubmitResult,
  SessionProfilePayload,
  Store,
  StorePayload,
  UserAccount,
  UserPayload,
} from "./types";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "/api/v1";
const API_USES_RELATIVE_PROXY = !/^https?:\/\//i.test(API_BASE_URL);
const CACHE_PREFIX = "ssms-cache";
const OUTBOX_KEY = "ssms-sale-outbox";
const OUTBOX_LOG_KEY = "ssms-sale-outbox-log";
const ACCESS_TOKEN_KEY = "ssms-auth-token";
const REFRESH_TOKEN_KEY = "ssms-refresh-token";
const OUTBOX_EVENT_NAME = "ssms-outbox-changed";
export const OPEN_QUEUE_SHEET_EVENT_NAME = "ssms-open-offline-queue";

let refreshPromise: Promise<string | null> | null = null;

interface RequestOptions extends RequestInit {
  authenticated?: boolean;
  retryOnUnauthorized?: boolean;
}

class ApiRequestError extends Error {
  status?: number;
  isNetworkError: boolean;

  constructor(message: string, options?: { status?: number; isNetworkError?: boolean }) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options?.status;
    this.isNetworkError = options?.isNetworkError ?? false;
  }
}

function cacheKey(scope: string): string {
  return `${CACHE_PREFIX}:${scope}`;
}

function readCache<T>(scope: string, fallback: T): T {
  try {
    const rawValue = window.localStorage.getItem(cacheKey(scope));
    if (!rawValue) {
      return fallback;
    }
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function writeCache<T>(scope: string, value: T): void {
  try {
    window.localStorage.setItem(cacheKey(scope), JSON.stringify(value));
  } catch {
    return;
  }
}

function notifyOutboxChanged(): void {
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT_NAME));
}

export function requestOpenOfflineQueue(): void {
  window.dispatchEvent(new CustomEvent(OPEN_QUEUE_SHEET_EVENT_NAME));
}

function readOutbox(): QueuedSale[] {
  return readCache<QueuedSale[]>(OUTBOX_KEY, []);
}

function writeOutbox(queuedSales: QueuedSale[]): void {
  writeCache(OUTBOX_KEY, queuedSales);
  notifyOutboxChanged();
}

function readOutboxLog(): QueueSyncEvent[] {
  return readCache<QueueSyncEvent[]>(OUTBOX_LOG_KEY, []);
}

function appendOutboxLog(event: QueueSyncEvent): void {
  const nextLog = [event, ...readOutboxLog()].slice(0, 30);
  writeCache(OUTBOX_LOG_KEY, nextLog);
  notifyOutboxChanged();
}

function snapshotQueuedSale(payload: SalePayload): Pick<QueueSyncEvent, "itemCount" | "storeId" | "customerName"> {
  return {
    itemCount: payload.items.length,
    storeId: payload.store,
    customerName: payload.customer?.name?.trim() || undefined,
  };
}

function appendToOutbox(payload: SalePayload): void {
  const queuedSales = readOutbox();
  queuedSales.unshift({
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
    status: "queued",
    attemptCount: 0,
    payload,
  });
  writeOutbox(queuedSales.slice(0, 20));
}

function normalizeListPayload<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    "results" in payload &&
    Array.isArray((payload as { results: unknown[] }).results)
  ) {
    return (payload as { results: T[] }).results;
  }
  return [];
}

function normalizeProductImageUrl(imageUrl: string): string {
  if (!imageUrl) {
    return "";
  }

  if (/^(data:|blob:)/i.test(imageUrl)) {
    return imageUrl;
  }

  try {
    const resolvedUrl = new URL(imageUrl, window.location.origin);

    if (API_USES_RELATIVE_PROXY && resolvedUrl.pathname.startsWith("/media/")) {
      return `${window.location.origin}${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
    }

    return resolvedUrl.toString();
  } catch {
    return imageUrl;
  }
}

function normalizeProduct(product: Product): Product {
  return {
    ...product,
    image: normalizeProductImageUrl(product.image || ""),
  };
}

function readJson<T>(rawValue: string | null, fallback: T): T {
  if (!rawValue) {
    return fallback;
  }
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function saleDraftScope(userId: number, storeId: number | null): string {
  return `sale-draft:${userId}:${storeId ?? "none"}`;
}

function emptySaleDraft(): SaleDraftState {
  return {
    query: "",
    customer: {
      name: "",
      reference: "",
      phone: "",
    },
    lines: [],
  };
}

function isEmptySaleDraft(draft: SaleDraftState): boolean {
  return (
    !draft.query.trim() &&
    draft.lines.length === 0 &&
    !draft.customer.name.trim() &&
    !draft.customer.reference.trim() &&
    !draft.customer.phone.trim()
  );
}

export function readStoredAccessToken(): string {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY) || "";
}

export function readStoredRefreshToken(): string {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY) || "";
}

export function writeStoredAuthTokens(access: string, refresh: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, access);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
}

export function clearStoredAuthTokens(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function readStoredSaleDraft(userId: number, storeId: number | null): SaleDraftState {
  return readCache<SaleDraftState>(saleDraftScope(userId, storeId), emptySaleDraft());
}

export function writeStoredSaleDraft(
  userId: number,
  storeId: number | null,
  draft: SaleDraftState
): void {
  const scope = saleDraftScope(userId, storeId);

  if (isEmptySaleDraft(draft)) {
    window.localStorage.removeItem(cacheKey(scope));
    return;
  }

  writeCache(scope, draft);
}

export function clearStoredSaleDraft(userId: number, storeId: number | null): void {
  window.localStorage.removeItem(cacheKey(saleDraftScope(userId, storeId)));
}

async function readErrorMessage(response: Response): Promise<string> {
  function extractMessage(value: unknown): string {
    if (typeof value === "string" && value.trim()) {
      return value;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const nestedMessage = extractMessage(entry);
        if (nestedMessage) {
          return nestedMessage;
        }
      }
      return "";
    }

    if (value && typeof value === "object") {
      for (const nestedValue of Object.values(value)) {
        const nestedMessage = extractMessage(nestedValue);
        if (nestedMessage) {
          return nestedMessage;
        }
      }
    }

    return "";
  }

  try {
    const payload = (await response.json()) as { detail?: string; [key: string]: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }

    const nestedMessage = extractMessage(payload);
    if (nestedMessage) {
      return nestedMessage;
    }

    return `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const refresh = readStoredRefreshToken();
  if (!refresh) {
    return null;
  }

  refreshPromise = (async () => {
    const response = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh }),
    });

    if (!response.ok) {
      clearStoredAuthTokens();
      return null;
    }

    const payload = (await response.json()) as { access: string };
    writeStoredAuthTokens(payload.access, refresh);
    return payload.access;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    authenticated = true,
    retryOnUnauthorized = authenticated,
    headers: optionHeaders,
    ...fetchOptions
  } = options;
  const headers = new Headers(optionHeaders || {});
  const authToken = readStoredAccessToken();

  if (authenticated && authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  if (fetchOptions.body && !headers.has("Content-Type") && !(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      headers,
    });
  } catch (error) {
    const rawMessage =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Network request failed.";
    const message =
      /failed to fetch/i.test(rawMessage) || /network request failed/i.test(rawMessage)
        ? API_USES_RELATIVE_PROXY
          ? "Cannot reach the local backend. Check the proxy target and whether Django is running."
          : "Cannot reach the remote backend. Check REACT_APP_API_BASE_URL, CORS allowed origins, HTTPS, and whether the API is awake."
        : rawMessage;
    throw new ApiRequestError(message, { isNetworkError: true });
  }

  if (response.status === 401 && authenticated && retryOnUnauthorized) {
    const nextToken = await refreshAccessToken();
    if (nextToken) {
      return request<T>(path, {
        ...options,
        retryOnUnauthorized: false,
      });
    }
  }

  if (!response.ok) {
    throw new ApiRequestError(await readErrorMessage(response), { status: response.status });
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

async function loadCachedResource<T>({
  cacheName,
  path,
  fallback,
}: {
  cacheName: string;
  path: string;
  fallback: T[];
}): Promise<T[]> {
  try {
    const payload = await request<unknown>(path);
    const items = normalizeListPayload<T>(payload);
    writeCache(cacheName, items);
    return items;
  } catch {
    return readCache(cacheName, fallback);
  }
}

async function postSalePayload(payload: SalePayload): Promise<unknown> {
  const response = await request<unknown>("/sales/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const recentSales = readCache<unknown[]>("recent-sales", []);
  recentSales.unshift(response);
  writeCache("recent-sales", recentSales.slice(0, 10));
  return response;
}

export async function login(identifier: string, password: string): Promise<AuthResponse> {
  const payload = await request<AuthResponse>("/auth/login/", {
    method: "POST",
    authenticated: false,
    body: JSON.stringify({ identifier, password }),
  });
  writeStoredAuthTokens(payload.access, payload.refresh);
  return payload;
}

export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
  const payload = await request<AuthResponse>("/auth/google/", {
    method: "POST",
    authenticated: false,
    body: JSON.stringify({ credential }),
  });
  writeStoredAuthTokens(payload.access, payload.refresh);
  return payload;
}

export function logout(): void {
  clearStoredAuthTokens();
}

export function readStoredCurrentStoreId(): number | null {
  const storeId = window.localStorage.getItem(cacheKey("current-store"));
  const parsedValue = Number(storeId);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

export function writeStoredCurrentStoreId(storeId: number | null): void {
  if (!storeId) {
    window.localStorage.removeItem(cacheKey("current-store"));
    return;
  }
  window.localStorage.setItem(cacheKey("current-store"), String(storeId));
}

export async function fetchAuthSession(): Promise<AuthUser> {
  return request<AuthUser>("/auth/me/");
}

export async function updateSessionProfile(payload: SessionProfilePayload): Promise<AuthUser> {
  return request<AuthUser>("/auth/me/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function fetchAuditEvents(filters?: {
  eventType?: string;
  date?: string;
  storeId?: number | "all" | null;
  search?: string;
}): Promise<AuditEvent[]> {
  const searchParams = new URLSearchParams();

  if (filters?.eventType && filters.eventType !== "all") {
    searchParams.set("event_type", filters.eventType);
  }

  if (filters?.date) {
    searchParams.set("date", filters.date);
  }

  if (filters?.storeId && filters.storeId !== "all") {
    searchParams.set("store", String(filters.storeId));
  }

  if (filters?.search?.trim()) {
    searchParams.set("search", filters.search.trim());
  }

  const query = searchParams.toString();
  const payload = await request<unknown>(`/audit-events/${query ? `?${query}` : ""}`);
  return normalizeListPayload<AuditEvent>(payload);
}

export function fetchStores(): Promise<Store[]> {
  return loadCachedResource<Store>({
    cacheName: "stores",
    path: "/accounts/stores/",
    fallback: mockStores,
  });
}

export async function createStore(payload: StorePayload): Promise<Store> {
  const store = await request<Store>("/accounts/stores/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const cachedStores = readCache<Store[]>("stores", mockStores);
  writeCache("stores", [store, ...cachedStores.filter((item) => item.id !== store.id)]);
  return store;
}

export async function updateStore(storeId: number, payload: StorePayload): Promise<Store> {
  const store = await request<Store>(`/accounts/stores/${storeId}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  const cachedStores = readCache<Store[]>("stores", mockStores);
  writeCache(
    "stores",
    cachedStores.map((item) => (item.id === store.id ? store : item))
  );
  return store;
}

export async function fetchUsers(): Promise<UserAccount[]> {
  const payload = await request<unknown>("/accounts/users/");
  return normalizeListPayload<UserAccount>(payload);
}

export async function fetchCustomers(search = ""): Promise<CustomerAccount[]> {
  const searchParams = new URLSearchParams();
  if (search.trim()) {
    searchParams.set("search", search.trim());
  }
  const query = searchParams.toString();
  const payload = await request<unknown>(`/customers/${query ? `?${query}` : ""}`);
  return normalizeListPayload<CustomerAccount>(payload);
}

export async function createUser(payload: UserPayload): Promise<UserAccount> {
  const normalizedPayload = {
    ...payload,
    password: payload.password || undefined,
  };
  return request<UserAccount>("/accounts/users/", {
    method: "POST",
    body: JSON.stringify(normalizedPayload),
  });
}

export async function updateUser(userId: number, payload: UserPayload): Promise<UserAccount> {
  const normalizedPayload = {
    ...payload,
    password: payload.password || undefined,
  };
  return request<UserAccount>(`/accounts/users/${userId}/`, {
    method: "PATCH",
    body: JSON.stringify(normalizedPayload),
  });
}

export function fetchProducts(storeId?: number): Promise<Product[]> {
  const query = storeId ? `?store=${storeId}` : "";
  const cacheName = `products:${storeId || "all"}`;

  return loadCachedResource<Product>({
    cacheName,
    path: `/catalog/products/${query}`,
    fallback: mockProducts,
  }).then((products) => {
    const normalizedProducts = products.map(normalizeProduct);
    writeCache(cacheName, normalizedProducts);
    return normalizedProducts;
  });
}

function buildProductFormData(
  payload: ProductPayload,
  options: { includeRegistrationFields: boolean }
): FormData {
  const formData = new FormData();

  formData.append("name", payload.name);
  formData.append("barcode", payload.barcode);
  formData.append("sku", payload.sku || "");
  formData.append("description", payload.description || "");
  formData.append("packaging_details", payload.packaging_details || "");
  formData.append("unit_price", payload.unit_price);
  formData.append("package_price", payload.package_price || "");
  formData.append("box_price", payload.box_price || "");
  formData.append("units_per_package", String(payload.units_per_package));
  formData.append("units_per_box", String(payload.units_per_box));
  formData.append("is_active", String(payload.is_active ?? true));

  if (payload.image) {
    formData.append("image", payload.image);
  }

  if (options.includeRegistrationFields) {
    formData.append("store", String(payload.store));
    formData.append("initial_units", String(payload.initial_units));
    formData.append("initial_packages", String(payload.initial_packages));
    formData.append("initial_boxes", String(payload.initial_boxes));

    if (payload.initial_expiry_date) {
      formData.append("initial_expiry_date", payload.initial_expiry_date);
    }

    if (payload.note) {
      formData.append("note", payload.note);
    }
  }

  return formData;
}

export async function createProduct(payload: ProductPayload): Promise<Product> {
  const product = normalizeProduct(await request<Product>("/catalog/products/", {
    method: "POST",
    body: buildProductFormData(payload, { includeRegistrationFields: true }),
  }));
  const cachedProducts = readCache<Product[]>("products", mockProducts);
  writeCache("products", [product, ...cachedProducts.filter((item) => item.id !== product.id)]);
  return product;
}

export async function updateProduct(productId: number, payload: ProductPayload): Promise<Product> {
  const product = normalizeProduct(await request<Product>(`/catalog/products/${productId}/`, {
    method: "PATCH",
    body: buildProductFormData(payload, { includeRegistrationFields: false }),
  }));
  const cachedProducts = readCache<Product[]>("products", mockProducts);
  writeCache(
    "products",
    cachedProducts.map((item) => (item.id === product.id ? product : item))
  );
  return product;
}

export async function fetchInventories(storeId?: number): Promise<Inventory[]> {
  const query = storeId ? `?store=${storeId}` : "";
  const payload = await request<unknown>(`/catalog/inventories/${query}`);
  return normalizeListPayload<Inventory>(payload);
}

export async function restockInventory(payload: RestockPayload): Promise<Inventory> {
  return request<Inventory>("/catalog/inventories/restock/", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      expiry_date: payload.expiry_date || undefined,
    }),
  });
}

export function fetchPendingItems(): Promise<PendingItem[]> {
  return loadCachedResource<PendingItem>({
    cacheName: "pending-items",
    path: "/pending-items/",
    fallback: mockPendingItems,
  });
}

export async function regularizePendingItem(
  itemId: number,
  payload: PendingRegularizePayload
): Promise<PendingItem> {
  const item = await request<PendingItem>(`/pending-items/${itemId}/regularize/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const cachedItems = readCache<PendingItem[]>("pending-items", mockPendingItems);
  writeCache(
    "pending-items",
    item.pending_priority > 0
      ? cachedItems.map((cachedItem) => (cachedItem.id === item.id ? item : cachedItem))
      : cachedItems.filter((cachedItem) => cachedItem.id !== item.id)
  );
  return item;
}

export function fetchAccountingSnapshot(date: string, storeId?: number): Promise<AccountingSnapshot> {
  const searchParams = new URLSearchParams();

  if (date) {
    searchParams.set("date", date);
  }

  if (storeId) {
    searchParams.set("store", String(storeId));
  }

  const query = searchParams.toString();
  return request<AccountingSnapshot>(`/sales/accounting/${query ? `?${query}` : ""}`);
}

export function fetchExpiryAlerts(storeId?: number): Promise<ExpiryAlert[]> {
  const query = storeId ? `?store=${storeId}` : "";
  return loadCachedResource<ExpiryAlert>({
    cacheName: `expiry-alerts:${storeId || "all"}`,
    path: `/catalog/products/expiry-alerts/${query}`,
    fallback: mockExpiryAlerts,
  });
}

export async function submitSale(payload: SalePayload): Promise<SaleSubmitResult> {
  try {
    const response = await postSalePayload(payload);
    return { status: "submitted", sale: response };
  } catch (error) {
    if (error instanceof ApiRequestError && error.isNetworkError) {
      appendToOutbox(payload);
      return { status: "queued", sale: payload };
    }

    return {
      status: "failed",
      sale: payload,
      error: error instanceof Error ? error.message : "Unable to save the sale.",
    };
  }
}

export async function reorderPendingItems(
  items: Array<{ id: number; pending_priority: number }>
): Promise<void> {
  await request<unknown>("/pending-items/reorder/", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export function fetchQueuedSales(): QueuedSale[] {
  return readOutbox();
}

export function fetchQueueSyncEvents(): QueueSyncEvent[] {
  return readOutboxLog();
}

export function clearQueueSyncEvents(): void {
  window.localStorage.removeItem(cacheKey(OUTBOX_LOG_KEY));
  notifyOutboxChanged();
}

export function removeQueuedSale(queuedSaleId: string): void {
  writeOutbox(readOutbox().filter((queuedSale) => queuedSale.id !== queuedSaleId));
}

export function subscribeToOutbox(listener: () => void): () => void {
  window.addEventListener(OUTBOX_EVENT_NAME, listener);
  return () => {
    window.removeEventListener(OUTBOX_EVENT_NAME, listener);
  };
}

export async function retryQueuedSales(queuedSaleIds?: string[]): Promise<{
  synced: number;
  failed: number;
  remaining: number;
}> {
  let synced = 0;
  let failed = 0;
  const targetIds = queuedSaleIds ? new Set(queuedSaleIds) : null;
  const queuedSales = [...readOutbox()]
    .filter((queuedSale) => !targetIds || targetIds.has(queuedSale.id))
    .sort((left, right) => new Date(left.queuedAt).getTime() - new Date(right.queuedAt).getTime());

  for (const queuedSale of queuedSales) {
    const currentQueue = readOutbox();
    const currentItem = currentQueue.find((item) => item.id === queuedSale.id);

    if (!currentItem) {
      continue;
    }

    const syncingItem: QueuedSale = {
      ...currentItem,
      status: "syncing",
      attemptCount: currentItem.attemptCount + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: "",
    };

    writeOutbox(currentQueue.map((item) => (item.id === syncingItem.id ? syncingItem : item)));

    try {
      await postSalePayload(syncingItem.payload);
      synced += 1;
      writeOutbox(readOutbox().filter((item) => item.id !== syncingItem.id));
      appendOutboxLog({
        id: crypto.randomUUID(),
        queuedSaleId: syncingItem.id,
        status: "synced",
        processedAt: new Date().toISOString(),
        ...snapshotQueuedSale(syncingItem.payload),
        message: "",
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unable to sync queued sale.";
      writeOutbox(
        readOutbox().map((item) =>
          item.id === syncingItem.id
            ? {
                ...syncingItem,
                status: "failed",
                lastError: message,
              }
            : item
        )
      );
      appendOutboxLog({
        id: crypto.randomUUID(),
        queuedSaleId: syncingItem.id,
        status: "failed",
        processedAt: new Date().toISOString(),
        ...snapshotQueuedSale(syncingItem.payload),
        message,
      });
    }
  }

  return {
    synced,
    failed,
    remaining: readOutbox().length,
  };
}

export function readCachedUserList(): UserAccount[] {
  return readJson<UserAccount[]>(window.localStorage.getItem(cacheKey("users")), []);
}
