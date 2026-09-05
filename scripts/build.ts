import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
await rm(join(root, "dist"), { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [join(root, "src/mcp/server.ts")],
  outdir: join(root, "dist/mcp"),
  target: "bun",
  external: ["@napi-rs/canvas"],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await chmod(join(root, "dist/mcp/server.js"), 0o755);
console.error("Built dist/mcp/server.js");
