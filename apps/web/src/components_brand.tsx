/** TRUSTMESH brand lockup: logo mark + wordmark image, with the tagline rendered as crisp text. */
export function BrandLockup({ className = "", maxWidth = 420, tagline = true }: { className?: string; maxWidth?: number; tagline?: boolean }) {
  return (
    <div className={`mx-auto w-full ${className}`} style={{ maxWidth }}>
      <img src="/brand/logo.svg" alt="TRUSTMESH" className="w-full drop-shadow-[0_0_40px_rgba(80,216,178,0.16)]" />
      {tagline && <div className="-mt-[2%] pl-[26%] text-left whitespace-nowrap text-[clamp(8px,1.9vw,11px)] font-bold uppercase tracking-[0.34em] text-ink-300 sm:text-[10.5px] sm:tracking-[0.3em]">Physical proof. Digital trust.</div>}
    </div>
  );
}
