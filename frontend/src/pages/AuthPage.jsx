import { useState } from "react";
import "./AuthPage.css";

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

export default function AuthPage() {
  const [mode, setMode] = useState("sign-up");
  const [email, setEmail] = useState("");

  const isSignUp = mode === "sign-up";

  const handleSubmit = (event) => {
    event.preventDefault();

    const name = email.split("@")[0] || "User";
    window.location.href = `/?name=${encodeURIComponent(name)}`;
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
              ? "Choose how you want to sign up."
              : "Choose how you want to sign in."}
          </p>

          <p className="auth-label">Continue with</p>
          <div className="social-row">
            {socialProviders.map((provider) => (
              <button
                className="social-button"
                key={provider.name}
                type="button"
                aria-label={`Continue with ${provider.name}`}
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
            <button type="submit">
              {isSignUp ? "Passwordless sign-up with email" : "Sign in with email"}
            </button>
          </form>

          <button
            className="auth-switch"
            type="button"
            onClick={() => setMode(isSignUp ? "sign-in" : "sign-up")}
          >
            {isSignUp ? "Already have an account?" : "Need an account?"}
          </button>
        </div>
      </section>

      <p className="auth-terms">By continuing you agree to our terms.</p>
    </main>
  );
}
