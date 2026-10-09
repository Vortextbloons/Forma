




import type { Artifact, RigEvent } from "../types";

type ArtifactRow = Artifact & { sessionId: string };

let artifacts = $state<ArtifactRow[]>([]);

export function bySession(sessionId: string): Artifact[] {
  return artifacts.filter((a) => a.sessionId === sessionId);
}

export function handleEvent(event: RigEvent): void {
  if (event.type !== "artifact.emitted") return;
  if (artifacts.some((a) => a.id === event.data.artifact.id)) return;
  artifacts.push({ ...event.data.artifact, sessionId: event.sessionId });
}

export const artifactStore = {
  bySession,
  handleEvent,
};
