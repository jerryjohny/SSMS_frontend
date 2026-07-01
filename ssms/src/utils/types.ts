export type UserRole = "sysadmin" | "admin" | "seller";
export type PageKey = "home" | "pending" | "catalog";
export type PickupStatus = "now" | "later";
export type PaymentStatus = "now" | "partial" | "later";
export type Language = "en" | "pt";
export type AuditEventType =
  | "create"
  | "update"
  | "delete"
  | "sell"
  | "restock"
  | "regularize"
  | "reorder"
  | "password"
  | "login";

export interface TenantSummary {
  id: number;
  name: string;
  slug: string;
  is_active?: boolean;
}

export interface TenantPayload {
  name: string;
  slug: string;
  is_active?: boolean;
}

export interface StoreAdminSummary {
  id: number;
  display_name: string;
  email: string;
  phone: string;
}

export interface Store {
  id: number;
  tenant?: number;
  tenant_name?: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  admin_user?: StoreAdminSummary | null;
  is_active?: boolean;
}

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: UserRole;
  tenant: TenantSummary | null;
  store: Store | null;
  assigned_stores: Store[];
  is_active: boolean;
}

export interface AuthResponse {
  access: string;
  refresh: string;
  user: AuthUser;
}

export interface Product {
  id: number;
  name: string;
  barcode: string;
  sku?: string;
  description?: string;
  packaging_details: string;
  unit_price: string;
  package_price?: string | null;
  box_price?: string | null;
  units_per_package: number;
  units_per_box: number;
  total_stock_units: number;
  nearest_expiry_date: string | null;
  image: string;
  inventories?: Inventory[];
}

export interface Inventory {
  id: number;
  product: number;
  product_name: string;
  product_barcode: string;
  store: number;
  store_name: string;
  stock_units: number;
  reserved_units: number;
  available_units: number;
  is_active: boolean;
}

export interface ProductPayload {
  name: string;
  barcode: string;
  sku?: string;
  description?: string;
  packaging_details: string;
  unit_price: string;
  package_price?: string;
  box_price?: string;
  units_per_package: number;
  units_per_box: number;
  image?: File | null;
  is_active?: boolean;
  store: number;
  initial_units: number;
  initial_packages: number;
  initial_boxes: number;
  initial_expiry_date?: string;
  note?: string;
}

export interface RestockPayload {
  inventory: number;
  units_added: number;
  packages_added: number;
  boxes_added: number;
  expiry_date?: string;
  note?: string;
}

export interface UserAccount {
  id: number;
  username: string;
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  tenant?: number;
  tenant_name?: string;
  store: number | null;
  assigned_stores: number[];
  assigned_store_details: Store[];
  role: UserRole;
  is_active: boolean;
}

export interface UserPayload {
  username: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  email: string;
  phone?: string;
  store?: number | null;
  assigned_stores?: number[];
  role: UserRole;
  is_active?: boolean;
  password?: string;
}

export interface StorePayload {
  tenant?: number | null;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  admin_user_id?: number | null;
  is_active?: boolean;
}

export interface CustomerAccount {
  id: number;
  tenant?: number;
  name: string;
  reference: string;
  phone?: string;
  notes?: string;
  credit_balance?: string;
  debt_balance?: string;
}

export interface SessionProfilePayload {
  display_name?: string;
  email?: string;
  phone?: string;
  current_password?: string;
  new_password?: string;
  confirm_new_password?: string;
}

export interface AuditEvent {
  id: number;
  created_at: string;
  event_type: AuditEventType;
  actor_name: string;
  actor_role: string;
  store: number | null;
  store_name: string;
  resource_type: string;
  resource_id: number | null;
  resource_label: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface PendingItem {
  id: number;
  order_number: string;
  product_name: string;
  customer_name: string;
  store_name: string;
  quantity_units: number;
  line_total: string;
  amount_paid: string;
  pickup_status: PickupStatus;
  payment_status: PaymentStatus;
  pending_priority: number;
  note: string;
  debt_amount: string;
  credit_amount: string;
  is_collected: boolean;
  is_settled: boolean;
}

export interface PendingRegularizePayload {
  mark_collected: boolean;
  regularize_amount?: string;
}

export interface ExpiryAlert {
  id: number;
  product_name: string;
  store_name: string;
  units_remaining: number;
  expiry_date: string;
}

export interface CustomerDraft {
  id?: number;
  name: string;
  reference: string;
  phone: string;
}

export interface SaleLine {
  local_id: string;
  product_id: number;
  product_name: string;
  quantity_units: number;
  unit_price: string;
  amount_paid: string;
  pickup_status: PickupStatus;
  payment_status: PaymentStatus;
  note: string;
}

export interface SaleDraftState {
  query: string;
  customer: CustomerDraft;
  lines: SaleLine[];
}

export interface SalePayloadItem {
  product: number;
  quantity_units: number;
  unit_price: string;
  amount_paid: string;
  pickup_status: PickupStatus;
  payment_status: PaymentStatus;
  note: string;
}

export interface SalePayload {
  store: number;
  note: string;
  customer?: {
    id?: number;
    name?: string;
    reference?: string;
    phone?: string;
  };
  items: SalePayloadItem[];
}

export interface AccountingSnapshotSummary {
  sale_count: number;
  line_count: number;
  units_sold: number;
  gross_total: string;
  paid_total: string;
  debt_total: string;
  credit_total: string;
}

export interface AccountingSellerSummary {
  seller_id: number;
  seller_name: string;
  sale_count: number;
  units_sold: number;
  gross_total: string;
  paid_total: string;
  debt_total: string;
  credit_total: string;
}

export interface AccountingSaleItem {
  id: number;
  product: number;
  product_name: string;
  quantity_units: number;
  unit_price: string;
  line_total: string;
  amount_paid: string;
  pickup_status: PickupStatus;
  payment_status: PaymentStatus;
  note: string;
  debt_amount: string;
  credit_amount: string;
}

export interface AccountingSale {
  id: number;
  order_number: string;
  store: number;
  store_name: string;
  seller: number;
  seller_name: string;
  status: string;
  note: string;
  gross_total: string;
  paid_total: string;
  debt_total: string;
  credit_total: string;
  items: AccountingSaleItem[];
  created_at: string;
  updated_at: string;
}

export interface AccountingSnapshot {
  date: string;
  store_id: number | null;
  store_name: string | null;
  summary: AccountingSnapshotSummary;
  sellers: AccountingSellerSummary[];
  sales: AccountingSale[];
}

export type QueuedSaleStatus = "queued" | "syncing" | "failed";
export type QueueSyncEventStatus = "synced" | "failed";

export interface QueuedSale {
  id: string;
  queuedAt: string;
  status: QueuedSaleStatus;
  attemptCount: number;
  lastAttemptAt?: string;
  lastError?: string;
  payload: SalePayload;
}

export interface QueueSyncEvent {
  id: string;
  queuedSaleId: string;
  status: QueueSyncEventStatus;
  processedAt: string;
  itemCount: number;
  storeId: number;
  customerName?: string;
  message: string;
}

export interface SaleSubmitResult {
  status: "submitted" | "queued" | "failed";
  sale: unknown;
  error?: string;
}
