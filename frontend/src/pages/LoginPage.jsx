import React from "react";
import { ArrowRight, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";

const credentials = {
  user: {
    username: "user",
    password: "user123"
  },
  admin: {
    username: "admin",
    password: "admin123"
  }
};

export default function LoginPage({ onLogin }) {
  const [role, setRole] = React.useState("user");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const normalizedUsername = String(username).trim().toLowerCase();
    const normalizedPassword = String(password).trim();
    const expected = credentials[role];

    await new Promise((resolve) => setTimeout(resolve, 200));

    if (
      normalizedUsername === expected.username &&
      normalizedPassword === expected.password
    ) {
      onLogin({ role, username: normalizedUsername });
      return;
    }

    setError(`Invalid ${role === "admin" ? "admin" : "user"} credentials. Try the demo credentials shown below.`);
    setSubmitting(false);
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-header">
          <div className="brand-icon login-brand-icon">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1>Policy Assistant Portal</h1>
            <p>Sign in as a user or admin to continue.</p>
          </div>
        </div>

        <div className="login-role-switch" role="tablist" aria-label="Choose login role">
          <button
            type="button"
            className={role === "user" ? "role-pill active" : "role-pill"}
            onClick={() => {
              setRole("user");
              setError("");
            }}
          >
            <UserRound size={16} />
            User
          </button>
          <button
            type="button"
            className={role === "admin" ? "role-pill active" : "role-pill"}
            onClick={() => {
              setRole("admin");
              setError("");
            }}
          >
            <LockKeyhole size={16} />
            Admin
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-field">
            <span>Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={role === "admin" ? "admin" : "user"}
              required
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={role === "admin" ? "admin123" : "user123"}
              required
            />
          </label>

          {error && <div className="error-box login-error">{error}</div>}

          <button className="primary-button login-button" type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
            <ArrowRight size={18} />
          </button>
        </form>

        <div className="login-hint">
          <strong>Demo credentials</strong>
          <p>User: user / user123</p>
          <p>Admin: admin / admin123</p>
        </div>
      </section>
    </main>
  );
}
