import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderDetourSummary, runDetourStudy } from "../src/lib/guide/detour.ts";

const outDir = resolve(process.argv[2] ?? "/tmp/detour-study");
const study = runDetourStudy();
mkdirSync(outDir, { recursive: true });
const jsonPath = resolve(outDir, "detour-results.json");
const mdPath = resolve(outDir, "detour-summary.md");
writeFileSync(jsonPath, `${JSON.stringify(study, null, 2)}\n`);
writeFileSync(mdPath, renderDetourSummary(study));
console.log(renderDetourSummary(study));
console.log(`\nWrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
