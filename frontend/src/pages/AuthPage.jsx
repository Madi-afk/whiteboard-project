import { useEffect, useRef, useState } from "react";
import "./AuthPage.css";

const API_URL = "/api";
const AUTH_RETURN_TO_KEY = "whiteboard_auth_return_to";
const KEYCLOAK_STATE_KEY = "whiteboard_keycloak_state";
const KEYCLOAK_VERIFIER_KEY = "whiteboard_keycloak_code_verifier";
const CONFIG_TIMEOUT_MS = 5000;
const AUTH_CALLBACK_PARAMS = [
  "code",
  "error",
  "error_description",
  "iss",
  "session_state",
  "state",
];

function AuthDoodle() {
  return (
    <div className="auth-doodle" aria-hidden="true">
      <div className="doodle-orbit orbit-one">
        <span />
      </div>
      <div className="doodle-orbit orbit-two">
        <span />
      </div>
      <div className="doodle-window">
        <div className="doodle-window-bar">
          <span />
          <span />
          <span />
        </div>
        <div className="doodle-pen" />
        <div className="doodle-ball" />
        <div className="doodle-cursor" />
        <div className="doodle-label">whiteboard</div>
      </div>
      <div className="doodle-link">∞</div>
    </div>
  );
}

async function getAppConfig() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, CONFIG_TIMEOUT_MS);

  let response;

  try {
    response = await fetch(`${API_URL}/config`, {
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error("Failed to load app config");
  }

  return response.json();
}

function base64UrlEncode(bytes) {
  let value = "";

  bytes.forEach((byte) => {
    value += String.fromCharCode(byte);
  });

  return window
    .btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createRandomString(length = 32) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createPkceChallenge(verifier) {
  if (!window.crypto?.subtle) {
    return {
      method: "plain",
      challenge: verifier,
    };
  }

  const data = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest("SHA-256", data);

  return {
    method: "S256",
    challenge: base64UrlEncode(new Uint8Array(digest)),
  };
}

function getAuthRedirectUri() {
  return `${window.location.origin}/auth`;
}

function cleanAuthCallbackUrl() {
  const url = new URL(window.location.href);
  let hasAuthParams = false;

  for (const param of AUTH_CALLBACK_PARAMS) {
    if (url.searchParams.has(param)) {
      hasAuthParams = true;
      url.searchParams.delete(param);
    }
  }

  if (hasAuthParams) {
    window.history.replaceState({}, "", url.toString());
  }
}

function getReturnTo() {
  const currentPath = `${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams(window.location.search);

  if (params.has("code") && params.has("state")) {
    return sessionStorage.getItem(AUTH_RETURN_TO_KEY) || "/";
  }

  if (window.location.pathname === "/auth") {
    return window.location.search ? `/${window.location.search}` : "/";
  }

  return currentPath || "/";
}

async function startKeycloakLogin(keycloakConfig, identityProvider = null) {
  const verifier = createRandomString(48);
  const state = createRandomString(24);
  const pkce = await createPkceChallenge(verifier);
  const authUrl = new URL(
    `${keycloakConfig.url}/realms/${keycloakConfig.realm}/protocol/openid-connect/auth`
  );

  sessionStorage.setItem(KEYCLOAK_STATE_KEY, state);
  sessionStorage.setItem(KEYCLOAK_VERIFIER_KEY, verifier);
  sessionStorage.setItem(AUTH_RETURN_TO_KEY, getReturnTo());

  authUrl.searchParams.set("client_id", keycloakConfig.clientId);
  authUrl.searchParams.set("redirect_uri", getAuthRedirectUri());
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", pkce.method);

  if (identityProvider) {
    authUrl.searchParams.set("kc_idp_hint", identityProvider);
  }

  window.location.assign(authUrl.toString());
}

async function exchangeKeycloakCode(code, verifier) {
  const response = await fetch(`${API_URL}/auth/keycloak/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      redirect_uri: getAuthRedirectUri(),
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Keycloak login failed");
  }

  return data;
}

export default function AuthPage({ onAuthSuccess }) {
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [keycloakConfig, setKeycloakConfig] = useState(null);
  const hasHandledKeycloakCallback = useRef(false);

  const isKeycloakEnabled = Boolean(keycloakConfig?.enabled);
  const isGoogleEnabled = Boolean(keycloakConfig?.identityProviders?.google);
  const isGitHubEnabled = Boolean(keycloakConfig?.identityProviders?.github);

  const completeAuth = (data, redirectTo = null) => {
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("username", data.username);
    localStorage.setItem("auth_provider", data.provider || "local");

    if (data.id_token) {
      localStorage.setItem("keycloak_id_token", data.id_token);
    } else {
      localStorage.removeItem("keycloak_id_token");
    }

    if (redirectTo) {
      window.history.replaceState({}, "", redirectTo);
    } else if (window.location.pathname === "/auth") {
      window.history.replaceState({}, "", "/");
    }

    onAuthSuccess();
  };

  useEffect(() => {
    let isMounted = true;

    getAppConfig()
      .then((config) => {
        if (isMounted) {
          setKeycloakConfig(config.keycloak || null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setKeycloakConfig(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const authError = params.get("error");
    const authErrorDescription = params.get("error_description");

    if (authError) {
      sessionStorage.removeItem(KEYCLOAK_STATE_KEY);
      sessionStorage.removeItem(KEYCLOAK_VERIFIER_KEY);

      cleanAuthCallbackUrl();
      setError(
        authErrorDescription === "authentication_expired"
          ? "Keycloak session expired. Please try signing in again."
          : authErrorDescription || authError
      );
      return;
    }

    if (!code || !state) return;
    if (hasHandledKeycloakCallback.current) return;

    hasHandledKeycloakCallback.current = true;

    const expectedState = sessionStorage.getItem(KEYCLOAK_STATE_KEY);
    const verifier = sessionStorage.getItem(KEYCLOAK_VERIFIER_KEY);

    if (!expectedState || expectedState !== state || !verifier) {
      cleanAuthCallbackUrl();
      setError("Invalid Keycloak login state");
      return;
    }

    setIsLoading(true);
    setError("");

    exchangeKeycloakCode(code, verifier)
      .then((data) => {
        const returnTo = sessionStorage.getItem(AUTH_RETURN_TO_KEY) || "/";

        sessionStorage.removeItem(KEYCLOAK_STATE_KEY);
        sessionStorage.removeItem(KEYCLOAK_VERIFIER_KEY);
        sessionStorage.removeItem(AUTH_RETURN_TO_KEY);

        completeAuth(data, returnTo);
      })
      .catch((error) => {
        cleanAuthCallbackUrl();
        setError(error.message);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const handleKeycloakLogin = async (identityProvider = null) => {
    if (!isKeycloakEnabled) return;

    setError("");
    setIsLoading(true);

    try {
      await startKeycloakLogin(keycloakConfig, identityProvider);
      window.setTimeout(() => {
        setIsLoading(false);
      }, CONFIG_TIMEOUT_MS);
    } catch (error) {
      setError(error.message);
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <a className="auth-logo" href="/" aria-label="Back to whiteboard">
        <span className="auth-logo-mark">
          <span>W</span>
        </span>
        <span>WHITEBOARD</span>
      </a>

      <section className="auth-shell">
        <div className="auth-art">
          <AuthDoodle />
          <h1>Interactive Sharing Options</h1>
          <div className="auth-dots" aria-hidden="true">
            <span className="active" />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="auth-card" aria-labelledby="auth-title">
          <p className="auth-eyebrow">Get Started</p>
          <h2 id="auth-title">Welcome back!</h2>
          <p className="auth-subtitle">
            Sign in with Keycloak to continue working on your whiteboard.
          </p>

          <button
            className="keycloak-button"
            type="button"
            disabled={isLoading || !isKeycloakEnabled}
            onClick={() => handleKeycloakLogin()}
          >
            {isLoading ? "Please wait..." : "Continue with Keycloak"}
          </button>

          <div className="auth-provider-buttons">
            <button
              className="auth-provider-button"
              type="button"
              disabled={isLoading || !isKeycloakEnabled || !isGoogleEnabled}
              onClick={() => handleKeycloakLogin("google")}
            >
              <span className="auth-provider-icon">G</span>
              <span>
                {isGoogleEnabled
                  ? "Continue with Google"
                  : "Google not configured"}
              </span>
            </button>

            <button
              className="auth-provider-button"
              type="button"
              disabled={isLoading || !isKeycloakEnabled || !isGitHubEnabled}
              onClick={() => handleKeycloakLogin("github")}
            >
              <span className="auth-provider-icon">GH</span>
              <span>
                {isGitHubEnabled
                  ? "Continue with GitHub"
                  : "GitHub not configured"}
              </span>
            </button>
          </div>

          {!isKeycloakEnabled && (
            <p className="auth-error">Keycloak is not configured.</p>
          )}

          {error && <p className="auth-error">{error}</p>}
        </div>
      </section>

      <p className="auth-terms">By continuing you agree to our terms.</p>
    </main>
  );
}
