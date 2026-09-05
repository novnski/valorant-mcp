import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapTransformFingerprintInput } from "../domain/map-spatial-resources";
import { assetRoot } from "../mcp/paths";

export const projectionDependencies = {
  analysis: "evidence-analysis-v2",
  knowledge: createHash("sha256")
    .update(readFileSync(join(assetRoot, "knowledge.json")))
    .digest("hex"),
  transforms: createHash("sha256").update(mapTransformFingerprintInput()).digest("hex"),
};
export const projectionDependencyFingerprint = createHash("sha256")
  .update(JSON.stringify(projectionDependencies))
  .digest("hex")
  .slice(0, 16);
