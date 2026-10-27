import React from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info } from "lucide-react";

export default function AccuracyBadge({
  accuracy,
  score: rawScore,
  level: rawLevel,
  label: rawLabel,
  reason: rawReason,
  showReason = true
}) {
  const score = typeof rawScore === "number" ? rawScore : accuracy?.score ?? (typeof accuracy === "number" ? accuracy : null);
  if (score === null || score === undefined) return null;

  const level = rawLevel || accuracy?.level || (score >= 80 ? "high" : score >= 60 ? "medium" : "low");
  const label = rawLabel || accuracy?.label || (level === "high" ? "High Reliability" : level === "medium" ? "Moderate Reliability" : "Low Reliability");
  const reason = rawReason || accuracy?.reason;

  const Icon = level === "high" ? CheckCircle2 : level === "medium" ? AlertTriangle : AlertCircle;

  return (
    <div className={`accuracy-badge-container ${level}`}>
      <div className={`accuracy-badge ${level}`} title={reason || `${label}: ${score}% confidence`}>
        <Icon size={14} className="accuracy-badge-icon" />
        <span className="accuracy-badge-score">{score}%</span>
        <span className="accuracy-badge-sep">•</span>
        <span className="accuracy-badge-label">{label}</span>
      </div>
      {showReason && reason && (
        <span className="accuracy-badge-reason" title={reason}>
          <Info size={12} className="inline-icon" /> {reason}
        </span>
      )}
    </div>
  );
}
