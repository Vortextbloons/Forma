import { brandTools } from "./brand.ts";
import { chartTools } from "./chart.ts";
import { designTools } from "./design.ts";
import { diagramTools } from "./diagram.ts";
import { iconTools } from "./icons.ts";
import { loadToolsTool } from "./lazy.ts";
import { materialTools } from "./materials.ts";
import { mathTools } from "./math.ts";
import { projectTools } from "./project.ts";
import { researchTools } from "./research.ts";

export const customTools = [...projectTools, ...materialTools, ...researchTools, ...brandTools, ...chartTools, ...diagramTools, ...iconTools, ...mathTools, ...designTools, loadToolsTool()];
