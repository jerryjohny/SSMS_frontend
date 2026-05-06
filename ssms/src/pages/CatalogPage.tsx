import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../authContext";
import BarcodeCaptureSheet from "../components/BarcodeCaptureSheet";
import { useI18n } from "../i18nContext";
import {
  fetchAuditEvents,
  createProduct,
  createStore,
  createUser,
  fetchExpiryAlerts,
  fetchInventories,
  fetchProducts,
  fetchStores,
  fetchUsers,
  restockInventory,
  updateStore,
  updateProduct,
  updateUser,
} from "../utils/api";
import { formatCurrency, formatDate } from "../utils/sales";
import {
  AuditEvent,
  AuditEventType,
  ExpiryAlert,
  Inventory,
  Product,
  ProductPayload,
  RestockPayload,
  Store,
  StorePayload,
  UserAccount,
  UserPayload,
  UserRole,
} from "../utils/types";
import "./catalog.css";

type CatalogModal = "product" | "restock" | "store" | "user" | null;
type CatalogTab = "general" | "expiry" | "stock" | "inventory" | "stores" | "users" | "audit";
type ProductPriceTouchState = {
  packagePrice: boolean;
  boxPrice: boolean;
};

type ProductPackagingMode = "" | "package" | "box";

function auditEventLabel(copy: ReturnType<typeof useI18n>["copy"], eventType: AuditEventType): string {
  switch (eventType) {
    case "create":
      return copy.catalog.actionCreate;
    case "update":
      return copy.catalog.actionUpdate;
    case "delete":
      return copy.catalog.actionDelete;
    case "sell":
      return copy.catalog.actionSell;
    case "restock":
      return copy.catalog.actionRestock;
    case "regularize":
      return copy.catalog.actionRegularize;
    case "reorder":
      return copy.catalog.actionReorder;
    case "password":
      return copy.catalog.actionPassword;
    case "login":
      return copy.catalog.actionLogin;
    default:
      return eventType;
  }
}

function auditEventTone(eventType: AuditEventType): string {
  switch (eventType) {
    case "create":
    case "sell":
    case "restock":
    case "regularize":
      return "positive";
    case "delete":
      return "danger";
    case "password":
    case "login":
      return "neutral";
    case "reorder":
      return "warning";
    case "update":
    default:
      return "neutral";
  }
}

