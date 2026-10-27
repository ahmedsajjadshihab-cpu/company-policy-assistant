import React from "react";
import { MessageSquare, ChevronDown, ChevronUp, Bot, FileText, UserRound, Sparkles } from "lucide-react";
import AccuracyBadge from "./AccuracyBadge.jsx";

function formatTime(value) {
  try {
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
      " • " +
      date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return value;
  }
}

export default function SearchHistory({ searches = [], role = "user" }) {
  const [filter, setFilter] = React.useState("all"); // 'all' | 'policy' | 'chat'
  const [expandedId, setExpandedId] = React.useState(null);

  const filteredSearches = React.useMemo(() => {
    if (!searches || !Array.isArray(searches)) return [];
    if (filter === "policy") return searches.filter((s) => s.source === "policy");
    if (filter === "chat") return searches.filter((s) => s.source === "chat");
    return searches;
  }, [searches, filter]);

  function toggleExpand(id) {
    setExpandedId((curr) => (curr === id ? null : id));
  }

  return (
    <div className="history-card">
      <div className="history-header">
        <div className="history-title-row">
          <MessageSquare size={18} className="text-accent" />
          <h3>{role === "admin" ? "Stored Searches Database" : "Your Search History"}</h3>
          <span className="history-count-badge">{filteredSearches.length}</span>
        </div>

        <div className="history-filter-tabs">
          <button
            type="button"
            className={`filter-tab ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All ({searches.length})
          </button>
          <button
            type="button"
            className={`filter-tab ${filter === "policy" ? "active" : ""}`}
            onClick={() => setFilter("policy")}
          >
            Policy
          </button>
          <button
            type="button"
            className={`filter-tab ${filter === "chat" ? "active" : ""}`}
            onClick={() => setFilter("chat")}
          >
            Chat
          </button>
        </div>
      </div>

      {filteredSearches.length > 0 ? (
        <ul className="history-list">
          {filteredSearches.slice(0, 25).map((item) => {
            const isExpanded = expandedId === item.id;
            const accuracy = item.accuracy || {
              score: item.accuracyScore ?? item.accuracyRate,
              level: item.reliabilityLevel,
              label: item.reliabilityLabel,
              reason: item.reliabilityReason
            };

            return (
              <li key={item.id} className={`history-item ${isExpanded ? "expanded" : ""}`}>
                <div
                  className="history-item-header"
                  onClick={() => toggleExpand(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && toggleExpand(item.id)}
                >
                  <div className="history-item-main">
                    <strong className="history-question">{item.question}</strong>
                    <div className="history-meta">
                      <span className="source-tag">
                        {item.source === "chat" ? (
                          <>
                            <Bot size={12} /> Chat Bot
                          </>
                        ) : (
                          <>
                            <FileText size={12} /> Policy RAG
                          </>
                        )}
                      </span>
                      {role === "admin" && item.username && (
                        <span className="user-tag">
                          <UserRound size={12} /> {item.username} ({item.role || "user"})
                        </span>
                      )}
                      <span className="time-tag">{formatTime(item.createdAt)}</span>
                    </div>
                  </div>

                  <div className="history-item-right">
                    <AccuracyBadge accuracy={accuracy} showReason={false} />
                    <button type="button" className="expand-button" aria-label="Toggle details">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="history-expanded-content">
                    <div className="history-answer-box">
                      <div className="history-answer-label">
                        <Sparkles size={14} /> AI Answer:
                      </div>
                      <p className="history-answer-text">{item.answer}</p>
                    </div>

                    <div className="history-accuracy-details">
                      <AccuracyBadge accuracy={accuracy} showReason={true} />
                    </div>

                    {item.sources && item.sources.length > 0 && (
                      <div className="history-sources">
                        <strong>Cited Policy Sources:</strong>
                        <div className="sources-chips">
                          {item.sources.map((src, idx) => (
                            <span key={idx} className="source-chip" title={src.preview}>
                              Page {src.page || "?"}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="history-empty">
          <p>No searches found in database.</p>
          <span>Ask a question in Policy Assistant or Chat Bot to store and score results.</span>
        </div>
      )}
    </div>
  );
}
