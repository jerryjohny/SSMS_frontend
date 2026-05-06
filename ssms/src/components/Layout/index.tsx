import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../../authContext";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { useI18n } from "../../i18nContext";
import {
  clearQueueSyncEvents,
  fetchQueueSyncEvents,
  fetchQueuedSales,
  OPEN_QUEUE_SHEET_EVENT_NAME,
  removeQueuedSale,
  retryQueuedSales,
  subscribeToOutbox,
} from "../../utils/api";
import { PageKey, QueueSyncEvent, QueuedSale } from "../../utils/types";
import "./styles.css";

interface LayoutProps {
  activePage: PageKey;
  onChangePage: (page: PageKey) => void;
  children: ReactNode;
}

type SettingsSheet = "profile" | "shop" | "language" | null;

function createProfileDraft(userName: string, user: { email?: string; phone?: string } | null) {
  return {
    display_name: userName,
    email: user?.email || "",
    phone: user?.phone || "",
    current_password: "",
    new_password: "",
    confirm_new_password: "",
  };
}

function formatDateTime(value: string, locale: string): string {
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

export default function Layout({ activePage, onChangePage, children }: LayoutProps) {
  const isOnline = useOfflineStatus();
  const { language, copy, locale, setLanguage } = useI18n();
  const {
    availableStores,
    currentStore,
    currentStoreId,
    role,
    shopName,
    tenantName,
    tenantSlug,
    updateProfile,
    setCurrentStoreId,
    logout,
    user,
    userName,
  } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState<SettingsSheet | "queue">(null);
  const [profileDraft, setProfileDraft] = useState(() => createProfileDraft(userName, user));
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [queuedSales, setQueuedSales] = useState<QueuedSale[]>(() => fetchQueuedSales());
  const [queueSyncEvents, setQueueSyncEvents] = useState<QueueSyncEvent[]>(() => fetchQueueSyncEvents());
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const isSyncingQueueRef = useRef(false);
  const [queueNotice, setQueueNotice] = useState<{ tone: "default" | "error"; text: string }>({
    tone: "default",
    text: "",
  });

  const navItems: Array<{ key: PageKey; label: string }> = [
    { key: "home", label: copy.nav.home },
    { key: "pending", label: copy.nav.pending },
    { key: "catalog", label: copy.nav.catalog },
  ];

  useEffect(() => {
    if (activeSheet === "profile") {
      setProfileDraft(createProfileDraft(userName, user));
      setProfileError("");
    }
  }, [activeSheet, user, userName]);

  useEffect(() => {
    function refreshQueueState() {
      setQueuedSales(fetchQueuedSales());
      setQueueSyncEvents(fetchQueueSyncEvents());
    }

    refreshQueueState();
    return subscribeToOutbox(refreshQueueState);
  }, []);

  useEffect(() => {
    function handleOpenQueueSheet() {
      setMenuOpen(false);
      setActiveSheet("queue");
    }

    window.addEventListener(OPEN_QUEUE_SHEET_EVENT_NAME, handleOpenQueueSheet);
    return () => {
      window.removeEventListener(OPEN_QUEUE_SHEET_EVENT_NAME, handleOpenQueueSheet);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen && !activeSheet) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setMenuOpen(false);
      setActiveSheet(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeSheet, menuOpen]);

  useEffect(() => {
    isSyncingQueueRef.current = isSyncingQueue;
  }, [isSyncingQueue]);

  function openSheet(sheetName: Exclude<SettingsSheet, null>) {
    setMenuOpen(false);
    setActiveSheet(sheetName);
  }

  function closeSheet() {
    setActiveSheet(null);
  }

  async function saveProfile() {
    setIsSavingProfile(true);
    setProfileError("");

    try {
      const passwordChangeRequested =
        Boolean(profileDraft.current_password) ||
        Boolean(profileDraft.new_password) ||
        Boolean(profileDraft.confirm_new_password);
      const payload = {
        display_name: profileDraft.display_name,
        email: profileDraft.email,
        phone: profileDraft.phone,
        ...(passwordChangeRequested
          ? {
              current_password: profileDraft.current_password,
              new_password: profileDraft.new_password,
              confirm_new_password: profileDraft.confirm_new_password,
            }
          : {}),
      };
      await updateProfile(payload);
      closeSheet();
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : copy.header.profileSaveError
      );
    } finally {
      setIsSavingProfile(false);
    }
  }

  function queueStatusTone(status: QueuedSale["status"]) {
    if (status === "failed") {
      return "danger";
    }
    return "neutral";
  }

  function queueStatusLabel(status: QueuedSale["status"]) {
    if (status === "syncing") {
      return copy.common.syncing;
    }
    if (status === "failed") {
      return copy.common.failed;
    }
    return copy.common.queued;
  }

  function queueEventTone(status: QueueSyncEvent["status"]) {
    return status === "synced" ? "positive" : "danger";
  }

  function queueEventLabel(status: QueueSyncEvent["status"]) {
    return status === "synced" ? copy.common.synced : copy.common.failed;
  }

  function resolveStoreName(storeId: number) {
    return availableStores.find((store) => store.id === storeId)?.name || `${copy.common.store} ${storeId}`;
  }

  const syncQueuedSales = useCallback(async (targetIds?: string[]) => {
    if (isSyncingQueueRef.current || (!targetIds && !fetchQueuedSales().length)) {
      return;
    }

    setIsSyncingQueue(true);
    setQueueNotice({ tone: "default", text: copy.header.queueSyncing });

    try {
      const summary = await retryQueuedSales(targetIds);
      const messageParts = [
        summary.synced ? copy.header.queueSynced(summary.synced) : "",
        summary.failed ? copy.header.queueFailed(summary.failed) : "",
        summary.remaining ? copy.header.queueRemaining(summary.remaining) : "",
      ].filter(Boolean);

      setQueueNotice({
        tone: summary.failed ? "error" : "default",
        text: messageParts.join(" ").trim() || copy.header.queueEmpty,
      });
    } finally {
      setIsSyncingQueue(false);
    }
  }, [copy.header]);

  useEffect(() => {
    if (!isOnline || !queuedSales.length) {
      return;
    }

    function attemptAutoSync() {
      if (isSyncingQueueRef.current || !fetchQueuedSales().length) {
        return;
      }

      syncQueuedSales().catch(() => {
        return;
      });
    }

    attemptAutoSync();
    const syncTimer = window.setInterval(attemptAutoSync, 30000);

    return () => {
      window.clearInterval(syncTimer);
    };
  }, [isOnline, queuedSales.length, syncQueuedSales]);

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="app-header">
        <div>
          <p className="eyebrow">{copy.header.eyebrow}</p>
          <h1>SSMS</h1>
          <p className="app-subtitle">
            {tenantName} / {shopName || tenantSlug} / {copy.roles[role]}
          </p>
        </div>

        <div className="header-actions">
          <div className={`network-chip ${isOnline ? "online" : "offline"}`}>
            {isOnline ? copy.header.online : copy.header.offline}
          </div>

          <div className="header-menu">
            <button
              type="button"
              className="menu-trigger"
              aria-label={copy.header.menuLabel}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((currentValue) => !currentValue)}
            >
              <span className="menu-trigger__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>

            {menuOpen ? (
              <>
                <button
                  type="button"
                  className="header-menu__scrim"
                  aria-label={copy.common.close}
                  onClick={() => setMenuOpen(false)}
                />
                <div className="header-menu__dropdown" role="menu">
                  <button
                    type="button"
                    className="header-menu__item"
                    role="menuitem"
                    onClick={() => openSheet("profile")}
                  >
                    {copy.header.profile}
                  </button>
                  <button
                    type="button"
                    className="header-menu__item"
                    role="menuitem"
                    onClick={() => openSheet("shop")}
                  >
                    {copy.header.shopSettings}
                  </button>
                  <button
                    type="button"
                    className="header-menu__item"
                    role="menuitem"
                    onClick={() => openSheet("language")}
                  >
                    {copy.header.languageSettings}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="app-main">{children}</main>

      {activeSheet ? (
        <div
          className="settings-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              closeSheet();
            }
          }}
        >
          <section className="settings-sheet surface-panel">
            <div className="settings-sheet__header">
              <div>
                <p className="eyebrow">
                  {activeSheet === "profile"
                    ? copy.header.profile
                    : activeSheet === "shop"
                    ? copy.header.shopSettings
                    : activeSheet === "language"
                    ? copy.header.languageSettings
                    : copy.header.offlineQueue}
                </p>
                <h2>
                  {activeSheet === "profile"
                    ? copy.header.profile
                    : activeSheet === "shop"
                    ? copy.header.shopSettings
                    : activeSheet === "language"
                    ? copy.header.languageSettings
                    : copy.header.offlineQueue}
                </h2>
              </div>
              <button type="button" className="ghost-button" onClick={closeSheet}>
                {copy.common.close}
              </button>
            </div>

            {activeSheet === "profile" ? (
              <>
                <p className="settings-note">{copy.header.profileDescription}</p>
                <div className="settings-grid">
                  <label className="field-stack">
                    <span>{copy.common.userName}</span>
                    <input
                      value={profileDraft.display_name}
                      onChange={(event) =>
                        setProfileDraft((currentValue) => ({
                          ...currentValue,
                          display_name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field-stack">
                    <span>{copy.common.email}</span>
                    <input
                      type="email"
                      value={profileDraft.email}
                      onChange={(event) =>
                        setProfileDraft((currentValue) => ({
                          ...currentValue,
                          email: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field-stack">
                    <span>{copy.common.phone}</span>
                    <input
                      value={profileDraft.phone}
                      onChange={(event) =>
                        setProfileDraft((currentValue) => ({
                          ...currentValue,
                          phone: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field-stack">
                    <span>{copy.common.currentRole}</span>
                    <div className="settings-static-field settings-static-field--role">
                      <span className="status-pill tone-neutral">{copy.roles[role]}</span>
                    </div>
                  </label>
                </div>
                <div className="settings-section">
                  <div className="settings-section__header">
                    <h3 className="settings-section__title">{copy.header.passwordSectionTitle}</h3>
                    <p className="settings-note">{copy.header.passwordSectionDescription}</p>
                  </div>
                  <div className="settings-grid">
                    <label className="field-stack">
                      <span>{copy.common.currentPassword}</span>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={profileDraft.current_password}
                        onChange={(event) =>
                          setProfileDraft((currentValue) => ({
                            ...currentValue,
                            current_password: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field-stack">
                      <span>{copy.common.newPassword}</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={profileDraft.new_password}
                        onChange={(event) =>
                          setProfileDraft((currentValue) => ({
                            ...currentValue,
                            new_password: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field-stack">
                      <span>{copy.common.confirmNewPassword}</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={profileDraft.confirm_new_password}
                        onChange={(event) =>
                          setProfileDraft((currentValue) => ({
                            ...currentValue,
                            confirm_new_password: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
                {profileError ? <p className="settings-note settings-note--error">{profileError}</p> : null}
                <div className="settings-actions settings-actions--spread">
                  <button type="button" className="ghost-button" onClick={logout}>
                    {copy.common.logout}
                  </button>
                  <button type="button" className="primary-button" disabled={isSavingProfile} onClick={saveProfile}>
                    {copy.common.save}
                  </button>
                </div>
              </>
            ) : null}

            {activeSheet === "shop" ? (
              <>
                <p className="settings-note">{copy.header.shopDescription}</p>
                <div className="settings-grid">
                  <label className="field-stack">
                    <span>{copy.common.currentShop}</span>
                    <select
                      value={currentStoreId || ""}
                      onChange={(event) => setCurrentStoreId(Number(event.target.value))}
                    >
                      {availableStores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-stack">
                    <span>{copy.common.tenantName}</span>
                    <input value={tenantName} readOnly />
                  </label>
                  <label className="field-stack">
                    <span>{copy.common.tenantSlug}</span>
                    <input value={tenantSlug} readOnly />
                  </label>
                  <label className="field-stack">
                    <span>{copy.common.shopName}</span>
                    <input value={currentStore?.name || ""} readOnly />
                  </label>
                  <label className="field-stack">
                    <span>{copy.common.shopCode}</span>
                    <input value={currentStore?.code || ""} readOnly />
                  </label>
                  <label className="field-stack">
                    <span>{copy.common.phone}</span>
                    <input value={currentStore?.phone || ""} readOnly />
                  </label>
                  <label className="field-stack">
                    <span>{copy.common.address}</span>
                    <input value={currentStore?.address || ""} readOnly />
                  </label>
                </div>
              </>
            ) : null}

            {activeSheet === "language" ? (
              <>
                <p className="settings-note">{copy.header.languageDescription}</p>
                <div className="language-choice-list">
                  <button
                    type="button"
                    className={`language-choice ${language === "en" ? "active" : ""}`}
                    onClick={() => setLanguage("en")}
                  >
                    {copy.common.english}
                  </button>
                  <button
                    type="button"
                    className={`language-choice ${language === "pt" ? "active" : ""}`}
                    onClick={() => setLanguage("pt")}
                  >
                    {copy.common.portuguese}
                  </button>
                </div>
              </>
            ) : null}

            {activeSheet === "queue" ? (
              <>
                <p className="settings-note">{copy.header.queueDescription}</p>
                {queueNotice.text ? (
                  <p className={`settings-note ${queueNotice.tone === "error" ? "settings-note--error" : ""}`}>
                    {queueNotice.text}
                  </p>
                ) : null}

                <div className="settings-actions settings-actions--spread">
                  <span className="settings-note">{copy.common.saleCount(queuedSales.length)}</span>
                  <div className="settings-queue-toolbar">
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={!queueSyncEvents.length}
                      onClick={() => clearQueueSyncEvents()}
                    >
                      {copy.common.clearHistory}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!isOnline || !queuedSales.length || isSyncingQueue}
                      onClick={() => syncQueuedSales()}
                    >
                      {isSyncingQueue ? copy.header.queueSyncing : copy.common.retryAll}
                    </button>
                  </div>
                </div>

                <div className="settings-queue-section">
                  {queuedSales.length === 0 ? <p className="settings-note">{copy.header.queueEmpty}</p> : null}
                  {queuedSales.map((queuedSale) => (
                    <article key={queuedSale.id} className="settings-queue-card">
                      <div className="settings-queue-card__header">
                        <div>
                          <h3>{queuedSale.payload.customer?.name?.trim() || copy.pending.walkInCustomer}</h3>
                          <p>
                            {copy.profile.itemCount(queuedSale.payload.items.length)} /{" "}
                            {resolveStoreName(queuedSale.payload.store)}
                          </p>
                        </div>
                        <span className={`status-pill tone-${queueStatusTone(queuedSale.status)}`}>
                          {queueStatusLabel(queuedSale.status)}
                        </span>
                      </div>
                      <p>
                        {copy.common.queuedAt}: {formatDateTime(queuedSale.queuedAt, locale)}
                      </p>
                      <p>
                        {copy.common.lastAttempt}:{" "}
                        {queuedSale.lastAttemptAt
                          ? formatDateTime(queuedSale.lastAttemptAt, locale)
                          : copy.header.queueHistoryEmpty}
                      </p>
                      {queuedSale.lastError ? (
                        <p className="settings-note settings-note--error">{queuedSale.lastError}</p>
                      ) : null}
                      <div className="settings-queue-toolbar">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => removeQueuedSale(queuedSale.id)}
                        >
                          {copy.common.remove}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!isOnline || isSyncingQueue}
                          onClick={() => syncQueuedSales([queuedSale.id])}
                        >
                          {copy.common.retry}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="settings-queue-section">
                  <h3 className="settings-queue-title">{copy.header.queueHistory}</h3>
                  {queueSyncEvents.length === 0 ? <p className="settings-note">{copy.header.queueHistoryEmpty}</p> : null}
                  {queueSyncEvents.map((event) => (
                    <article key={event.id} className="settings-queue-card">
                      <div className="settings-queue-card__header">
                        <div>
                          <h3>{event.customerName || copy.pending.walkInCustomer}</h3>
                          <p>
                            {copy.profile.itemCount(event.itemCount)} / {resolveStoreName(event.storeId)}
                          </p>
                        </div>
                        <span className={`status-pill tone-${queueEventTone(event.status)}`}>
                          {queueEventLabel(event.status)}
                        </span>
                      </div>
                      <p>
                        {event.status === "synced" ? copy.common.syncedAt : copy.common.lastAttempt}:{" "}
                        {formatDateTime(event.processedAt, locale)}
                      </p>
                      {event.message ? <p>{event.message}</p> : null}
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      <nav className="bottom-nav" aria-label={copy.common.primaryNavigation}>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav__link ${activePage === item.key ? "active" : ""}`}
            onClick={() => onChangePage(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
