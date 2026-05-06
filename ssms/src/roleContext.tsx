import { ReactNode, createContext, useContext, useMemo, useState } from "react";

import { UserRole } from "./utils/types";

interface RoleContextValue {
  role: UserRole;
  setRole: (role: UserRole) => void;
}

const RoleContext = createContext<RoleContextValue>({
  role: "seller",
  setRole: () => {
    return;
  },
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<UserRole>("seller");

  const value = useMemo<RoleContextValue>(() => ({ role, setRole }), [role]);
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}
