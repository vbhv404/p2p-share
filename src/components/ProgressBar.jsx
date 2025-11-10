import React from "react";

export default function ProgressBar({ progress }) {
  const pct = Math.min(100, Math.max(0, progress || 0));
  return (
    <div className="progress-wrap" aria-label="progress">
      <div className="progress" style={{ width: pct + "%" }} />
    </div>
  );
}
