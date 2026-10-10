export function modelSupportsImages(piRuntime: unknown, ref: string | undefined): boolean | undefined {
  if (!ref || ref === "auto") return undefined;
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  const runtime = piRuntime as {
    modelRuntime?: {
      getModel?: (provider: string, id: string) => unknown;
    };
  };
  const model = runtime.modelRuntime?.getModel?.(ref.slice(0, slash), ref.slice(slash + 1));
  const input = (model as { input?: unknown } | undefined)?.input;
  if (!Array.isArray(input)) return undefined;
  return input.includes("image");
}
