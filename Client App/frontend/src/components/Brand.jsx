import React from "react";
import eposLogo from "@/assets/epos-logo.png";

export function EposLogo({ size = 40, className = "" }) {
  return (
    <img
      src={eposLogo}
      alt="EPOS Accountancy"
      className={`rounded-xl object-contain ${className}`}
      style={{ width: size, height: size }}
      aria-label="EPOS Accountancy"
    />
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
