export function DragonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 90 90" className={className} aria-hidden="true">
      <ellipse cx="45" cy="55" rx="22" ry="18" fill="#8B0000" opacity="0.3" />
      <ellipse cx="45" cy="52" rx="20" ry="16" fill="#FF3333" />
      <ellipse cx="45" cy="50" rx="18" ry="14" fill="#FF5555" />
      <ellipse cx="42" cy="48" rx="10" ry="8" fill="#FF6666" opacity="0.6" />

      <ellipse cx="38" cy="62" rx="6" ry="8" fill="#FF4444" />
      <ellipse cx="52" cy="62" rx="6" ry="8" fill="#FF4444" />
      <ellipse cx="38" cy="68" rx="7" ry="4" fill="#FF3333" />
      <ellipse cx="52" cy="68" rx="7" ry="4" fill="#FF3333" />

      <ellipse cx="30" cy="48" rx="5" ry="10" fill="#FF4444" transform="rotate(-20 30 48)" />
      <ellipse cx="60" cy="48" rx="5" ry="10" fill="#FF4444" transform="rotate(20 60 48)" />

      <ellipse cx="28" cy="52" rx="8" ry="6" fill="#FFEAA7" stroke="#FFD700" strokeWidth="1" />
      <circle cx="26" cy="50" r="1.5" fill="#FF6B6B" />
      <circle cx="30" cy="50" r="1.5" fill="#4ECDC4" />
      <circle cx="28" cy="53" r="1.5" fill="#95E1D3" />

      <line
        x1="60"
        y1="48"
        x2="66"
        y2="44"
        stroke="#8B4513"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M66 44 L68 42 L67 41 L65 43 Z" fill="#FFD700" />

      <ellipse cx="45" cy="35" rx="16" ry="18" fill="#8B0000" opacity="0.3" />
      <circle cx="45" cy="32" r="15" fill="#FF4444" />
      <circle cx="45" cy="30" r="13" fill="#FF5555" />
      <ellipse cx="42" cy="28" rx="8" ry="10" fill="#FF6666" opacity="0.5" />

      <ellipse cx="40" cy="28" rx="5" ry="6" fill="#FFFFFF" />
      <ellipse cx="50" cy="28" rx="5" ry="6" fill="#FFFFFF" />
      <circle cx="40" cy="29" r="3.5" fill="#000000" />
      <circle cx="50" cy="29" r="3.5" fill="#000000" />
      <circle cx="41" cy="27" r="1.8" fill="#FFFFFF" />
      <circle cx="51" cy="27" r="1.8" fill="#FFFFFF" />

      <ellipse cx="33" cy="33" rx="3" ry="2.5" fill="#FF8888" opacity="0.6" />
      <ellipse cx="57" cy="33" rx="3" ry="2.5" fill="#FF8888" opacity="0.6" />

      <path
        d="M38 35 Q45 38 52 35"
        stroke="#FF3333"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />

      <path d="M35 22 Q33 18 32 19 Q34 21 35 24" fill="#FF4444" />
      <path d="M55 22 Q57 18 58 19 Q56 21 55 24" fill="#FF4444" />
      <ellipse cx="33" cy="20" rx="2" ry="3" fill="#FFD700" opacity="0.6" />
      <ellipse cx="57" cy="20" rx="2" ry="3" fill="#FFD700" opacity="0.6" />

      <path
        d="M60 58 Q68 60 70 55 Q68 50 65 52"
        stroke="#FF4444"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M60 58 Q68 60 70 55 Q68 50 65 52"
        stroke="#FF5555"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
