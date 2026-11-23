export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="sf-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c084fc" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#12141d" />
      <rect x=".5" y=".5" width="63" height="63" rx="15.5" fill="none" stroke="rgb(255 255 255 / .1)" />
      <path d="M24 18.5v27a2 2 0 0 0 3 1.7l22.5-13.5a2 2 0 0 0 0-3.4L27 16.8a2 2 0 0 0-3 1.7Z" fill="url(#sf-logo)" />
      <path d="M14 22v20" stroke="url(#sf-logo)" strokeWidth="4" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}
