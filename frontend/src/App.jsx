import React from "react";
import ChatPage from "./pages/ChatPage.jsx";
import PolicyPage from "./pages/PolicyPage.jsx";

function getRoute() {
  const path = window.location.pathname;
  if (path === "/chat" || path.endsWith("/chat")) {
    return "/chat";
  }
  return "/";
}

export default function App() {
  const [route, setRoute] = React.useState(getRoute);

  React.useEffect(() => {
    function handlePopState() {
      setRoute(getRoute());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(path) {
    if (path === route) return;
    window.history.pushState({}, "", path);
    setRoute(path);
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
      </nav>

      {route === "/chat" ? <ChatPage /> : <PolicyPage />}
    </>
  );
}
