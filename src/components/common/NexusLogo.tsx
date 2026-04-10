import { useId, type CSSProperties } from "react";

type NexusLogoProps = {
  height?: number;
  width?: number | "auto";
  style?: CSSProperties;
  className?: string;
};

/**
 * Logo Nexus en SVG inline (aucune requête HTTP) — affichage fiable en dev et dans le binaire Tauri.
 * Pour changer le visuel : éditer ce composant ou réimporter le path depuis `src/assets/nexus-logo.svg`.
 */
export function NexusLogo({
  height = 36,
  width = "auto",
  style,
  className,
}: NexusLogoProps) {
  const reactId = useId().replace(/:/g, "");
  const gid = `${reactId}-nexusGradient`;
  const fWhite = `${reactId}-whiteOutline`;
  const fText = `${reactId}-textOutline`;

  const aspectRatio = 240 / 60;
  const calculatedWidth =
    width === "auto" ? Math.round(height * aspectRatio) : width;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 240 60"
      width={calculatedWidth}
      height={height}
      className={className}
      style={{ display: "block", ...style }}
      role="img"
      aria-label="Nexus"
    >
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: "#06B6D4", stopOpacity: 1 }} />
          <stop offset="50%" style={{ stopColor: "#60A5FA", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "#A855F7", stopOpacity: 1 }} />
        </linearGradient>
        <filter id={fWhite} x="-30%" y="-30%" width="160%" height="160%">
          <feMorphology
            operator="dilate"
            radius="1.2"
            in="SourceAlpha"
            result="thicken"
          />
          <feFlood floodColor="white" floodOpacity="1" result="white" />
          <feComposite in="white" in2="thicken" operator="in" result="outline" />
          <feComposite in="SourceGraphic" in2="outline" operator="over" />
        </filter>
        <filter id={fText} x="-30%" y="-30%" width="160%" height="160%">
          <feMorphology
            operator="dilate"
            radius="1"
            in="SourceAlpha"
            result="thicken"
          />
          <feFlood floodColor="white" floodOpacity="1" result="white" />
          <feComposite in="white" in2="thicken" operator="in" result="outline" />
          <feComposite in="SourceGraphic" in2="outline" operator="over" />
        </filter>
      </defs>
      <path
        d="M 6 6 L 6 54 L 22 54 L 22 28 L 40 54 L 56 54 L 56 6 L 40 6 L 40 32 L 22 6 Z"
        fill={`url(#${gid})`}
        filter={`url(#${fWhite})`}
        stroke="white"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <text
        x="68"
        y="44"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="46"
        fontWeight="900"
        fill={`url(#${gid})`}
        filter={`url(#${fText})`}
        style={{ letterSpacing: "1.2px" }}
      >
        exus
      </text>
    </svg>
  );
}
