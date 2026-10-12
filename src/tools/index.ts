import { brandTools } from "./brand.ts";
import { chartTools } from "./chart.ts";
import { designTools } from "./design.ts";
import { loadToolsTool } from "./lazy.ts";
import { projectTools } from "./project.ts";
import { researchTools } from "./research.ts";

export const customTools = [...projectTools, ...researchTools, ...brandTools, ...chartTools, ...designTools, loadToolsTool()];
