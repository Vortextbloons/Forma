export interface EffectiveSize {
  width: number;
  height: number;
  unit: "px" | "mm" | "in";
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
