/**
 * Headless CAM0 corpus for the edge detector.
 *
 * Renders each sequence with the pursuit recorder (WebGL, offscreen target),
 * writes YOLO images/labels split by sequence, and keeps the recorder JSONL
 * beside them so the edge can score detections against the same poses.
 *
 *   node --experimental-strip-types scripts/record-corpus.ts --out data/yolo
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { frameToYolo, framesToJsonl, validateFrame, type CorpusFrame } from "../src/lib/guide/corpus.ts";
import {
  SEQUENCES,
  sequencesBySplit,
  type RecordedSequence,
  type SequenceSpec,
} from "../src/lib/guide/corpus-sequences.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Args = {
  out: string;
  sample: string;
  only: string[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    out: join(repoRoot, "data/yolo"),
    sample: join(repoRoot, "edge/detector/sample"),
    only: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--out" && next) {
      args.out = resolve(next);
      i += 1;
    } else if (flag === "--sample" && next) {
      args.sample = resolve(next);
      i += 1;
    } else if (flag === "--only" && next) {
      args.only = next.split(",").filter(Boolean);
      i += 1;
    } else if (flag === "--help") {
      console.log("record-corpus.ts --out data/yolo --sample edge/detector/sample [--only id,id]");
      process.exit(0);
    }
  }
  return args;
}

function startDev(): Promise<{ url: string; stop: () => void }> {
  return new Promise((resolveReady, reject) => {
    const child = spawn("npm", ["run", "dev"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let buf = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`vite did not print a URL\n${buf.slice(-2000)}`));
    }, 90_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      buf += text;
      process.stdout.write(text);
      const match = buf.match(/Local:\s+http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      const port = match[1];
      resolveReady({
        url: `http://127.0.0.1:${port}/`,
        stop: () => {
          child.kill("SIGTERM");
        },
      });
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`vite exited ${code}\n${buf.slice(-2000)}`));
      }
    });
  });
}

async function openPage(url: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (err) => console.error("pageerror", err));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => typeof window.__corpus?.record === "function", null, {
    timeout: 120_000,
  });
  return { browser, page };
}

function writeSequence(out: string, recorded: RecordedSequence, spec: SequenceSpec) {
  const root = join(out, "sequences", spec.id);
  mkdirSync(join(root, "images"), { recursive: true });
  mkdirSync(join(root, "labels"), { recursive: true });
  const splitImages = join(out, "images", spec.split);
  const splitLabels = join(out, "labels", spec.split);
  mkdirSync(splitImages, { recursive: true });
  mkdirSync(splitLabels, { recursive: true });
  recorded.frames.forEach((frame, i) => {
    const errors = validateFrame(frame);
    if (errors.length) throw new Error(`${spec.id} frame ${i}: ${errors.join(", ")}`);
    const png = Buffer.from(recorded.pngs[i] ?? "", "base64");
    if (png.length < 32) throw new Error(`${spec.id} frame ${i} png is empty`);
    const stem = String(frame.index).padStart(6, "0");
    writeFileSync(join(root, "images", `${stem}.png`), png);
    const yolo = frameToYolo(frame);
    writeFileSync(join(root, "labels", `${stem}.txt`), yolo);
    const flat = `${spec.id}_${stem}`;
    writeFileSync(join(splitImages, `${flat}.png`), png);
    writeFileSync(join(splitLabels, `${flat}.txt`), yolo);
  });
  writeFileSync(join(root, "labels.jsonl"), framesToJsonl(recorded.frames));
  writeFileSync(join(root, "meta.json"), JSON.stringify(spec, null, 2));
}

function writeYaml(out: string) {
  const split = sequencesBySplit();
  const yaml = `# CAM0 ground truth. Classes match the recorder: 0 vehicle, 1 unknown (debris/blockade).
path: ${out}
train: images/train
val: images/val
test: images/test
names:
  0: vehicle
  1: unknown
`;
  writeFileSync(join(out, "data.yaml"), yaml);
  writeFileSync(
    join(out, "split.json"),
    JSON.stringify(
      {
        unit: "sequence",
        train: split.train.map((seq) => seq.id),
        val: split.val.map((seq) => seq.id),
        test: split.test.map((seq) => seq.id),
      },
      null,
      2,
    ),
  );
}

function writeSample(sampleDir: string, recorded: RecordedSequence) {
  rmSync(sampleDir, { recursive: true, force: true });
  mkdirSync(join(sampleDir, "images"), { recursive: true });
  mkdirSync(join(sampleDir, "labels"), { recursive: true });
  const keep = recorded.frames.slice(0, 2);
  keep.forEach((frame, i) => {
    const stem = String(frame.index).padStart(6, "0");
    writeFileSync(join(sampleDir, "images", `${stem}.png`), Buffer.from(recorded.pngs[i] ?? "", "base64"));
    writeFileSync(join(sampleDir, "labels", `${stem}.txt`), frameToYolo(frame));
  });
  writeFileSync(join(sampleDir, "labels.jsonl"), framesToJsonl(keep));
  writeFileSync(
    join(sampleDir, "data.yaml"),
    "path: .\ntrain: images\nval: images\nnames:\n  0: vehicle\n  1: unknown\n",
  );
  const counts = keep.map((frame) => frame.objects.length);
  writeFileSync(
    join(sampleDir, "README.md"),
    `# CAM0 sample\n\nTwo frames from \`${recorded.id}\`, cut from the headless training corpus. Full runs live in \`data/yolo/\` and are not committed.\n\nBoxes in these frames: ${counts.join(", ")}.\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const append = args.only.length > 0;
  const wanted = append
    ? SEQUENCES.filter((seq) => args.only.includes(seq.id))
    : [...SEQUENCES];
  if (wanted.length === 0) throw new Error("no sequences selected");
  if (!append) rmSync(args.out, { recursive: true, force: true });
  mkdirSync(args.out, { recursive: true });
  writeYaml(args.out);

  const dev = await startDev();
  let browser: Browser | null = null;
  try {
    const opened = await openPage(dev.url);
    browser = opened.browser;
    let sample: RecordedSequence | null = null;
    for (const spec of wanted) {
      console.log(`recording ${spec.id} (${spec.split}, ${spec.timeOfDay}, density ${spec.density})`);
      let recorded: { frames: CorpusFrame[]; pngs: string[] } | null = null;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await opened.page.waitForFunction(() => typeof window.__corpus?.record === "function", null, {
            timeout: 120_000,
          });
          recorded = await opened.page.evaluate(async (sequence) => {
            const api = window.__corpus;
            if (!api) throw new Error("recorder missing");
            return api.record(sequence);
          }, spec);
          break;
        } catch (err) {
          lastError = err;
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("context was destroyed") || attempt === 2) throw err;
          console.log(`  navigation during ${spec.id}, retrying`);
          await opened.page.waitForLoadState("domcontentloaded");
        }
      }
      if (!recorded) throw lastError;
      const frames = recorded.frames as CorpusFrame[];
      const typed: RecordedSequence = { id: spec.id, frames, pngs: recorded.pngs };
      writeSequence(args.out, typed, spec);
      const boxes = frames.reduce((n, frame) => n + frame.objects.length, 0);
      console.log(`  ${frames.length} frames, ${boxes} boxes`);
      if (!sample && spec.split === "train") sample = typed;
    }
    if (sample && !append) writeSample(args.sample, sample);
  } finally {
    await browser?.close();
    dev.stop();
  }
  console.log(`wrote ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
