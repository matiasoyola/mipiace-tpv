// Componentes compartidos del admin. Antes vivían inline en App.tsx
// (B1+B2) — extraídos en B3 para que las páginas nuevas (Dispositivos,
// Cajeros, Seguridad, Forgot/Reset password) los reutilicen.

import type { ReactNode } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";

import { Logo } from "./Logo.js";

export function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-mipiace-stone font-sans px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size={32} />
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 p-7 md:p-8">{children}</div>
      </div>
    </div>
  );
}

export function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-mipiace-stone font-sans">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-[13.5px]">{label}</span>
      </div>
    </div>
  );
}

export function TextField({
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  spellCheck,
  placeholder,
  inputMode,
  pattern,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  spellCheck?: boolean;
  placeholder?: string;
  inputMode?: "numeric" | "text" | "email" | "tel";
  pattern?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        inputMode={inputMode}
        pattern={pattern}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
      />
    </div>
  );
}

export function PrimaryButton({
  children,
  busy,
  disabled,
  type = "submit",
  onClick,
  className = "",
}: {
  children: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className={`w-full h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14.5px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${className}`}
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export function OutlineButton({
  children,
  onClick,
  busy,
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className={`h-11 px-4 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${className}`}
    >
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-3 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
      <AlertCircle className="w-4 h-4 mt-px shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 text-[13px] text-emerald-700 bg-emerald-50 rounded-xl px-3.5 py-2.5">
      <Check className="w-4 h-4 mt-px shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function ReadOnlyField({
  label,
  value,
  tabular,
  wide,
}: {
  label: string;
  value: string;
  tabular?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <div className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-1">
        {label}
      </div>
      <div
        className={`text-[14.5px] text-mipiace-ink font-medium ${tabular ? "tabular-nums" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

// "Hace X min" / "hace X h" / "hace X días". Devuelve "hace un momento"
// si < 1 min.
export function formatRelative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "hace un momento";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `hace ${diffHr} h`;
  const diffDays = Math.round(diffHr / 24);
  return `hace ${diffDays} día${diffDays === 1 ? "" : "s"}`;
}

// Fix B2 review §4.4: `fiscalProfile.direccion` puede venir como objeto
// del almacén default Holded o como string del form manual. Sin esta
// función el render lo pinta como [object Object].
export function formatDireccion(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value.length > 0 ? value : "—";
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    const parts = [
      [v.calle, v.cp].filter((x) => typeof x === "string" && x.length > 0).join(" "),
      typeof v.ciudad === "string" ? v.ciudad : null,
      typeof v.provincia === "string" ? v.provincia : null,
    ]
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .join(", ");
    const pais = typeof v.pais === "string" ? v.pais : null;
    if (parts && pais) return `${parts} (${pais})`;
    if (parts) return parts;
    if (pais) return pais;
    return "—";
  }
  return "—";
}
