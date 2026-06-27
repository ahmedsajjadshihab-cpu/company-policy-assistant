import React from "react";
import { Bot, Loader2, MessageCircle, Send, UserRound } from "lucide-react";
import { API_URL, getFriendlyError, readApiResponse } from "../lib/api.js";

export default function ChatPage() {
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [messages, setMessages] = React.useState([
    {
      role: "assistant",
      text: "Hi! Ask about the company policy and I’ll answer from the uploaded PDF first, then fall back to general AI guidance if needed."
    }
  ]);
  const messagesEndRef = React.useRef(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function sendMessage(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, { role: "user", text }];
    setInput("");
    setSending(true);
    setError("");
    setMessages(nextMessages);

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text })
      });
      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not get a reply.");
      }

      setMessages((current) => [...current, { role: "assistant", text: data.answer }]);
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
        text: "Chat cleared. Ask me about your policy questions again."
      }
    ]);
    setError("");
  }

  return (
    <main className="simple-chat-shell">
      <section className="simple-chat-panel">
        <div className="chat-header">
          <div className="simple-chat-brand">
            <div className="brand-icon">
              <MessageCircle size={24} />
            </div>
            <div>
              <h2>Chat Bot</h2>
              <p>Policy-aware chat with RAG and Groq.</p>
            </div>
          </div>
          <button className="ghost-button" type="button" onClick={clearChat} disabled={sending}>
            Clear chat
          </button>
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
                Searching the policy context...
              </div>
            </article>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type your question..."
            disabled={sending}
          />
          <button className="send-button" type="submit" disabled={sending || !input.trim()}>
            <Send size={18} />
          </button>
        </form>
      </section>
    </main>
  );
}
