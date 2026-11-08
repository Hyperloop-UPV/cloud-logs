// Icono de Hyperloop UPV Software.
//
// Trazo negro sobre transparencia, invertido en modo oscuro. No se usa
// software_white.png: son 8000 px y 427 KB para un PNG monocromo con alfa que un
// filtro CSS resuelve igual de bien.

import softwareLogo from "@hyperloopupv/frontend-kit/outreach/main/software_black.png";
import { cn } from "@hyperloopupv/frontend-kit/lib";

interface SoftwareMarkProps {
  className?: string;
  alt?: string;
}

export function SoftwareMark({
  className,
  alt = "Hyperloop UPV Software",
}: SoftwareMarkProps) {
  return (
    <img
      src={softwareLogo}
      alt={alt}
      className={cn("object-contain dark:invert", className)}
    />
  );
}
