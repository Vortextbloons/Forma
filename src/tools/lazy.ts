import { z } from "zod";
import { RuntimeError, type RigTool } from "rig";

export const TOOL_GROUPS = {
  research: ["research", "read_url"],
  photos: ["find_photos", "import_photo"],
  brands: ["find_brand_icon", "import_brand_icon"],
  charts: ["create_chart"],
  diagrams: ["create_diagram"],
  icons: ["find_icon", "import_icon"],
  math: ["render_math"],
} as const;

export type ToolGroupName = keyof typeof TOOL_GROUPS;

const DEFERRED_TOOL_NAMES = new Set<string>(Object.values(TOOL_GROUPS).flat());

const loadToolsInput = z.object({
  group: z.enum(["research", "photos", "brands", "charts", "diagrams", "icons", "math"]).describe("Specialist tool group to load"),
});

interface LazySession {
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
  getAllTools(): Array<{ name: string }>;
  agent: { state: { tools: Array<{ name: string }> } };
}

const lazySessions = new Map<string, LazySession>();
const sessionGroups = new Map<string, Set<ToolGroupName>>();
const preparedSessions = new WeakSet<object>();

export function prepareSessionTools(handle: { id: string; piSession?: unknown }): void {
  const session = handle.piSession as LazySession | undefined;
  if (!session) return;
  lazySessions.set(handle.id, session);
  if (preparedSessions.has(session)) return;
  preparedSessions.add(session);
  sessionGroups.delete(handle.id);
  session.setActiveToolsByName(
    session.getActiveToolNames().filter((name) => !DEFERRED_TOOL_NAMES.has(name)),
  );
}

export function loadedGroupTools(sessionId: string): string[] {
  const groups = sessionGroups.get(sessionId);
  if (!groups) return [];
  return [...groups].flatMap((group) => [...TOOL_GROUPS[group]]);
}

export function clearSessionTools(): void {
  lazySessions.clear();
  sessionGroups.clear();
}

export function loadToolsTool(): RigTool<typeof loadToolsInput, unknown> {
  return {
    name: "load_tools",
    description:
      'Load specialist tools for this session. Groups: "research" (research, read_url) for web search and reading pages, "photos" (find_photos, import_photo) for stock photo search and import, "brands" (find_brand_icon, import_brand_icon) for brand icon lookup and import, "charts" (create_chart) for data chart rendering, "diagrams" (create_diagram) for Mermaid diagram rendering, "icons" (find_icon, import_icon) for Lucide UI icon lookup and import, "math" (render_math) for LaTeX math rendering. Load a group before using its tools; loading again changes nothing and loaded tools stay available for the session.',
    input: loadToolsInput,
    async execute(input, ctx) {
      const session = lazySessions.get(ctx.session.id);
      if (!session) {
        throw new RuntimeError("Tool loading is unavailable in this session.");
      }
      const tools = TOOL_GROUPS[input.group];
      const active = session.getActiveToolNames();
      const added = tools.filter((name) => !active.includes(name));
      if (added.length > 0) {
        const registered = new Set(session.getAllTools().map((tool) => tool.name));
        const appended = session.agent.state.tools.filter((tool) => !registered.has(tool.name));
        session.setActiveToolsByName([...active, ...added]);
        if (appended.length > 0) {
          session.agent.state.tools = [...session.agent.state.tools, ...appended];
        }
      }
      let groups = sessionGroups.get(ctx.session.id);
      if (!groups) {
        groups = new Set<ToolGroupName>();
        sessionGroups.set(ctx.session.id, groups);
      }
      groups.add(input.group);
      return { group: input.group, tools: [...tools], added };
    },
  };
}
