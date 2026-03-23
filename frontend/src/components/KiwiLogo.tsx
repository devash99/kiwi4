export function KiwiLogoMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} xmlns="http://www.w3.org/2000/svg">
      {/* Whole kiwi behind */}
      <ellipse cx="24" cy="34" rx="16" ry="14" fill="#6B4226" />
      <ellipse cx="24" cy="34" rx="16" ry="14" fill="url(#fuzzy)" opacity="0.5" />
      {/* Tiny hair texture lines */}
      <g stroke="#8B6914" strokeWidth="0.4" opacity="0.5">
        <line x1="12" y1="28" x2="14" y2="26" />
        <line x1="18" y1="23" x2="20" y2="21" />
        <line x1="26" y1="22" x2="28" y2="20" />
        <line x1="32" y1="25" x2="34" y2="23" />
        <line x1="34" y1="32" x2="36" y2="31" />
        <line x1="10" y1="36" x2="8" y2="37" />
        <line x1="14" y1="43" x2="12" y2="45" />
        <line x1="24" y1="46" x2="26" y2="48" />
        <line x1="34" y1="40" x2="36" y2="42" />
      </g>

      {/* Half-sliced kiwi in front */}
      <circle cx="40" cy="32" r="18" fill="#2D5A1E" />
      <circle cx="40" cy="32" r="16" fill="#4A8B2C" />
      <circle cx="40" cy="32" r="13" fill="#6BBF3B" />
      <circle cx="40" cy="32" r="9" fill="#9BD770" />
      <circle cx="40" cy="32" r="5" fill="#E8F0D0" />
      <circle cx="40" cy="32" r="2" fill="#FFFDE8" />

      {/* Seed ring */}
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((angle) => {
        const r = 7.5;
        const cx = 40 + r * Math.cos((angle * Math.PI) / 180);
        const cy = 32 + r * Math.sin((angle * Math.PI) / 180);
        return <ellipse key={angle} cx={cx} cy={cy} rx="1.2" ry="0.7" fill="#2A1A0A" transform={`rotate(${angle + 90} ${cx} ${cy})`} />;
      })}

      {/* Radial lines from center */}
      <g stroke="#7BC44A" strokeWidth="0.3" opacity="0.4">
        {[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345].map((angle) => {
          const x1 = 40 + 3 * Math.cos((angle * Math.PI) / 180);
          const y1 = 32 + 3 * Math.sin((angle * Math.PI) / 180);
          const x2 = 40 + 12 * Math.cos((angle * Math.PI) / 180);
          const y2 = 32 + 12 * Math.sin((angle * Math.PI) / 180);
          return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>

      <defs>
        <radialGradient id="fuzzy">
          <stop offset="0%" stopColor="#8B6914" />
          <stop offset="100%" stopColor="#5A3A1A" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function KiwiLogoFull() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <KiwiLogoMark size={36} />
      <span
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: '22px',
          fontWeight: 600,
          color: '#E8EDE8',
          letterSpacing: '2px',
        }}
      >
        KIWI
      </span>
    </div>
  );
}
