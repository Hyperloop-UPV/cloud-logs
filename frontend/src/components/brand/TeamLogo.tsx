// Isotipo del equipo Hyperloop UPV.
//
// logo_icon.svg dibuja la marca en el ~49% central de su viewBox 900x900 (una caja
// de unos 340x439), asi que pintado a pelo se ve a media altura. Se escala la imagen
// dentro de un cuadrado recortado para que la marca, y no el lienzo vacio, mida
// `size` px. Mismo arreglo que adj-view.
//
// Nota: el SVG es negro sobre transparencia y no usa currentColor, de ahi dark:invert.

import logo from "@hyperloopupv/frontend-kit/outreach/main/logo_icon.svg";
import { cn } from "@hyperloopupv/frontend-kit/lib";

const LOGO_SCALE = 900 / 440;

interface TeamLogoProps {
  size: number;
  alt?: string;
  className?: string;
}

export function TeamLogo({
  size,
  alt = "Hyperloop UPV",
  className,
}: TeamLogoProps) {
  return (
    <span
      // inline-block es necesario: un <span> inline ignora width/height, y entonces la
      // caja colapsa y el logo se solapa con lo que venga detras. Solo funcionaba
      // por casualidad dentro de contenedores flex, que blockifican a sus hijos.
      className={cn(
        "relative inline-block shrink-0 overflow-hidden",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={logo}
        alt={alt}
        className="absolute top-1/2 left-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 dark:invert"
        style={{ width: size * LOGO_SCALE, height: size * LOGO_SCALE }}
      />
    </span>
  );
}
