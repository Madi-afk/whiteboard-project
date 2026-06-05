import { useState } from "react";
import "./AuthPage.css";

const API_URL = `http://${window.location.hostname}:8000`;

const socialProviders = [
  { name: "Facebook", mark: "f", className: "facebook" },
  { name: "GitHub", mark: "GH", className: "github" },
  { name: "Google", mark: "G", className: "google" },
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

async function registerUser(email, password) {
  const username = email.split("@")[0].toLowerCase();

  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      password,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Registration failed");
  }

  return data;
}

async function loginUser(email, password) {
  const username = email.split("@")[0].toLowerCase();

  const formData = new URLSearchParams();
  formData.append("username", username);
  formData.append("password", password);

  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Login failed");
  }

  return data;
}

export default function AuthPage({ onAuthSuccess }) {
  const [mode, setMode] = useState("sign-up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isSignUp = mode === "sign-up";

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError("");
    setIsLoading(true);

    try {
      const data = isSignUp
        ? await registerUser(email, password)
        : await loginUser(email, password);

      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("username", data.username);

      onAuthSuccess();
    } catch (error) {
      setError(error.message);
    } finally {
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
          <h2 id="auth-title">{isSignUp ? "Hi there!" : "Welcome back!"}</h2>
          <p className="auth-subtitle">
            {isSignUp
              ? "Create an account to start collaborating."
              : "Sign in to continue working on your whiteboard."}
          </p>

          <p className="auth-label">Continue with</p>
          <div className="social-row">
            {socialProviders.map((provider) => (
              <button
                className="social-button"
                key={provider.name}
                type="button"
                aria-label={`Continue with ${provider.name}`}
                disabled
                title="Social login is not implemented yet"
              >
                <span className={`social-mark ${provider.className}`}>
                  {provider.mark}
                </span>
              </button>
            ))}
          </div>

          <div className="auth-divider">
            <span />
            <p>or</p>
            <span />
          </div>

          <form className="email-form" onSubmit={handleSubmit}>
            <label className="email-label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
            />

            <label className="email-label" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimum 6 characters"
              minLength={6}
              required
            />

            {error && (
              <p style={{ color: "#dc2626", margin: "8px 0", fontSize: 14 }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={isLoading}>
              {isLoading
                ? "Please wait..."
                : isSignUp
                ? "Sign up with email"
                : "Sign in with email"}
            </button>
          </form>

          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setError("");
              setMode(isSignUp ? "sign-in" : "sign-up");
            }}
          >
            {isSignUp ? "Already have an account?" : "Need an account?"}
          </button>
        </div>
      </section>

      <p className="auth-terms">By continuing you agree to our terms.</p>
    </main>
  );
}