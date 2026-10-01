import { createContext, useContext, useEffect, useState } from "react";
import {
  createD9Client,
  commands,
  type D9Client,
  type CoreSchema,
  type DirectusUser,
  type AuthenticationData,
} from "@/compat9";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { applyInitialDeepLinkFromUrl } from "@/state/linking/deepLinks";
import { LocalStorageKeys } from "@/state/local/useLocalStorage";
import {
  clearSessionStorage,
  readSessionWrapper,
  writeSessionWrapper,
  type DirectusSessionWrapper,
} from "@/state/auth/directusSessionStorage";
import {
  readActiveSessionId,
  resolveActiveSessionContext,
} from "@/state/auth/resolveActiveSession";

export interface PolicyGlobals {
  app_access: boolean;
  admin_access: boolean;
  enforce_tfa: boolean;
}

export type RefreshSessionTarget = { url: string; sessionId: string };

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: DirectusUser | null;
  policyGlobals: PolicyGlobals | null;
  directus: D9Client | null;
  login: (
    email: string,
    password: string,
    apiUrl: string,
    sessionId: string,
    apiId: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  token: string | null;
  setApiKey: (
    apiKey: string,
    apiUrl: string,
    sessionId: string,
    apiId: string,
  ) => Promise<void>;
  refreshSession: (
    override?: RefreshSessionTarget,
  ) => Promise<{ ok: boolean; authType?: "email" | "apiKey" }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PLACEHOLDER_URL = "https://directus.invalid";
const PLACEHOLDER_SESSION_ID = "__bootstrap__";
const PLACEHOLDER_API_ID = "";

function getUserLabel(me: DirectusUser): string | undefined {
  const first = String((me as { first_name?: unknown }).first_name ?? "").trim();
  const last = String((me as { last_name?: unknown }).last_name ?? "").trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const email = String((me as { email?: unknown }).email ?? "").trim();
  if (email) return email;
  return undefined;
}

/** D9 doesn't have /permissions/me – we derive policy info from /users/me (the current user's role). */
async function derivePolicyGlobalsFromUser(
  client: D9Client,
  userId?: string,
): Promise<PolicyGlobals | null> {
  try {
    const me = await client.request<Record<string, any>>(commands.readMe());
    // D9 users have a `role` field which contains the role UUID.
    // Fetch the role to get admin_access / app_access / enforce_tfa.
    const roleId = me?.role;
    if (roleId) {
      const role = await client.request<Record<string, any>>(commands.readRole(roleId));
      if (role && typeof role.admin_access === "boolean") {
        return {
          app_access: role.app_access === true,
          admin_access: role.admin_access === true,
          enforce_tfa: role.enforce_tfa === true,
        };
      }
    }
    // Fallback: deduce from me fields if role not fetchable
    return {
      app_access: (me as any)?.app_access !== false,
      admin_access: (me as any)?.admin_access === true,
      enforce_tfa: false,
    };
  } catch {
    return null;
  }
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [directus, setDirectus] = useState<D9Client | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<DirectusUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [policyGlobals, setPolicyGlobals] = useState<PolicyGlobals | null>(null);

  const fetchAndSetPolicyGlobals = async (client: D9Client, userId?: string) => {
    const pg = await derivePolicyGlobalsFromUser(client, userId);
    setPolicyGlobals(pg);
  };

  const logoutFrom401 = async () => {
    try {
      const sid = await readActiveSessionId();
      if (sid) {
        await clearSessionStorage(sid);
        await AsyncStorage.removeItem(
          LocalStorageKeys.DIRECTUS_ACTIVE_SESSION_ID,
        );
      }
      setIsAuthenticated(false);
      setToken(null);
      setUser(null);
      setPolicyGlobals(null);
      setDirectus(null);
      router.push("/login");
    } catch {
      /* ignore */
    }
  };

  function createD9ClientForStorage(
    url: string,
    sessionId: string,
    apiId: string,
  ): D9Client {
    return createD9Client(url, {
      get: async () => {
        try {
          const w = await readSessionWrapper(sessionId);
          if (!w?.sdk) return null;
          return {
            accessToken: w.sdk.access_token,
            refreshToken: w.sdk.refresh_token,
            expires: w.sdk.expires,
          };
        } catch {
          return null;
        }
      },
      set: async (value) => {
        const prev = await readSessionWrapper(sessionId);
        const next: DirectusSessionWrapper = {
          apiId: apiId || prev?.apiId || "",
          authType: "email",
          sdk: value ? {
            access_token: value.accessToken ?? "",
            refresh_token: value.refreshToken ?? "",
            expires: value.expires ?? 0,
          } : null,
          apiKey: prev?.apiKey ?? null,
          userLabel: prev?.userLabel,
          instanceUrl: prev?.instanceUrl ?? url,
        };
        await writeSessionWrapper(sessionId, next);
      },
      clear: async () => {
        // Auth is cleared through normal session wrapper updates
        const prev = await readSessionWrapper(sessionId);
        if (prev) {
          await writeSessionWrapper(sessionId, {
            ...prev,
            sdk: null,
          });
        }
      },
    });
  }

  useEffect(() => {
    initializeDirectus();
  }, []);

  const initializeDirectus = async () => {
    try {
      await applyInitialDeepLinkFromUrl(await Linking.getInitialURL());
      const ctx = await resolveActiveSessionContext();
      if (!ctx) {
        setIsLoading(false);
        return;
      }

      const { sessionId, api, wrapper } = ctx;
      const url = api.url;
      const apiId = api.id ?? wrapper.apiId;
      const authType = wrapper.authType;

      switch (authType) {
        case "email":
          try {
            const client = createD9ClientForStorage(url, sessionId, apiId);
            setDirectus(client);

            const stored = await readSessionWrapper(sessionId);
            if (!stored?.sdk?.refresh_token) break;

            await client.refresh();

            const freshToken = await client.getToken();
            if (!freshToken) break;

            const me = await client.request<Record<string, any>>(commands.readMe());
            await client.request(commands.readSettings());

            setToken(freshToken);
            setUser(me as DirectusUser);
            setIsAuthenticated(true);
            await fetchAndSetPolicyGlobals(client, me?.id);
          } catch {
            try {
              await clearSessionStorage(sessionId);
            } catch {
              /* ignore */
            }
          }
          break;
        case "apiKey": {
          try {
            const stored = await readSessionWrapper(sessionId);
            const storedKey = stored?.apiKey;
            if (!storedKey) break;

            const client = createD9Client(url, {
              get: async () => ({ accessToken: storedKey, refreshToken: null, expires: null }),
              set: async () => {},
              clear: async () => {},
            });
            setDirectus(client);

            const me = await client.request<Record<string, any>>(commands.readMe());
            const tok = await client.getToken();
            if (!tok) break;

            setToken(tok);
            setUser(me as DirectusUser);
            setIsAuthenticated(true);
            await fetchAndSetPolicyGlobals(client, me?.id);
          } catch {
            try {
              await clearSessionStorage(sessionId);
            } catch {
              /* ignore */
            }
          }
          break;
        }
        default: {
          setDirectus(createD9ClientForStorage(url, sessionId, apiId));
          break;
        }
      }

      setIsLoading(false);
    } catch (error) {
      console.error("Failed to initialize Directus:", error);
      setIsLoading(false);
    }
  };

  const login = async (
    email: string,
    password: string,
    apiUrl: string,
    sessionId: string,
    apiId: string,
  ) => {
    const client = createD9ClientForStorage(apiUrl, sessionId, apiId);
    setDirectus(client);
    await client.login(email, password);
    const tok = await client.getToken();
    if (!tok) throw new Error("Missing access token");
    const me = await client.request<Record<string, any>>(commands.readMe());
    const prev = await readSessionWrapper(sessionId);
    const storedAuth = prev?.sdk;
    await writeSessionWrapper(sessionId, {
      apiId,
      authType: "email",
      sdk: storedAuth ?? null,
      apiKey: prev?.apiKey ?? null,
      userLabel: getUserLabel(me as DirectusUser),
      instanceUrl: apiUrl,
    });
    setUser(me as DirectusUser);
    setToken(tok);
    setIsAuthenticated(true);
    await fetchAndSetPolicyGlobals(client, me?.id);
  };

  const refreshSession = async (override?: RefreshSessionTarget) => {
    try {
      let sessionId: string | undefined;
      let apiUrl: string | undefined;
      if (override?.sessionId && override?.url) {
        sessionId = override.sessionId;
        apiUrl = override.url;
      } else {
        const ctx = await resolveActiveSessionContext();
        if (!ctx) return { ok: false };
        sessionId = ctx.sessionId;
        apiUrl = ctx.api.url;
      }
      if (!sessionId || !apiUrl) return { ok: false };
      return refreshSessionForSession(sessionId, apiUrl);
    } catch {
      return { ok: false };
    }
  };

  const refreshSessionForSession = async (
    sessionId: string,
    apiUrl: string,
  ): Promise<{ ok: boolean; authType?: "email" | "apiKey" }> => {
    try {
      const wrapper = await readSessionWrapper(sessionId);

      // Static-token sessions
      if (wrapper?.authType === "apiKey") {
        const key = wrapper.apiKey?.trim();
        if (!key) return { ok: false };
        const client = createD9Client(apiUrl, {
          get: async () => ({ accessToken: key, refreshToken: null, expires: null }),
          set: async () => {},
          clear: async () => {},
        });
        setDirectus(client);
        const me = await client.request<Record<string, any>>(commands.readMe());
        const tok = await client.getToken();
        if (tok) {
          await writeSessionWrapper(sessionId, {
            apiId: wrapper.apiId ?? "",
            authType: "apiKey",
            sdk: null,
            apiKey: key,
            userLabel: getUserLabel(me as DirectusUser),
            instanceUrl: apiUrl,
          });
          setUser(me as DirectusUser);
          setToken(tok);
          setIsAuthenticated(true);
          return { ok: true, authType: "apiKey" };
        }
        return { ok: false };
      }

      // Email / JWT sessions: try refresh
      const isEmailAuth = !wrapper?.authType || wrapper.authType === "email";
      if (isEmailAuth && wrapper?.sdk?.refresh_token) {
        const client = createD9ClientForStorage(apiUrl, sessionId, wrapper.apiId ?? "");
        setDirectus(client);
        await client.refresh();
        const freshToken = await client.getToken();
        if (freshToken) {
          const me = await client.request<Record<string, any>>(commands.readMe());
          const afterRefresh = await readSessionWrapper(sessionId);
          await writeSessionWrapper(sessionId, {
            apiId: wrapper.apiId ?? "",
            authType: "email",
            sdk: afterRefresh?.sdk ?? wrapper.sdk ?? null,
            apiKey: wrapper.apiKey ?? null,
            userLabel: getUserLabel(me as DirectusUser),
            instanceUrl: apiUrl,
          });
          setUser(me as DirectusUser);
          setToken(freshToken);
          setIsAuthenticated(true);
          return { ok: true, authType: "email" };
        }
      }

      return { ok: false };
    } catch {
      return { ok: false };
    }
  };

  const setApiKey = async (
    apiKey: string,
    apiUrl: string,
    sessionId: string,
    apiId: string,
  ) => {
    const client = createD9Client(apiUrl, {
      get: async () => ({ accessToken: apiKey, refreshToken: null, expires: null }),
      set: async () => {},
      clear: async () => {},
    });
    setDirectus(client);
    const me = await client.request<Record<string, any>>(commands.readMe());
    setToken(apiKey);
    setUser(me as DirectusUser);
    setIsAuthenticated(true);
    await fetchAndSetPolicyGlobals(client, me?.id);
    await writeSessionWrapper(sessionId, {
      apiId,
      authType: "apiKey",
      sdk: null,
      apiKey,
      userLabel: getUserLabel(me as DirectusUser),
      instanceUrl: apiUrl,
    });
  };

  const logout = async () => {
    try {
      const sid = await readActiveSessionId();
      const wrapper = sid ? await readSessionWrapper(sid) : null;
      if (wrapper?.authType === "email" && directus) {
        try {
          await directus.logout();
        } catch {
          /* ignore */
        }
      }
      if (sid) {
        await clearSessionStorage(sid);
        await AsyncStorage.removeItem(
          LocalStorageKeys.DIRECTUS_ACTIVE_SESSION_ID,
        );
      }

      setDirectus(null);
      setIsAuthenticated(false);
      setToken(null);
      setUser(null);
      setPolicyGlobals(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        directus,
        login,
        logout,
        refreshSession,
        setApiKey,
        user,
        token,
        policyGlobals,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};