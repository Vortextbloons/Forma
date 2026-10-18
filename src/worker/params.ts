import { ProtocolError } from "rig";

export function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError(`Missing or invalid parameter "${name}" (expected non-empty string)`);
  }
  return value;
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
