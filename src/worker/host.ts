import {
  CancellationError,
  InteractionError,
  createLogger,
  type AgentHost,
  type HostInteraction,
} from "rig";
import type { RigEventBus } from "rig/events";

type RigLogger = ReturnType<typeof createLogger>;

type InteractionResultMap = {
  question: string | string[];
  confirmation: boolean;
  approval: { decision: "allow" | "deny"; scope: "once" | "session" };
};

interface PendingInteraction {
  interaction: HostInteraction;
  resolve: (result: InteractionResultMap[HostInteraction["kind"]]) => void;
  reject: (error: unknown) => void;
}

export class WorkerAgentHost implements AgentHost {
  readonly #bus: RigEventBus;
  readonly #logger: RigLogger;
  readonly #pending = new Map<string, PendingInteraction>();

  constructor(options: { bus: RigEventBus; logger: RigLogger }) {
    this.#bus = options.bus;
    this.#logger = options.logger;
  }

  async requestInteraction<K extends HostInteraction["kind"]>(
    interaction: Extract<HostInteraction, { kind: K }>,
  ): Promise<InteractionResultMap[K]> {
    const pending: PendingInteraction = {
      interaction,
      resolve: () => undefined,
      reject: () => undefined,
    };
    this.#pending.set(interaction.id, pending);
    this.#bus.post("interaction.requested", { interaction }, { sessionId: interaction.sessionId });
    this.#logger.debug(`[host] interaction requested ${interaction.id} (${interaction.kind})`);
    return new Promise<InteractionResultMap[K]>((resolve, reject) => {
      pending.resolve = resolve as PendingInteraction["resolve"];
      pending.reject = reject as PendingInteraction["reject"];
    });
  }

  resolve(
    interactionId: string,
    kind: HostInteraction["kind"],
    result: unknown,
  ): InteractionResultMap[HostInteraction["kind"]] {
    const pending = this.#pending.get(interactionId);
    if (!pending) {
      throw new InteractionError(`Unknown interaction "${interactionId}"`, {
        details: { interactionId },
      });
    }
    if (pending.interaction.kind !== kind) {
      throw new InteractionError(
        `Interaction "${interactionId}" is kind "${pending.interaction.kind}", got "${kind}"`,
        { details: { interactionId } },
      );
    }
    const normalized = normalizeResult(kind, result);
    this.#pending.delete(interactionId);
    this.#bus.post(
      "interaction.resolved",
      { interactionId, kind, result: normalized },
      { sessionId: pending.interaction.sessionId },
    );
    pending.resolve(normalized);
    return normalized;
  }

  rejectAll(error: unknown): void {
    for (const pending of [...this.#pending.values()]) {
      this.#pending.delete(pending.interaction.id);
      pending.reject(error);
    }
  }

  pendingForSession(sessionId: string): Array<{ id: string; kind: string; summary: string }> {
    const out: Array<{ id: string; kind: string; summary: string }> = [];
    for (const pending of this.#pending.values()) {
      if (pending.interaction.sessionId !== sessionId) continue;
      out.push({
        id: pending.interaction.id,
        kind: pending.interaction.kind,
        summary: interactionSummary(pending.interaction),
      });
    }
    return out;
  }

  hasPendingForSession(sessionId: string): boolean {
    for (const pending of this.#pending.values()) {
      if (pending.interaction.sessionId === sessionId) return true;
    }
    return false;
  }

  emitArtifact(): Promise<void> {
    return Promise.resolve();
  }
}

function interactionSummary(interaction: HostInteraction): string {
  switch (interaction.kind) {
    case "question":
      return interaction.question;
    case "confirmation":
      return interaction.title;
    case "approval":
      return interaction.toolName;
  }
}

export function normalizeResult(
  kind: HostInteraction["kind"],
  result: unknown,
): InteractionResultMap[HostInteraction["kind"]] {
  switch (kind) {
    case "question": {
      if (typeof result === "string") return result;
      if (Array.isArray(result) && result.every((item) => typeof item === "string")) {
        return result as string[];
      }
      throw new InteractionError("question interaction result must be a string or string[]", {
        details: { result },
      });
    }
    case "confirmation":
      if (typeof result === "boolean") return result;
      throw new InteractionError("confirmation interaction result must be a boolean", {
        details: { result },
      });
    case "approval": {
      const r = result as { decision?: unknown; scope?: unknown };
      if (r?.decision === "allow" || r?.decision === "deny") {
        const scope = r.scope === "session" ? "session" : "once";
        return { decision: r.decision, scope };
      }
      throw new InteractionError(
        'approval interaction result must be {decision: "allow"|"deny", scope: "once"|"session"}',
        { details: { result } },
      );
    }
  }
}

export function isCancellation(error: unknown): boolean {
  return (
    error instanceof CancellationError || (error instanceof Error && error.name === "AbortError")
  );
}
