import React from "react";
import ChatPage from "./pages/ChatPage.jsx";
import PolicyPage from "./pages/PolicyPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";

function getRoute() {
  const path = window.location.pathname;
  if (path === "/chat" || path.endsWith("/chat")) {
    return "/chat";
  }
  return "/";
}

export default function App() {
  const [route, setRoute] = React.useState(getRoute);
  const [session, setSession] = React.useState(() => {
    try {
      const saved = window.localStorage.getItem("policy-session");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  React.useEffect(() => {
    function handlePopState() {
      setRoute(getRoute());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  React.useEffect(() => {
    if (session) {
      window.localStorage.setItem("policy-session", JSON.stringify(session));
    } else {
      window.localStorage.removeItem("policy-session");
    }
  }, [session]);

  function navigate(path) {
    if (path === route) return;
    window.history.pushState({}, "", path);
    setRoute(path);
  }

  function handleLogin(nextSession) {
    setSession(nextSession);
    navigate(nextSession.role === "admin" ? "/" : "/chat");
  }

  function handleLogout() {
    setSession(null);
    navigate("/login");
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <>
      <nav className="top-nav">
        <button
          type="button"
          className={route === "/" ? "nav-link active" : "nav-link"}
          onClick={() => navigate("/")}
        >
          Policy Assistant
        </button>
        <button
          type="button"
          className={route === "/chat" ? "nav-link active" : "nav-link"}
          onClick={() => navigate("/chat")}
        >
          Chat Bot
        </button>
        <div className="nav-spacer" />
        <span className="session-badge">{session.role === "admin" ? "Admin" : "User"}</span>
        <button type="button" className="ghost-button small" onClick={handleLogout}>
          Logout
        </button>
      </nav>

      {route === "/chat" ? <ChatPage /> : <PolicyPage role={session.role} />}
    </>
  );
}
