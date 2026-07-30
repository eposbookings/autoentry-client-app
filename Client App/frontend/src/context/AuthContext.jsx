import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setAuthToken, formatApiError } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = none, object = user
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/auth/me");
        if (alive) setUser(data);
      } catch (e) {
        if (alive) setUser(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const login = useCallback(async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setAuthToken(data.access_token);
      setUser(data.user);
      return data.user;
    } catch (e) {
      const msg = formatApiError(e);
      console.error("Login failed:", msg);
      setError(msg);
      throw new Error(msg);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      console.error("Logout request failed (continuing client-side):", formatApiError(e));
    }
    setAuthToken(null);
    setUser(false);
  }, []);

  const value = useMemo(
    () => ({ user, login, logout, error, setError }),
    [user, login, logout, error]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