function formatAuditDateTime(value: string, locale: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function emptyProductDraft(storeId: number | null): ProductPayload {
  return {
    name: "",
    barcode: "",
    sku: "",
    description: "",
    packaging_details: "",
    unit_price: "",
    package_price: "",
    box_price: "",
    units_per_package: 0,
    units_per_box: 0,
    image: null,
    store: storeId || 0,
    initial_units: 0,
    initial_packages: 0,
    initial_boxes: 0,
    initial_expiry_date: "",
    note: "",
    is_active: true,
  };
}

function computeDerivedPrice(unitPrice: string, units: number): string {
  const parsedUnitPrice = Number(unitPrice);

  if (!unitPrice || !Number.isFinite(parsedUnitPrice) || parsedUnitPrice <= 0 || units <= 0) {
    return "";
  }

  return (parsedUnitPrice * units)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

function applyDerivedProductPrices(
  draft: ProductPayload,
  touchedState: ProductPriceTouchState
): ProductPayload {
  const nextDraft = { ...draft };

  if (!touchedState.packagePrice || !nextDraft.package_price) {
    nextDraft.package_price = computeDerivedPrice(nextDraft.unit_price, nextDraft.units_per_package);
  }

  if (!touchedState.boxPrice || !nextDraft.box_price) {
    nextDraft.box_price = computeDerivedPrice(nextDraft.unit_price, nextDraft.units_per_box);
  }

  return nextDraft;
}

function applyDerivedInitialUnits(draft: ProductPayload): ProductPayload {
  const nextDraft = { ...draft };

  nextDraft.initial_units =
    nextDraft.initial_packages * nextDraft.units_per_package +
    nextDraft.initial_boxes * nextDraft.units_per_box;

  return nextDraft;
}

function emptyRestockDraft(inventoryId?: number): RestockPayload {
  return {
    inventory: inventoryId || 0,
    units_added: 0,
    packages_added: 0,
    boxes_added: 0,
    expiry_date: "",
    note: "",
  };
}

function emptyProductPackagingMode(): ProductPackagingMode {
  return "package";
}

function resolveProductPackagingMode(product?: Product): ProductPackagingMode {
  if (!product) {
    return "package";
  }

  if (Boolean(product.package_price) || product.units_per_package > 1) {
    return "package";
  }

  if (Boolean(product.box_price) || product.units_per_box > 1) {
    return "box";
  }

  return "package";
}

function emptyStoreDraft(): StorePayload {
  return {
    name: "",
    code: "",
    address: "",
    phone: "",
    admin_user_id: null,
    is_active: true,
  };
}

function emptyUserDraft(): UserPayload {
  return {
    username: "",
    display_name: "",
    email: "",
    phone: "",
    password: "",
    role: "seller",
    store: null,
    assigned_stores: [],
    is_active: true,
  };
}

function ManagementSheet({
  open,
  title,
  eyebrow,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { copy } = useI18n();

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="catalog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="catalog-sheet surface-panel">
        <div className="catalog-sheet__header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {copy.common.close}
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export default function CatalogPage() {
  const { copy, language } = useI18n();
  const { currentStore, currentStoreId, role } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [activeModal, setActiveModal] = useState<CatalogModal>(null);
  const [productDraft, setProductDraft] = useState<ProductPayload>(emptyProductDraft(currentStoreId));
  const [restockDraft, setRestockDraft] = useState<RestockPayload>(emptyRestockDraft());
  const [storeDraft, setStoreDraft] = useState<StorePayload>(emptyStoreDraft());
  const [userDraft, setUserDraft] = useState<UserPayload>(emptyUserDraft());
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [productPriceTouched, setProductPriceTouched] = useState<ProductPriceTouchState>({
    packagePrice: false,
    boxPrice: false,
  });
  const [productPackagingMode, setProductPackagingMode] = useState<ProductPackagingMode>(
    emptyProductPackagingMode()
  );
  const [productImagePreview, setProductImagePreview] = useState("");
  const [productBarcodeScannerOpen, setProductBarcodeScannerOpen] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<number | null>(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<CatalogTab>("general");
  const [auditTypeFilter, setAuditTypeFilter] = useState<AuditEventType | "all">("all");
  const [auditDateFilter, setAuditDateFilter] = useState("");
  const [auditStoreFilter, setAuditStoreFilter] = useState<number | "all">("all");
  const [auditSearch, setAuditSearch] = useState("");
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const productImageInputRef = useRef<HTMLInputElement | null>(null);
  const productCameraInputRef = useRef<HTMLInputElement | null>(null);

  const canManageCatalog = role === "admin" || role === "sysadmin";
  const canManageUsers = role === "sysadmin";
  const canViewAudit = role === "sysadmin";
  const visibleInventories = useMemo(
    () =>
      currentStoreId
        ? inventories.filter((inventory) => inventory.store === currentStoreId)
        : inventories,
    [currentStoreId, inventories]
  );
  const visibleInventoryProductIds = useMemo(
    () => new Set(visibleInventories.map((inventory) => inventory.product)),
    [visibleInventories]
  );
  const visibleProducts = useMemo(
    () =>
      currentStoreId
        ? products.filter((product) => visibleInventoryProductIds.has(product.id))
        : products,
    [currentStoreId, products, visibleInventoryProductIds]
  );
  const visibleExpiryAlerts = useMemo(
    () =>
      currentStore?.name
        ? expiryAlerts.filter((alert) => alert.store_name === currentStore.name)
        : expiryAlerts,
    [currentStore?.name, expiryAlerts]
  );
  const lowStockCount = useMemo(
    () => visibleInventories.filter((inventory) => Number(inventory.available_units) <= 20).length,
    [visibleInventories]
  );
  const productsByExpiry = useMemo(
    () =>
      [...visibleProducts]
        .filter((product) => Boolean(product.nearest_expiry_date))
        .sort((left, right) => {
          const expiryDifference =
            new Date(`${left.nearest_expiry_date}T00:00:00`).getTime() -
            new Date(`${right.nearest_expiry_date}T00:00:00`).getTime();

          if (expiryDifference !== 0) {
            return expiryDifference;
          }

          return left.name.localeCompare(right.name);
        }),
    [visibleProducts]
  );
  const stockInventories = useMemo(
    () =>
      [...visibleInventories].sort((left, right) => {
        const stockDifference = Number(left.available_units) - Number(right.available_units);
        if (stockDifference !== 0) {
          return stockDifference;
        }

        return left.product_name.localeCompare(right.product_name);
      }),
    [visibleInventories]
  );

  const sortedInventories = useMemo(
    () =>
      [...visibleInventories].sort((left, right) =>
        `${left.product_name}${left.store_name}`.localeCompare(`${right.product_name}${right.store_name}`)
      ),
    [visibleInventories]
  );
  const adminUsers = useMemo(
    () =>
      [...users]
        .filter((userAccount) => userAccount.role === "admin" && userAccount.is_active)
        .sort((left, right) =>
          `${left.display_name || left.username}${left.email}`.localeCompare(
            `${right.display_name || right.username}${right.email}`
          )
        ),
    [users]
  );
  const tabItems = useMemo<Array<{ key: CatalogTab; label: string }>>(() => {
    const items: Array<{ key: CatalogTab; label: string }> = [
      { key: "general", label: copy.catalog.generalTab },
      { key: "expiry", label: copy.catalog.expiryTab },
      { key: "stock", label: copy.catalog.stockTab },
      { key: "inventory", label: copy.catalog.inventoryTab },
    ];

    if (canManageUsers) {
      items.push(
        { key: "stores", label: copy.common.shops },
        { key: "users", label: copy.common.users },
        { key: "audit", label: copy.catalog.auditTab }
      );
    }

    return items;
  }, [
    canManageUsers,
    copy.catalog.expiryTab,
    copy.catalog.generalTab,
    copy.catalog.inventoryTab,
    copy.catalog.stockTab,
    copy.catalog.auditTab,
    copy.common.shops,
    copy.common.users,
  ]);

  function formatAdminOptionLabel(userAccount: UserAccount) {
    const displayName = (userAccount.display_name || userAccount.username).trim() || userAccount.username;
    const identityLabel = displayName === userAccount.username
      ? userAccount.username
      : `${displayName} (@${userAccount.username})`;

    return userAccount.email ? `${identityLabel} - ${userAccount.email}` : identityLabel;
  }

  const loadWorkspace = useCallback(async () => {
    const [nextProducts, nextExpiryAlerts, nextStores, nextInventories, nextUsers] = await Promise.all([
      fetchProducts(currentStoreId || undefined),
      fetchExpiryAlerts(currentStoreId || undefined),
      fetchStores(),
      canManageCatalog ? fetchInventories(currentStoreId || undefined) : Promise.resolve([]),
      canManageUsers ? fetchUsers() : Promise.resolve([]),
    ]);

    setProducts(nextProducts);
    setExpiryAlerts(nextExpiryAlerts);
    setStores(nextStores);
    setInventories(nextInventories);
    setUsers(nextUsers);
  }, [canManageCatalog, canManageUsers, currentStoreId]);

  useEffect(() => {
    loadWorkspace().catch((error) => {
      setFeedbackMessage(error instanceof Error ? error.message : "Unable to load catalog data.");
    });
  }, [loadWorkspace]);

  useEffect(() => {
    if (!canViewAudit || activeTab !== "audit") {
      return;
    }

    let cancelled = false;
    setIsLoadingAudit(true);

    fetchAuditEvents({
      eventType: auditTypeFilter,
      date: auditDateFilter || undefined,
      storeId: auditStoreFilter,
      search: auditSearch,
    })
      .then((nextAuditEvents) => {
        if (cancelled) {
          return;
        }

        setAuditEvents(nextAuditEvents);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setFeedbackMessage(error instanceof Error ? error.message : "Unable to load audit events.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingAudit(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, auditDateFilter, auditSearch, auditStoreFilter, auditTypeFilter, canViewAudit]);

  useEffect(() => {
    setProductDraft((currentValue) =>
      currentValue.store ? currentValue : { ...currentValue, store: currentStoreId || 0 }
    );
  }, [currentStoreId]);

  useEffect(() => {
    if (canManageUsers || !["stores", "users", "audit"].includes(activeTab)) {
      return;
    }

    setActiveTab("general");
  }, [activeTab, canManageUsers]);

  function updateProductDraftWithDerivedValues(overrides: Partial<ProductPayload>) {
    setProductDraft((currentValue) =>
      applyDerivedInitialUnits(
        applyDerivedProductPrices({ ...currentValue, ...overrides }, productPriceTouched)
      )
    );
  }

  function handleProductPackagingModeChange(nextMode: ProductPackagingMode) {
    setProductPackagingMode(nextMode);

    if (nextMode !== "package") {
      setProductPriceTouched((currentValue) => ({ ...currentValue, packagePrice: false }));
    }

    if (nextMode !== "box") {
      setProductPriceTouched((currentValue) => ({ ...currentValue, boxPrice: false }));
    }

    updateProductDraftWithDerivedValues({
      package_price: nextMode === "package" ? productDraft.package_price : "",
      units_per_package: nextMode === "package" ? productDraft.units_per_package : 0,
      initial_packages: nextMode === "package" ? productDraft.initial_packages : 0,
      box_price: nextMode === "box" ? productDraft.box_price : "",
      units_per_box: nextMode === "box" ? productDraft.units_per_box : 0,
      initial_boxes: nextMode === "box" ? productDraft.initial_boxes : 0,
    });
  }

  function closeModal() {
    setActiveModal(null);
    setEditingProductId(null);
    setProductBarcodeScannerOpen(false);
    setProductPackagingMode(emptyProductPackagingMode());
    setProductPriceTouched({
      packagePrice: false,
      boxPrice: false,
    });
    setProductImagePreview("");
    setEditingStoreId(null);
    setEditingUserId(null);
    setIsSaving(false);
  }

  async function handleSaveProduct() {
    setIsSaving(true);
    setFeedbackMessage("");

    try {
      if (editingProductId) {
        await updateProduct(editingProductId, productDraft);
      } else {
        await createProduct(productDraft);
      }
      setProductDraft(emptyProductDraft(currentStoreId));
      setProductPriceTouched({
        packagePrice: false,
        boxPrice: false,
      });
      setProductImagePreview("");
      closeModal();
      await loadWorkspace();
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "Unable to save product.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRestock() {
    setIsSaving(true);
    setFeedbackMessage("");

    try {
      await restockInventory(restockDraft);
      setRestockDraft(emptyRestockDraft());
      closeModal();
      await loadWorkspace();
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "Unable to restock inventory.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveStore() {
    setIsSaving(true);
    setFeedbackMessage("");

    try {
      if (editingStoreId) {
        await updateStore(editingStoreId, storeDraft);
      } else {
        await createStore(storeDraft);
      }
      setStoreDraft(emptyStoreDraft());
      closeModal();
      await loadWorkspace();
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "Unable to save shop.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveUser() {
    setIsSaving(true);
    setFeedbackMessage("");

    try {
      if (editingUserId) {
        await updateUser(editingUserId, userDraft);
      } else {
        await createUser(userDraft);
      }
      setUserDraft(emptyUserDraft());
      closeModal();
      await loadWorkspace();
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "Unable to save user.");
    } finally {
      setIsSaving(false);
    }
  }

  function openStoreEditor(store?: Store) {
    if (store) {
      setEditingStoreId(store.id);
      setStoreDraft({
        name: store.name,
        code: store.code,
        address: store.address || "",
        phone: store.phone || "",
        admin_user_id: store.admin_user?.id || null,
        is_active: store.is_active ?? true,
      });
    } else {
      setEditingStoreId(null);
      setStoreDraft(emptyStoreDraft());
    }
    setActiveModal("store");
  }

  function openProductEditor(product?: Product) {
    const resetTouchedState: ProductPriceTouchState = {
      packagePrice: false,
      boxPrice: false,
    };

    if (product) {
      setEditingProductId(product.id);
      setProductPriceTouched(resetTouchedState);
      setProductPackagingMode(resolveProductPackagingMode(product));
      setProductDraft(
        applyDerivedInitialUnits(
          applyDerivedProductPrices(
            {
              name: product.name,
              barcode: product.barcode,
              sku: product.sku || "",
              description: product.description || "",
              packaging_details: product.packaging_details || "",
              unit_price: product.unit_price,
              package_price: product.package_price || "",
              box_price: product.box_price || "",
              units_per_package: product.units_per_package,
              units_per_box: product.units_per_box,
              image: null,
              is_active: true,
              store: currentStoreId || 0,
              initial_units: 0,
              initial_packages: 0,
              initial_boxes: 0,
              initial_expiry_date: "",
              note: "",
            },
            resetTouchedState
          )
        )
      );
      setProductImagePreview(product.image || "");
    } else {
      setEditingProductId(null);
      setProductPriceTouched(resetTouchedState);
      setProductPackagingMode(emptyProductPackagingMode());
      setProductDraft(
        applyDerivedInitialUnits(
          applyDerivedProductPrices(emptyProductDraft(currentStoreId), resetTouchedState)
        )
      );
      setProductImagePreview("");
    }

    setActiveModal("product");
  }

  function handleProductImageChange(file: File | null) {
    setProductDraft((currentValue) => ({ ...currentValue, image: file }));

    if (!file) {
      setProductImagePreview(editingProductId ? productImagePreview : "");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setProductImagePreview(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(file);
  }

  function handleProductImageInput(
    event: React.ChangeEvent<HTMLInputElement>,
    source: "picker" | "camera"
  ) {
    handleProductImageChange(event.target.files?.[0] || null);

    if (source === "picker" && productImageInputRef.current) {
      productImageInputRef.current.value = "";
    }

    if (source === "camera" && productCameraInputRef.current) {
      productCameraInputRef.current.value = "";
    }
  }

  function openUserEditor(userAccount?: UserAccount) {
    if (userAccount) {
      setEditingUserId(userAccount.id);
      setUserDraft({
        username: userAccount.username,
        display_name: userAccount.display_name,
        email: userAccount.email,
        phone: userAccount.phone,
        password: "",
        role: userAccount.role,
        store: userAccount.store,
        assigned_stores: userAccount.assigned_stores,
        is_active: userAccount.is_active,
      });
    } else {
      setEditingUserId(null);
      setUserDraft(emptyUserDraft());
    }
    setActiveModal("user");
  }

  return (
    <div className="page-stack">
      <div className="catalog-tabs" role="tablist" aria-label={copy.catalog.sectionNavigation}>
        {tabItems.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={activeTab === item.key}
            className={`catalog-tabs__button ${activeTab === item.key ? "active" : ""}`}
            onClick={() => setActiveTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {feedbackMessage ? <p className="section-copy catalog-feedback">{feedbackMessage}</p> : null}

      {activeTab === "general" ? (
        <section className="surface-panel compact-hero">
          <div>
            <p className="eyebrow">{copy.catalog.heroEyebrow}</p>
            <h2>{copy.catalog.heroTitle}</h2>
          </div>
          <div className="metric-grid">
            <button
              type="button"
              className="metric-card metric-card--button tone-accent"
              onClick={() => setActiveTab("inventory")}
            >
              <span>{copy.catalog.products}</span>
              <strong>{visibleProducts.length}</strong>
            </button>
            <button
              type="button"
              className="metric-card metric-card--button tone-warm"
              onClick={() => setActiveTab("expiry")}
            >
              <span>{copy.catalog.expiryAlerts}</span>
              <strong>{visibleExpiryAlerts.length}</strong>
            </button>
            <button
              type="button"
              className="metric-card metric-card--button tone-cool"
              onClick={() => setActiveTab("stock")}
            >
              <span>{copy.catalog.lowStock}</span>
              <strong>{lowStockCount}</strong>
            </button>
            {canManageUsers ? (
              <button
                type="button"
                className="metric-card metric-card--button tone-accent"
                onClick={() => setActiveTab("stores")}
              >
                <span>{copy.common.shops}</span>
                <strong>{stores.length}</strong>
              </button>
            ) : null}
            {canManageUsers ? (
              <button
                type="button"
                className="metric-card metric-card--button tone-warm"
                onClick={() => setActiveTab("users")}
              >
                <span>{copy.common.users}</span>
                <strong>{users.length}</strong>
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTab === "expiry" ? (
        <section className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{copy.catalog.byExpiryDate}</p>
              <h2>{copy.catalog.orderedByClosestExpiry}</h2>
            </div>
          </div>

          <div className="stack-list">
            {productsByExpiry.length === 0 ? <p className="empty-state">{copy.catalog.noExpiry}</p> : null}
            {productsByExpiry.map((product) => (
              <article key={product.id} className="catalog-card">
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.packaging_details || product.barcode}</p>
                </div>
                <div className="catalog-card__meta">
                  <span className="status-pill tone-warning">
                    {copy.common.unitsCount(product.total_stock_units)}
                  </span>
                  <strong>{formatDate(product.nearest_expiry_date || "", language)}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "stock" ? (
        <section className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{copy.catalog.lowStock}</p>
              <h2>{copy.catalog.productsAndStock}</h2>
            </div>
            {canManageCatalog ? (
              <div className="catalog-actions">
                <button
                  type="button"
                  className="secondary-button catalog-actions__add"
                  onClick={() => {
                    openProductEditor();
                  }}
                >
                  {copy.catalog.openProductForm}
                </button>
              </div>
            ) : null}
          </div>

          <div className="stack-list">
            {stockInventories.length === 0 ? <p className="empty-state">{copy.catalog.noInventory}</p> : null}
            {stockInventories.map((inventory) => {
              const product = products.find((candidate) => candidate.id === inventory.product);

              return (
                <article key={inventory.id} className="catalog-card catalog-card--stock">
                  <div className="catalog-card__topline">
                    <div>
                      <h3>{inventory.product_name}</h3>
                      <p>{inventory.product_barcode}</p>
                    </div>
                    <strong className="catalog-card__price">
                      {formatCurrency(product?.unit_price || "0", language)}
                    </strong>
                  </div>
                  <div className="catalog-card__footer">
                    <span
                      className={`status-pill ${Number(inventory.available_units) > 20 ? "tone-positive" : "tone-warning"
                        }`}
                    >
                      {copy.common.unitsCount(inventory.available_units)}
                    </span>
                    {canManageCatalog ? (
                      <button
                        type="button"
                        className="ghost-button catalog-card__action"
                        onClick={() => {
                          setRestockDraft(emptyRestockDraft(inventory.id));
                          setActiveModal("restock");
                        }}
                      >
                        {copy.catalog.openRestockForm}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeTab === "inventory" ? (
        <section className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{copy.catalog.inventorySnapshots}</p>
              <h2>{copy.catalog.inventorySnapshots}</h2>
            </div>
          </div>

          <div className="stack-list">
            {sortedInventories.length === 0 ? <p className="empty-state">{copy.catalog.noInventory}</p> : null}
            {sortedInventories.map((inventory) => {
              const product = products.find((candidate) => candidate.id === inventory.product);

              return (
                <article key={inventory.id} className="catalog-card catalog-card--inventory">
                  <div className="catalog-card__content">
                    <div className="catalog-card__topline">
                      <h3>{inventory.product_name}</h3>
                      <strong className="catalog-card__stock-count">
                        {copy.common.unitsCount(inventory.available_units)}
                      </strong>
                    </div>
                    <p>{inventory.store_name}</p>
                    <div className="catalog-card__footer">
                      <span className="status-pill tone-neutral">{inventory.product_barcode}</span>
                      {canManageCatalog && product ? (
                        <button
                          type="button"
                          className="ghost-button catalog-card__action"
                          onClick={() => openProductEditor(product)}
                        >
                          {copy.profile.editShort}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeTab === "stores" && canManageUsers ? (
        <section className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{copy.common.shops}</p>
              <h2>{copy.catalog.shopDirectory}</h2>
            </div>
            <button
              type="button"
              className="secondary-button catalog-panel-action catalog-panel-action--shop"
              onClick={() => openStoreEditor()}
            >
              {copy.catalog.openShopForm}
            </button>
          </div>

          <div className="stack-list">
            {stores.length === 0 ? <p className="empty-state">{copy.catalog.noStores}</p> : null}
            {stores.map((store) => (
              <button
                key={store.id}
                type="button"
                className="catalog-card catalog-card--button"
                onClick={() => openStoreEditor(store)}
              >
                <div>
                  <h3>{store.name}</h3>
                  <p>{store.code} / {store.admin_user?.display_name || copy.catalog.noShopAdmin}</p>
                </div>
                <div className="catalog-card__meta">
                  <span className={`status-pill ${store.is_active ? "tone-positive" : "tone-warning"}`}>
                    {store.is_active ? copy.common.active : copy.common.inactive}
                  </span>
                  <strong>{store.phone || " "}</strong>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "users" && canManageUsers ? (
        <section className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{copy.common.users}</p>
              <h2>{copy.catalog.userDirectory}</h2>
            </div>
            <button type="button" className="secondary-button" onClick={() => openUserEditor()}>
              {copy.catalog.openUserForm}
            </button>
          </div>

          <div className="stack-list">
            {users.length === 0 ? <p className="empty-state">{copy.catalog.noUsers}</p> : null}
            {users.map((userAccount) => (
              <button
                key={userAccount.id}
                type="button"
                className="catalog-card catalog-card--button"
                onClick={() => openUserEditor(userAccount)}
              >
                <div>
                  <h3>{userAccount.display_name || userAccount.username}</h3>
                  <p>{userAccount.email}</p>
                </div>
                <div className="catalog-card__meta">
                  <span className="status-pill tone-neutral">{copy.roles[userAccount.role]}</span>
                  <strong>
                    {userAccount.assigned_store_details.map((store) => store.code).join(", ") || "-"}
                  </strong>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "audit" && canViewAudit ? (
        <section className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{copy.catalog.auditEyebrow}</p>
              <h2>{copy.catalog.auditTitle}</h2>
              <p className="section-copy">{copy.catalog.auditDescription}</p>
            </div>
          </div>

          <div className="field-grid catalog-audit-filters">
            <label className="field-stack">
              <span>{copy.catalog.auditType}</span>
              <select
                value={auditTypeFilter}
                onChange={(event) =>
                  setAuditTypeFilter(event.target.value as AuditEventType | "all")
                }
              >
                <option value="all">{copy.catalog.allAuditTypes}</option>
                <option value="create">{copy.catalog.actionCreate}</option>
                <option value="update">{copy.catalog.actionUpdate}</option>
                <option value="delete">{copy.catalog.actionDelete}</option>
                <option value="sell">{copy.catalog.actionSell}</option>
                <option value="restock">{copy.catalog.actionRestock}</option>
                <option value="regularize">{copy.catalog.actionRegularize}</option>
                <option value="reorder">{copy.catalog.actionReorder}</option>
                <option value="password">{copy.catalog.actionPassword}</option>
                <option value="login">{copy.catalog.actionLogin}</option>
              </select>
            </label>
            <label className="field-stack">
              <span>{copy.catalog.auditDate}</span>
              <input
                type="date"
                value={auditDateFilter}
                onChange={(event) => setAuditDateFilter(event.target.value)}
              />
            </label>
            <label className="field-stack">
              <span>{copy.common.store}</span>
              <select
                value={auditStoreFilter}
                onChange={(event) =>
                  setAuditStoreFilter(
                    event.target.value === "all" ? "all" : Number(event.target.value)
                  )
                }
              >
                <option value="all">{copy.profile.allStores}</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack catalog-audit-filters__search">
              <span>{copy.catalog.auditSearch}</span>
              <input
                value={auditSearch}
                placeholder={copy.catalog.auditSearchPlaceholder}
                onChange={(event) => setAuditSearch(event.target.value)}
              />
            </label>
          </div>

          <div className="stack-list">
            {isLoadingAudit ? <p className="empty-state">{copy.catalog.loadingAudit}</p> : null}
            {!isLoadingAudit && auditEvents.length === 0 ? (
              <p className="empty-state">{copy.catalog.noAuditEvents}</p>
            ) : null}
            {auditEvents.map((event) => (
              <article key={event.id} className="catalog-card catalog-card--audit">
                <div className="catalog-card__content">
                  <div className="catalog-card__topline">
                    <div>
                      <h3>{event.summary}</h3>
                      <p>
                        {copy.catalog.actor}: {event.actor_name || "-"} /{" "}
                        {event.actor_role && event.actor_role in copy.roles
                          ? copy.roles[event.actor_role as UserRole]
                          : event.actor_role || "-"}
                      </p>
                    </div>
                    <span className={`status-pill tone-${auditEventTone(event.event_type)}`}>
                      {auditEventLabel(copy, event.event_type)}
                    </span>
                  </div>
                  <div className="catalog-audit-meta">
                    <span>{formatAuditDateTime(event.created_at, language)}</span>
                    <span>
                      {copy.catalog.resource}: {event.resource_label || event.resource_type}
                    </span>
                    <span>{event.store_name || copy.profile.allStores}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <ManagementSheet
        open={activeModal === "product"}
        title={editingProductId ? copy.common.update : copy.catalog.openProductForm}
        eyebrow={copy.catalog.products}
        onClose={closeModal}
      >
        {productImagePreview ? (
          <div className="catalog-product-image-preview">
            <img src={productImagePreview} alt={productDraft.name || copy.catalog.productImage} />
          </div>
        ) : null}
        <div className="field-grid">
          <label className="field-stack">
            <span>{copy.common.name}</span>
            <input
              value={productDraft.name}
              onChange={(event) => setProductDraft((currentValue) => ({ ...currentValue, name: event.target.value }))}
            />
          </label>
          <label className="field-stack">
            <span>{copy.catalog.barcode}</span>
            <div className="catalog-barcode-field">
              <input
                value={productDraft.barcode}
                onChange={(event) =>
                  setProductDraft((currentValue) => ({ ...currentValue, barcode: event.target.value }))
                }
              />
              <button
                type="button"
                className="ghost-button catalog-barcode-field__action"
                onClick={() => setProductBarcodeScannerOpen(true)}
              >
                {copy.catalog.scanBarcode}
              </button>
            </div>
          </label>
          <label className="field-stack">
            <span>{copy.catalog.sku}</span>
            <input
              value={productDraft.sku}
              onChange={(event) => setProductDraft((currentValue) => ({ ...currentValue, sku: event.target.value }))}
            />
          </label>
          <label className="field-stack">
            <span>{copy.catalog.packagingDetails}</span>
            <input
              value={productDraft.packaging_details}
              onChange={(event) =>
                setProductDraft((currentValue) => ({
                  ...currentValue,
                  packaging_details: event.target.value,
                }))
              }
            />
          </label>
          <div className="field-stack catalog-packaging-flags">
            <span>{copy.catalog.packagingMode}</span>
            <select
              value={productPackagingMode}
              onChange={(event) =>
                handleProductPackagingModeChange(event.target.value as ProductPackagingMode)
              }
            >
              <option value="package">{copy.catalog.packageOption}</option>
              <option value="box">{copy.catalog.boxOption}</option>
            </select>
          </div>
          <label className="field-stack">
            <span>{copy.catalog.unitPrice}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={productDraft.unit_price}
              onChange={(event) => updateProductDraftWithDerivedValues({ unit_price: event.target.value })}
            />
          </label>
          {productPackagingMode === "package" ? (
            <>
              <label className="field-stack">
                <span>{copy.catalog.unitsPerPackage}</span>
                <input
                  type="number"
                  min="0"
                  value={productDraft.units_per_package || ""}
                  onChange={(event) =>
                    updateProductDraftWithDerivedValues({
                      units_per_package: Number(event.target.value) || 0,
                    })
                  }
                />
              </label>
              <label className="field-stack">
                <span>{copy.catalog.packagePrice}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productDraft.package_price}
                  onChange={(event) => {
                    setProductPriceTouched((currentValue) => ({
                      ...currentValue,
                      packagePrice: true,
                    }));
                    setProductDraft((currentValue) => ({
                      ...currentValue,
                      package_price: event.target.value,
                    }));
                  }}
                />
              </label>
            </>
          ) : null}
          {productPackagingMode === "box" ? (
            <>
              <label className="field-stack">
                <span>{copy.catalog.unitsPerBox}</span>
                <input
                  type="number"
                  min="0"
                  value={productDraft.units_per_box || ""}
                  onChange={(event) =>
                    updateProductDraftWithDerivedValues({
                      units_per_box: Number(event.target.value) || 0,
                    })
                  }
                />
              </label>
              <label className="field-stack">
                <span>{copy.catalog.boxPrice}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productDraft.box_price}
                  onChange={(event) => {
                    setProductPriceTouched((currentValue) => ({ ...currentValue, boxPrice: true }));
                    setProductDraft((currentValue) => ({ ...currentValue, box_price: event.target.value }));
                  }}
                />
              </label>
            </>
          ) : null}
          <label className="field-stack">
            <span>{copy.catalog.productImage}</span>
            <div className="catalog-image-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => productImageInputRef.current?.click()}
              >
                {copy.catalog.chooseImage}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => productCameraInputRef.current?.click()}
              >
                {copy.catalog.useCamera}
              </button>
            </div>
            <input
              ref={productImageInputRef}
              className="catalog-hidden-input"
              type="file"
              accept="image/*"
              onChange={(event) => handleProductImageInput(event, "picker")}
            />
            <input
              ref={productCameraInputRef}
              className="catalog-hidden-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => handleProductImageInput(event, "camera")}
            />
          </label>
          {!editingProductId ? (
            <>
              <label className="field-stack">
                <span>{copy.catalog.initialUnits}</span>
                <input
                  type="number"
                  min="0"
                  readOnly
                  value={productDraft.initial_units}
                />
              </label>
              <label className="field-stack">
                <span>{copy.common.store}</span>
                <select
                  value={productDraft.store}
                  onChange={(event) =>
                    setProductDraft((currentValue) => ({ ...currentValue, store: Number(event.target.value) }))
                  }
                >
                  <option value="0">-</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
              {productPackagingMode === "package" ? (
                <label className="field-stack">
                  <span>{copy.catalog.initialPackages}</span>
                  <input
                    type="number"
                    min="0"
                    value={productDraft.initial_packages}
                    onChange={(event) =>
                      updateProductDraftWithDerivedValues({
                        initial_packages: Number(event.target.value) || 0,
                      })
                    }
                  />
                </label>
              ) : null}
              {productPackagingMode === "box" ? (
                <label className="field-stack">
                  <span>{copy.catalog.initialBoxes}</span>
                  <input
                    type="number"
                    min="0"
                    value={productDraft.initial_boxes}
                    onChange={(event) =>
                      updateProductDraftWithDerivedValues({
                        initial_boxes: Number(event.target.value) || 0,
                      })
                    }
                  />
                </label>
              ) : null}
              <label className="field-stack">
                <span>{copy.catalog.expiryDate}</span>
                <input
                  type="date"
                  value={productDraft.initial_expiry_date}
                  onChange={(event) =>
                    setProductDraft((currentValue) => ({
                      ...currentValue,
                      initial_expiry_date: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          ) : null}
        </div>
        <label className="field-stack">
          <span>{copy.common.description}</span>
          <textarea
            rows={2}
            value={productDraft.description}
            onChange={(event) =>
              setProductDraft((currentValue) => ({ ...currentValue, description: event.target.value }))
            }
          />
        </label>
        <label className="field-stack">
          <span>{copy.common.notes}</span>
          <textarea
            rows={2}
            value={productDraft.note}
            onChange={(event) => setProductDraft((currentValue) => ({ ...currentValue, note: event.target.value }))}
          />
        </label>
        <div className="catalog-form-actions">
          <button type="button" className="ghost-button" onClick={closeModal}>
            {copy.common.cancel}
          </button>
          <button type="button" className="primary-button" disabled={isSaving} onClick={handleSaveProduct}>
            {editingProductId ? copy.common.update : copy.common.create}
          </button>
        </div>
      </ManagementSheet>

      <BarcodeCaptureSheet
        open={productBarcodeScannerOpen}
        eyebrow={copy.catalog.barcode}
        title={copy.catalog.scanBarcode}
        onClose={() => setProductBarcodeScannerOpen(false)}
        onDetected={(barcode) => {
          setProductDraft((currentValue) => ({ ...currentValue, barcode }));
          setProductBarcodeScannerOpen(false);
        }}
      />

      <ManagementSheet
        open={activeModal === "restock"}
        title={copy.catalog.openRestockForm}
        eyebrow={copy.catalog.inventorySnapshots}
        onClose={closeModal}
      >
        <div className="field-grid">
          <label className="field-stack">
            <span>{copy.catalog.selectInventory}</span>
            <select
              value={restockDraft.inventory}
              onChange={(event) =>
                setRestockDraft((currentValue) => ({ ...currentValue, inventory: Number(event.target.value) }))
              }
            >
              <option value="0">-</option>
              {sortedInventories.map((inventory) => (
                <option key={inventory.id} value={inventory.id}>
                  {inventory.product_name} / {inventory.store_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span>{copy.catalog.initialUnits}</span>
            <input
              type="number"
              min="0"
              value={restockDraft.units_added}
              onChange={(event) =>
                setRestockDraft((currentValue) => ({
                  ...currentValue,
                  units_added: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label className="field-stack">
            <span>{copy.catalog.initialPackages}</span>
            <input
              type="number"
              min="0"
              value={restockDraft.packages_added}
              onChange={(event) =>
                setRestockDraft((currentValue) => ({
                  ...currentValue,
                  packages_added: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label className="field-stack">
            <span>{copy.catalog.initialBoxes}</span>
            <input
              type="number"
              min="0"
              value={restockDraft.boxes_added}
              onChange={(event) =>
                setRestockDraft((currentValue) => ({
                  ...currentValue,
                  boxes_added: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label className="field-stack">
            <span>{copy.catalog.expiryDate}</span>
            <input
              type="date"
              value={restockDraft.expiry_date}
              onChange={(event) =>
                setRestockDraft((currentValue) => ({ ...currentValue, expiry_date: event.target.value }))
              }
            />
          </label>
        </div>
        <label className="field-stack">
          <span>{copy.common.notes}</span>
          <textarea
            rows={2}
            value={restockDraft.note}
            onChange={(event) => setRestockDraft((currentValue) => ({ ...currentValue, note: event.target.value }))}
          />
        </label>
        <div className="catalog-form-actions">
          <button type="button" className="ghost-button" onClick={closeModal}>
            {copy.common.cancel}
          </button>
          <button type="button" className="primary-button" disabled={isSaving} onClick={handleRestock}>
            {copy.common.create}
          </button>
        </div>
      </ManagementSheet>

      <ManagementSheet
        open={activeModal === "store"}
        title={editingStoreId ? copy.common.update : copy.catalog.openShopForm}
        eyebrow={copy.common.shops}
        onClose={closeModal}
      >
        <div className="field-grid">
          <label className="field-stack">
            <span>{copy.common.name}</span>
            <input
              value={storeDraft.name}
              onChange={(event) => setStoreDraft((currentValue) => ({ ...currentValue, name: event.target.value }))}
            />
          </label>
          <label className="field-stack">
            <span>{copy.common.code}</span>
            <input
              value={storeDraft.code}
              onChange={(event) => setStoreDraft((currentValue) => ({ ...currentValue, code: event.target.value }))}
            />
          </label>
          <label className="field-stack">
            <span>{copy.common.phone}</span>
            <input
              value={storeDraft.phone}
              onChange={(event) => setStoreDraft((currentValue) => ({ ...currentValue, phone: event.target.value }))}
            />
          </label>
          <label className="field-stack">
            <span>{copy.catalog.shopAdmin}</span>
            <select
              value={storeDraft.admin_user_id || ""}
              onChange={(event) =>
                setStoreDraft((currentValue) => ({
                  ...currentValue,
                  admin_user_id: event.target.value ? Number(event.target.value) : null,
                }))
              }
            >
              <option value="">
                {adminUsers.length ? copy.catalog.noShopAdmin : copy.catalog.noShopAdminsAvailable}
              </option>
              {adminUsers.map((userAccount) => (
                <option key={userAccount.id} value={userAccount.id}>
                  {formatAdminOptionLabel(userAccount)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span>{copy.common.address}</span>
            <input
              value={storeDraft.address}
              onChange={(event) =>
                setStoreDraft((currentValue) => ({ ...currentValue, address: event.target.value }))
              }
            />
          </label>
        </div>
        <p className="muted-text">{copy.catalog.shopAdminHint}</p>
        <label className="catalog-toggle">
          <input
            type="checkbox"
            checked={storeDraft.is_active ?? true}
            onChange={(event) =>
              setStoreDraft((currentValue) => ({ ...currentValue, is_active: event.target.checked }))
            }
          />
          <span>{copy.common.active}</span>
        </label>
        <div className="catalog-form-actions">
          <button type="button" className="ghost-button" onClick={closeModal}>
            {copy.common.cancel}
          </button>
          <button type="button" className="primary-button" disabled={isSaving} onClick={handleSaveStore}>
            {editingStoreId ? copy.common.update : copy.common.create}
          </button>
        </div>
      </ManagementSheet>

      <ManagementSheet
        open={activeModal === "user"}
        title={editingUserId ? copy.common.update : copy.catalog.openUserForm}
        eyebrow={copy.common.users}
        onClose={closeModal}
      >
        <div className="field-grid">
          <label className="field-stack">
            <span>{copy.common.userName}</span>
            <input
              value={userDraft.username}
              onChange={(event) => setUserDraft((currentValue) => ({ ...currentValue, username: event.target.value }))}
            />
          </label>
          <label className="field-stack">
            <span>{copy.common.name}</span>
            <input
              value={userDraft.display_name}
              onChange={(event) =>
                setUserDraft((currentValue) => ({ ...currentValue, display_name: event.target.value }))
              }
            />
          </label>
          <label className="field-stack">
            <span>{copy.common.email}</span>
            <input
              type="email"
              value={userDraft.email}
              onChange={(event) => setUserDraft((currentValue) => ({ ...currentValue, email: event.target.value }))}
            />
          </label>
          <label className="field-stack">
            <span>{copy.common.phone}</span>
            <input
              value={userDraft.phone}
              onChange={(event) => setUserDraft((currentValue) => ({ ...currentValue, phone: event.target.value }))}
            />
          </label>
          <label className="field-stack">
            <span>{copy.common.password}</span>
            <input
              type="password"
              value={userDraft.password}
              onChange={(event) =>
                setUserDraft((currentValue) => ({ ...currentValue, password: event.target.value }))
              }
            />
          </label>
          <label className="field-stack">
            <span>{copy.common.role}</span>
            <select
              value={userDraft.role}
              onChange={(event) =>
                setUserDraft((currentValue) => ({
                  ...currentValue,
                  role: event.target.value as UserRole,
                }))
              }
            >
              <option value="seller">{copy.roles.seller}</option>
              <option value="admin">{copy.roles.admin}</option>
              <option value="sysadmin">{copy.roles.sysadmin}</option>
            </select>
          </label>
          <label className="field-stack">
            <span>{copy.catalog.primaryShop}</span>
            <select
              value={userDraft.store || ""}
              onChange={(event) =>
                setUserDraft((currentValue) => ({
                  ...currentValue,
                  store: event.target.value ? Number(event.target.value) : null,
                }))
              }
            >
              <option value="">-</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-stack">
          <span>{copy.catalog.assignedShops}</span>
          <div className="catalog-checkbox-grid">
            {stores.map((store) => {
              const assignedStoreIds = userDraft.assigned_stores || [];
              const checked = assignedStoreIds.includes(store.id);
              return (
                <label key={store.id} className="catalog-checkbox">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      setUserDraft((currentValue) => {
                        const nextAssignedStores = new Set(currentValue.assigned_stores || []);
                        if (event.target.checked) {
                          nextAssignedStores.add(store.id);
                        } else {
                          nextAssignedStores.delete(store.id);
                        }
                        return {
                          ...currentValue,
                          assigned_stores: Array.from(nextAssignedStores),
                        };
                      })
                    }
                  />
                  <span>
                    {store.name} ({store.code})
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <label className="catalog-toggle">
          <input
            type="checkbox"
            checked={userDraft.is_active ?? true}
            onChange={(event) =>
              setUserDraft((currentValue) => ({ ...currentValue, is_active: event.target.checked }))
            }
          />
          <span>{copy.common.active}</span>
        </label>
        <p className="muted-text">{copy.catalog.passwordHint}</p>
        <div className="catalog-form-actions">
          <button type="button" className="ghost-button" onClick={closeModal}>
            {copy.common.cancel}
          </button>
          <button type="button" className="primary-button" disabled={isSaving} onClick={handleSaveUser}>
            {editingUserId ? copy.common.update : copy.common.create}
          </button>
        </div>
      </ManagementSheet>
    </div>
  );
}
