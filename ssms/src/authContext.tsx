import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  fetchAuthSession,
  login as loginRequest,
  loginWithGoogle as loginWithGoogleRequest,
  logout as clearAuthState,
  readStoredAccessToken,
  readStoredCurrentStoreId,
  updateSessionProfile,
  writeStoredCurrentStoreId,
} from "./utils/api";
import { AuthUser, SessionProfilePayload, Store, UserRole } from "./utils/types";

interface AuthContextValue {
  currentStoreId: number | null;
  currentStore: Store | null;
  availableStores: Store[];
  isAuthenticated: boolean;
  isReady: boolean;
  role: UserRole;
  shopName: string;
  tenantName: string;
  tenantSlug: string;
  user: AuthUser | null;
  userName: string;
  login: (identifier: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  setCurrentStoreId: (storeId: number) => void;
  updateProfile: (payload: SessionProfilePayload) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  currentStoreId: null,
  currentStore: null,
  availableStores: [],
  isAuthenticated: false,
  isReady: false,
  role: "seller",
  shopName: "",
  tenantName: "",
  tenantSlug: "",
  user: null,
  userName: "",
  login: async () => {
    return;
  },
  loginWithGoogle: async () => {
    return;
  },
  logout: () => {
    return;
  },
  refreshSession: async () => {
    return;
  },
  setCurrentStoreId: () => {
    return;
  },
  updateProfile: async () => {
    return;
  },
});

function resolveAvailableStores(user: AuthUser | null): Store[] {
  if (!user) {
    return [];
  }

  if (user.assigned_stores.length) {
    return user.assigned_stores;
  }

  return user.store ? [user.store] : [];
}

function resolveCurrentStore(user: AuthUser | null, currentStoreId: number | null): Store | null {
  if (!user) {
    return null;
  }

  const availableStores = resolveAvailableStores(user);
  return (
    availableStores.find((store) => store.id === currentStoreId) ||
    user.store ||
    availableStores[0] ||
    null
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [currentStoreId, setCurrentStoreIdState] = useState<number | null>(() => readStoredCurrentStoreId());

  const refreshSession: AuthContextValue["refreshSession"] = useCallback(async () => {
    const nextUser = await fetchAuthSession();
    const availableStores = resolveAvailableStores(nextUser);
    const fallbackStoreId = nextUser.store?.id || availableStores[0]?.id || null;
    const storedStoreId = readStoredCurrentStoreId();
    const resolvedStoreId =
      availableStores.find((store) => store.id === storedStoreId)?.id || fallbackStoreId;

    setUser(nextUser);
    setCurrentStoreIdState(resolvedStoreId);
    writeStoredCurrentStoreId(resolvedStoreId);
  }, []);

  useEffect(() => {
    async function bootstrap() {
      const accessToken = readStoredAccessToken();
      if (!accessToken) {
        setIsReady(true);
        return;
      }

      try {
        await refreshSession();
      } catch {
        clearAuthState();
        setUser(null);
        setCurrentStoreIdState(null);
        writeStoredCurrentStoreId(null);
      } finally {
        setIsReady(true);
      }
    }

    bootstrap();
  }, [refreshSession]);

  const availableStores = useMemo(() => resolveAvailableStores(user), [user]);
  const currentStore = useMemo(
    () => resolveCurrentStore(user, currentStoreId),
    [currentStoreId, user]
  );

  useEffect(() => {
    if (currentStore) {
      writeStoredCurrentStoreId(currentStore.id);
      return;
    }

    if (!availableStores.length) {
      writeStoredCurrentStoreId(null);
    }
  }, [availableStores.length, currentStore]);

  const login: AuthContextValue["login"] = useCallback(async (identifier: string, password: string) => {
    const response = await loginRequest(identifier, password);
    setUser(response.user);
    const nextStoreId = response.user.store?.id || response.user.assigned_stores[0]?.id || null;
    setCurrentStoreIdState(nextStoreId);
    writeStoredCurrentStoreId(nextStoreId);
  }, []);

  const loginWithGoogle: AuthContextValue["loginWithGoogle"] = useCallback(async (credential: string) => {
    const response = await loginWithGoogleRequest(credential);
    setUser(response.user);
    const nextStoreId = response.user.store?.id || response.user.assigned_stores[0]?.id || null;
    setCurrentStoreIdState(nextStoreId);
    writeStoredCurrentStoreId(nextStoreId);
  }, []);

  const logout: AuthContextValue["logout"] = useCallback(() => {
    clearAuthState();
    setUser(null);
    setCurrentStoreIdState(null);
    writeStoredCurrentStoreId(null);
  }, []);

  const handleCurrentStoreChange: AuthContextValue["setCurrentStoreId"] = useCallback((storeId: number) => {
    const nextStore = availableStores.find((store) => store.id === storeId);
    const nextStoreId = nextStore?.id || currentStore?.id || null;
    setCurrentStoreIdState(nextStoreId);
    writeStoredCurrentStoreId(nextStoreId);
  }, [availableStores, currentStore]);

  const updateProfile: AuthContextValue["updateProfile"] = useCallback(async (payload: SessionProfilePayload) => {
    const nextUser = await updateSessionProfile(payload);
    setUser(nextUser);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentStoreId: currentStore?.id || null,
      currentStore,
      availableStores,
      isAuthenticated: Boolean(user),
      isReady,
      role: user?.role || "seller",
      shopName: currentStore?.name || "",
      tenantName: user?.tenant?.name || "",
      tenantSlug: user?.tenant?.slug || "",
      user,
      userName: user?.display_name || "",
      login,
      loginWithGoogle,
      logout,
      refreshSession,
      setCurrentStoreId: handleCurrentStoreChange,
      updateProfile,
    }),
    [
      availableStores,
      currentStore,
      handleCurrentStoreChange,
      isReady,
      login,
      loginWithGoogle,
      logout,
      refreshSession,
      updateProfile,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
