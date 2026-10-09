




import type { RigEvent, TodoItem } from "../types";

interface TodoRow extends TodoItem {
  sessionId: string;
}

let todos = $state<TodoRow[]>([]);

export function bySession(sessionId: string): TodoItem[] {
  return todos.filter((t) => t.sessionId === sessionId);
}

export function compactFor(sessionId: string, max: number): TodoItem[] {
  return todos.filter((t) => t.sessionId === sessionId).slice(0, max);
}

export function counts(sessionId: string): { total: number; completed: number } {
  let total = 0;
  let completed = 0;
  for (const t of todos) {
    if (t.sessionId !== sessionId) continue;
    total += 1;
    if (t.status === "completed") completed += 1;
  }
  return { total, completed };
}

export function handleEvent(event: RigEvent): void {
  if (event.type !== "todo.updated") return;
  const sessionId = event.sessionId;

  for (let i = todos.length - 1; i >= 0; i -= 1) {
    if (todos[i]!.sessionId === sessionId) todos.splice(i, 1);
  }
  for (const item of event.data.todos) {
    todos.push({ sessionId, ...item });
  }
}

export const todoStore = {
  bySession,
  compactFor,
  counts,
  handleEvent,
};
