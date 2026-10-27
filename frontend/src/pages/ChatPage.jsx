import React from "react";
import { Bot, Loader2, MessageCircle, Send, UserRound, History, X } from "lucide-react";
import SearchHistory from "../components/SearchHistory.jsx";
import AccuracyBadge from "../components/AccuracyBadge.jsx";
import { API_URL, getFriendlyError, readApiResponse } from "../lib/api.js";

export default function ChatPage({ session }) {
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [searches, setSearches] = React.useState([]);
  const [showHistory, setShowHistory] = React.useState(false);
  const [messages, setMessages] = React.useState([
    {
      role: "assistant",
      text: "Hi! Ask me anything — I’m powered by Groq. Every response includes a real-time accuracy and reliability score."
    }
  ]);
  const messagesEndRef = React.useRef(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  React.useEffect(() => {
    loadSearches();
  }, []);

  async function loadSearches() {
    try {
      const params = new URLSearchParams({
        username: session?.username || "",
        role: session?.role || "user"
      });
      const response = await fetch(`${API_URL}/api/searches?${params}`);
      const data = await readApiResponse(response);
      if (response.ok) {
        setSearches(data.searches || []);
      }
    } catch {
      // Ignored if waking up
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, { role: "user", text }];
    setInput("");
    setSending(true);
    setError("");
    setMessages(nextMessages);

    const history = nextMessages
      .slice(0, -1)
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role, content: message.text }));

    try {
      const response = await fetch(`${API_URL}/api/simple-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          username: session?.username,
          role: session?.role
        })
      });
      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not get a reply.");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: data.reply,
          accuracy: data.accuracy,
          accuracyRate: data.accuracyRate ?? data.accuracy?.score
        }
      ]);
      await loadSearches();
    } catch (err) {
      const message = getFriendlyError(err);
      setError(message);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: message }
      ]);
    } finally {
      setSending(false);
    }
  }

  function clearChat() {
    setMessages([
      {
        role: "assistant",
        text: "Chat cleared. What would you like to talk about?"
      }
    ]);
    setError("");
  }

  return (
    <main className={`simple-chat-shell ${showHistory ? "with-history" : ""}`}>
      <section className="simple-chat-panel">
        <div className="chat-header">
          <div className="simple-chat-brand">
            <div className="brand-icon">
              <MessageCircle size={24} />
            </div>
            <div>
              <h2>Chat Bot</h2>
              <p>General assistant powered by Groq with AI accuracy scoring.</p>
            </div>
          </div>
          <div className="chat-header-actions">
            <button
              className={`ghost-button ${showHistory ? "active" : ""}`}
              type="button"
              onClick={() => setShowHistory(!showHistory)}
            >
              <History size={16} />
              {showHistory ? "Hide History" : "Search History"}
            </button>
            <button className="ghost-button" type="button" onClick={clearChat} disabled={sending}>
              Clear chat
            </button>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="messages simple-chat-messages" aria-live="polite">
          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
              <div className="avatar">
                {message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}
              </div>
              <div className="bubble">
                <p>{typeof message.text === "string" ? message.text : String(message.text ?? "")}</p>
                {(message.accuracy || typeof message.accuracyRate === "number") && (
                  <AccuracyBadge accuracy={message.accuracy || message.accuracyRate} />
                )}
              </div>
            </article>
          ))}
          {sending && (
            <article className="message assistant">
              <div className="avatar">
                <Bot size={18} />
              </div>
              <div className="bubble typing">
                <Loader2 className="spin" size={18} />
                Thinking & evaluating accuracy...
              </div>
            </article>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type your message..."
            disabled={sending}
          />
          <button className="send-button" type="submit" disabled={sending || !input.trim()}>
            <Send size={18} />
          </button>
        </form>
      </section>

      {showHistory && (
        <aside className="chat-history-sidebar">
          <div className="chat-history-sidebar-header">
            <h3>Searches History</h3>
            <button type="button" className="ghost-button small" onClick={() => setShowHistory(false)}>
              <X size={16} />
            </button>
          </div>
          <SearchHistory searches={searches} role={session?.role} />
        </aside>
      )}
    </main>
  );
}
