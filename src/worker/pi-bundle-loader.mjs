import * as nodeModule from "node:module";
import { existsSync } from "node:fs";

const piBundle = new URL(
  "../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js",
  import.meta.url,
);

if (existsSync(piBundle)) {
  nodeModule.registerHooks?.({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@earendil-works/pi-coding-agent") {
        return { url: piBundle.href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}
