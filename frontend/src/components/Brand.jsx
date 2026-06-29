import React from "react";

export function EposLogo({ size = 40, className = "" }) {
  return (
    <div
      className={`rounded-xl flex items-center justify-center ${className}`}
      style={{ width: size, height: size, background: "#1f2123" }}
      aria-label="EPOS Accountancy"
    >
      <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 40 40" fill="none">
        <path d="M14 20a6 6 0 1 1 12 0H14Zm0 0a6 6 0 0 0 6 6" stroke="#D6D3D1" strokeWidth="3.2" strokeLinecap="round" fill="none"/>
        <circle cx="26" cy="20" r="6" fill="none" stroke="#2DD4BF" strokeWidth="3.2"/>
        <circle cx="26" cy="20" r="1.6" fill="#D6D3D1"/>
      </svg>
    </div>
  );
}

export function EposWordmark({ compact = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <EposLogo size={compact ? 36 : 40} />
      <div className="leading-tight">
        <div className="font-display font-bold text-stone-900 text-base tracking-tight">
          epos<span style={{ color: "#0FB5A5" }}> </span>
          <span style={{ color: "#0FB5A5" }}>accountancy</span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold">Documents Portal</div>
      </div>
    </div>
  );
}
