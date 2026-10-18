export interface EffectiveSize {
  width: number;
  height: number;
  unit: "px" | "mm" | "in";
}

export function cssPixelSize(size: EffectiveSize): { width: number; height: number } {
  const factor = size.unit === "mm" ? 96 / 25.4 : size.unit === "in" ? 96 : 1;
  return {
    width: Math.round(size.width * factor),
    height: Math.round(size.height * factor),
  };
}

export interface SizeInput {
  output: "slides" | "poster";
  slideSize: { width: number; height: number };
  posterSize: { preset: string; width: number; height: number; unit: "px" | "mm" | "in" };
  orientation: "portrait" | "landscape";
}

export function effectiveSize(settings: SizeInput): EffectiveSize {
  if (settings.output === "slides") {
    return {
      width: settings.slideSize.width,
      height: settings.slideSize.height,
      unit: "px",
    };
  }
  const size = settings.posterSize;
  if (size.preset === "custom" || settings.orientation === "portrait") {
    return { width: size.width, height: size.height, unit: size.unit };
  }
  return { width: size.height, height: size.width, unit: size.unit };
}
