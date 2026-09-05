import { join } from "node:path";

// Both src/mcp and the bundled dist/mcp entrypoint are two levels below the root.
// Resolve from the module, never the MCP client's working directory.
export const assetRoot = join(import.meta.dir, "..", "..", "assets", "valorant");
