import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOOP_TRIALS,
  driverSpecs,
  labelsJsonl,
  renderBatch,
  reportTrial,
} from "../src/lib/guide/closed-loop.ts";

const outDir = resolve(process.argv[2] ?? "/tmp/closed-loop");
const only = process.argv.includes("--policy")
  ? process.argv[process.argv.indexOf("--policy") + 1]
  : null;
const policies = only ? [only] : ["legacy", "loop"];
mkdirSync(outDir, { recursive: true });

function plansFor(trial, policy) {
  const dir = resolve(outDir, policy, trial.id);
  mkdirSync(dir, { recursive: true });
  const labels = resolve(dir, "labels.jsonl");
  const drivers = resolve(dir, "drivers.json");
  const output = resolve(dir, "plans.json");
  const states = resolve(dir, "lane_states.jsonl");
  writeFileSync(labels, labelsJsonl(trial, policy));
  writeFileSync(drivers, `${JSON.stringify({ drivers: driverSpecs(trial.cars) }, null, 2)}\n`);
  const run = spawnSync(
    "python3",
    [
      "-m",
      "horizon_vision.hub.bridge",
      "--labels",
      labels,
      "--drivers",
      drivers,
      "--policy",
      policy,
      "--output",
      output,
      "--states",
      states,
    ],
    {
      cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
      env: { ...process.env, PYTHONPATH: "edge/src:hub/src" },
      encoding: "utf8",
    },
  );
  if (run.status !== 0) {
    throw new Error(`${trial.id} ${policy} bridge failed\n${run.stderr || run.stdout}`);
  }
  return JSON.parse(readFileSync(output, "utf8")).plans;
}

const reports = [];
for (const policy of policies) {
  for (const trial of LOOP_TRIALS) {
    process.stderr.write(`${policy} ${trial.id}\n`);
    const plans = plansFor(trial, policy);
    reports.push(reportTrial(trial, policy, plans));
  }
}

const markdown = renderBatch(reports);
writeFileSync(resolve(outDir, "report.md"), `${markdown}\n`);
writeFileSync(resolve(outDir, "report.json"), `${JSON.stringify(reports, null, 2)}\n`);
process.stdout.write(`${markdown}\n`);
const loop = reports.filter((row) => row.policy === "loop");
const failed = loop.filter((row) => !row.pass).length;
process.stderr.write(`\nWrote ${resolve(outDir, "report.md")}\n`);
process.exit(failed === 0 || policies.includes("legacy") ? 0 : 1);
