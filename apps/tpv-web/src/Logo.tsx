// Logo canónico de mipiacetpv. SVG inline + wordmark coral split.
// Sigue docs/design/tokens.md §1.

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
        <path
          d="M5.2 4.4c-.85 0-1.55.65-1.55 1.5 0 .65 1.55 1.95 1.55 1.95s1.55-1.3 1.55-1.95c0-.85-.7-1.5-1.55-1.5z"
          fill="#E97058"
        />
        <rect x="4" y="9.5" width="2.4" height="14.5" rx="1.2" fill="#1F2937" />
        <rect x="8.8" y="6" width="2.4" height="18" rx="1.2" fill="#1F2937" />
        <rect x="13.6" y="11" width="2.4" height="13" rx="1.2" fill="#1F2937" />
        <rect x="18.4" y="8" width="2.4" height="16" rx="1.2" fill="#1F2937" />
      </svg>
      <div className="flex items-baseline">
        <span className="text-[18px] font-semibold text-mipiace-ink tracking-tight leading-none">
          mipiace
        </span>
        <span className="text-[18px] font-semibold text-mipiace-coral tracking-tight leading-none">
          tpv
        </span>
      </div>
    </div>
  );
}
