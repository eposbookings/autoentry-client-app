import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setAuthToken, formatApiError } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = none, object = user
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/auth/me");
        setUser(data);
      } catch (_) {
        setUser(false);
      }
    })();
  }, []);

  async function login(email, password) {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setAuthToken(data.access_token);
      setUser(data.user);
      return data.user;
    } catch (e) {
      const msg = formatApiError(e);
      setError(msg);
      throw new Error(msg);
    }
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch (_) {}
    setAuthToken(null);
    setUser(false);
  }

  return (
    <AuthCtx.Provider value={{ user, login, logout, error, setError }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
