import {
  Aperture,
  Camera,
  Cpu,
  Crosshair,
  Pause,
  Play,
  Radio,
} from "lucide-react";
import { PIPELINE, PARTS, PART_MAP } from "@/lib/guide/catalog";
import { LOCK_LABEL, useGuide } from "@/lib/guide/store";
import { MODES, type BuildView, type CamView } from "@/lib/guide/types";

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="flex items-baseline justify-between font-mono text-2xs uppercase tracking-[0.16em] text-muted">
        {label}
        <span className="tabular-nums text-fg">{display}</span>
      </span>
      <input
        className="hud-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const min = Math.min(...values, 0);
  const span = Math.max(0.001, max - min);
  const d = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * 120;
      const y = 28 - ((v - min) / span) * 24;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 120 32" className="h-8 w-full text-lock" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MotorBars({ motors }: { motors: [number, number, number, number] }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {motors.map((v, i) => (
        <div key={i} className="flex h-14 flex-col justify-end gap-1">
          <div className="relative h-full overflow-hidden rounded-xs bg-elevated">
            <div
              className="absolute inset-x-0 bottom-0 bg-accent"
              style={{ height: `${Math.round(v * 100)}%` }}
            />
          </div>
          <span className="text-center font-mono text-2xs tabular-nums text-muted">
            M{i + 1}
          </span>
        </div>
      ))}
    </div>
  );
}

function PidBars({ p, i, d }: { p: number; i: number; d: number }) {
  const rows = [
    { k: "P", v: p },
    { k: "I", v: i },
    { k: "D", v: d },
  ];
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.k} className="flex items-center gap-2">
          <span className="w-4 font-mono text-2xs text-muted">{r.k}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
            <div
              className="h-full bg-lock"
              style={{ width: `${Math.round(Math.min(1, r.v) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Overlay() {
  const mode = useGuide((s) => s.mode);
  const setMode = useGuide((s) => s.setMode);
  const selected = useGuide((s) => s.selected);
  const hovered = useGuide((s) => s.hovered);
  const setSelected = useGuide((s) => s.setSelected);
  const explode = useGuide((s) => s.explode);
  const setExplode = useGuide((s) => s.setExplode);
  const shell = useGuide((s) => s.shell);
  const setShell = useGuide((s) => s.setShell);
  const rpm = useGuide((s) => s.rpm);
  const setRpm = useGuide((s) => s.setRpm);
  const cutaway = useGuide((s) => s.cutaway);
  const toggleCutaway = useGuide((s) => s.toggleCutaway);
  const paused = useGuide((s) => s.paused);
  const togglePaused = useGuide((s) => s.togglePaused);
  const touring = useGuide((s) => s.touring);
  const toggleTour = useGuide((s) => s.toggleTour);
  const camView = useGuide((s) => s.camView);
  const setCamView = useGuide((s) => s.setCamView);
  const buildView = useGuide((s) => s.buildView);
  const setBuildView = useGuide((s) => s.setBuildView);
  const standoff = useGuide((s) => s.standoff);
  const setStandoff = useGuide((s) => s.setStandoff);
  const altitude = useGuide((s) => s.altitude);
  const setAltitude = useGuide((s) => s.setAltitude);
  const tightness = useGuide((s) => s.tightness);
  const setTightness = useGuide((s) => s.setTightness);
  const tel = useGuide((s) => s.telemetry);
  const hist = useGuide((s) => s.rangeHist);

  const activeId = selected ?? hovered;
  const part = activeId ? PART_MAP[activeId] : undefined;
  const lockTone =
    tel.lock === "track"
      ? "text-lock"
      : tel.lock === "lost"
        ? "text-alert"
        : tel.lock === "acquire"
          ? "text-warn"
          : "text-muted";
  const showPip = (mode === "vision" || mode === "pursuit") && camView !== "fpv";

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col text-fg">
      <header className="pointer-events-auto flex items-start justify-between gap-3 p-3 md:p-5">
        <div className="min-w-0">
          <p className="font-mono text-2xs uppercase tracking-[0.28em] text-muted">
            Horizon Vision · HV-1
          </p>
          <h1 className="mt-1 font-sans text-xl font-medium tracking-tight md:text-2xl">
            Vision Quest
          </h1>
          <p className="mt-0.5 hidden max-w-sm text-xs text-muted sm:block">
            {buildView === "finished"
              ? "Finished airframe · camera FSD · Jetson Orin"
              : "Skeleton · PX4 + Orin + dedicated vision camera"}
          </p>
          <div className="mt-2 flex gap-1" role="group" aria-label="Build">
            {(["skeleton", "finished"] as BuildView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setBuildView(v)}
                className={
                  "min-h-9 rounded-sm px-2.5 py-1.5 font-mono text-2xs uppercase tracking-[0.14em] " +
                  (buildView === v ? "bg-fg text-accent-fg" : "bg-surface text-muted hover:text-fg")
                }
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <nav
          className="flex max-w-[70%] flex-wrap justify-end gap-1"
          aria-label="Guide modes"
        >
          {MODES.map((m) => {
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={
                  "min-h-11 rounded-sm px-2.5 py-2 font-mono text-2xs uppercase tracking-[0.14em] transition-colors duration-150 " +
                  (on
                    ? "bg-fg text-accent-fg"
                    : "bg-surface text-muted hover:text-fg")
                }
              >
                {m.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="pointer-events-auto hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto p-4 pt-0 md:flex">
          <p className="mb-2 font-mono text-2xs uppercase tracking-[0.18em] text-subtle">
            Assembly
          </p>
          {PARTS.map((p) => {
            const on = selected === p.id;
            const hot = hovered === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(on ? null : p.id)}
                className={
                  "rounded-md px-3 py-2 text-left transition-colors duration-150 " +
                  (on
                    ? "bg-elevated text-fg shadow-panel"
                    : hot
                      ? "bg-surface text-fg"
                      : "text-muted hover:text-fg")
                }
              >
                <span className="block font-mono text-2xs uppercase tracking-[0.14em] text-subtle">
                  {p.group}
                </span>
                <span className="block text-sm">{p.name}</span>
              </button>
            );
          })}
        </aside>

        <div className="relative min-w-0 flex-1">
          {showPip && (
            <div className="pip-frame pointer-events-none absolute bottom-3 left-3 hidden aspect-video w-[min(300px,26vw)] md:block">
              {tel.bbox && (
                <div
                  className="absolute border border-lock"
                  style={{
                    left: `${Math.round(tel.bbox.nx * 100)}%`,
                    top: `${Math.round(tel.bbox.ny * 100)}%`,
                    width: `${Math.round(tel.bbox.nw * 100)}%`,
                    height: `${Math.round(tel.bbox.nh * 100)}%`,
                  }}
                />
              )}
              <div className="absolute inset-x-2 top-2 flex items-center justify-between font-mono text-2xs uppercase tracking-[0.14em] text-lock">
                <span className="flex items-center gap-1">
                  <Aperture className="size-3" />
                  CAM0 · GS
                </span>
                <span className={lockTone}>{LOCK_LABEL[tel.lock]}</span>
              </div>
            </div>
          )}
        </div>

        <aside className="pointer-events-auto hidden w-[22rem] shrink-0 flex-col gap-4 overflow-y-auto p-4 pt-0 lg:flex">
          <div className="hud-panel rounded-xl p-4">
            {part ? (
              <>
                <p className="font-mono text-2xs uppercase tracking-[0.18em] text-subtle">
                  {part.group}
                </p>
                <h2 className="mt-1 text-lg font-medium tracking-tight">{part.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{part.summary}</p>
                <p className="mt-3 text-sm leading-relaxed text-fg/90">
                  <span className="font-mono text-2xs uppercase tracking-[0.16em] text-subtle">
                    In the loop
                  </span>
                  <span className="mt-1 block">{part.fsd}</span>
                </p>
                <dl className="mt-4 grid grid-cols-3 gap-2">
                  {part.specs.map((sp) => (
                    <div key={sp.label} className="rounded-md bg-elevated px-2 py-2">
                      <dt className="font-mono text-2xs uppercase tracking-[0.12em] text-subtle">
                        {sp.label}
                      </dt>
                      <dd className="mt-1 text-xs tabular-nums">{sp.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <>
                <p className="font-mono text-2xs uppercase tracking-[0.18em] text-subtle">
                  Inspect
                </p>
                <h2 className="mt-1 text-lg font-medium tracking-tight">
                  {mode === "pursuit" ? "Vehicle lock" : "Select a part"}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {mode === "pursuit"
                    ? "Orin holds a Kalman track on the selected car — camera only, no LiDAR. Click another vehicle to switch lock."
                    : buildView === "finished"
                      ? "Horizon Vision flight article. Toggle Skeleton to see the PX4 + Orin stack. Real part photos replace this body."
                      : "Hover a part — the name follows the pointer. Click for the spec sheet. Drag to orbit. Press T to tour."}
                </p>
              </>
            )}
          </div>

          {(mode === "vision" || mode === "pursuit") && (
            <div className="hud-panel rounded-xl p-4">
              <p className="font-mono text-2xs uppercase tracking-[0.18em] text-subtle">
                FSD pipeline
              </p>
              <ol className="mt-3 flex flex-col gap-2">
                {PIPELINE.map((step, idx) => {
                  const active = idx <= tel.pipelineStep;
                  const now = idx === tel.pipelineStep;
                  return (
                    <li key={step.id} className="flex gap-3">
                      <span
                        className={
                          "mt-0.5 font-mono text-2xs tabular-nums " +
                          (now ? "text-lock" : active ? "text-fg" : "text-subtle")
                        }
                      >
                        0{idx + 1}
                      </span>
                      <div>
                        <p className={"text-sm " + (now ? "text-lock" : active ? "text-fg" : "text-muted")}>
                          {step.title}
                        </p>
                        <p className="text-xs leading-relaxed text-muted">{step.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {(mode === "controller" || mode === "pursuit") && (
            <div className="hud-panel rounded-xl p-4">
              <p className="mb-3 font-mono text-2xs uppercase tracking-[0.18em] text-subtle">
                Inner loop
              </p>
              <PidBars p={tel.pidP} i={tel.pidI} d={tel.pidD} />
              <p className="mb-2 mt-4 font-mono text-2xs uppercase tracking-[0.18em] text-subtle">
                Mixer
              </p>
              <MotorBars motors={tel.motors} />
              <p className="mt-3 font-mono text-2xs tabular-nums text-muted">
                ATT {tel.loopHz} Hz
              </p>
            </div>
          )}
        </aside>
      </div>

      <footer className="pointer-events-auto p-3 md:p-4">
        <div className="hud-panel flex flex-col gap-3 rounded-xl px-4 py-3 md:flex-row md:items-end md:gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={togglePaused}
              className="flex size-11 items-center justify-center rounded-md bg-elevated text-fg"
              aria-label={paused ? "Play" : "Pause"}
            >
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </button>
            <button
              type="button"
              onClick={toggleTour}
              className={
                "min-h-11 rounded-sm px-3 py-2 font-mono text-2xs uppercase tracking-[0.12em] " +
                (touring ? "bg-fg text-accent-fg" : "text-muted hover:text-fg")
              }
            >
              Tour
            </button>
            {mode === "pursuit" && (
              <div className="flex gap-1">
                {(["chase", "orbit", "fpv"] as CamView[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setCamView(v)}
                    className={
                      "min-h-11 rounded-sm px-2 py-2 font-mono text-2xs uppercase tracking-[0.12em] " +
                      (camView === v ? "bg-fg text-accent-fg" : "text-muted hover:text-fg")
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={toggleCutaway}
              className={
                "hidden min-h-11 rounded-sm px-2 py-2 font-mono text-2xs uppercase tracking-[0.12em] sm:block " +
                (cutaway ? "bg-fg text-accent-fg" : "text-muted hover:text-fg")
              }
            >
              Cutaway
            </button>
          </div>

          {mode === "pursuit" ? (
            <>
              <SliderRow
                label="Standoff"
                value={standoff}
                min={6}
                max={16}
                step={0.1}
                display={`${standoff.toFixed(1)} m`}
                onChange={setStandoff}
              />
              <SliderRow
                label="AGL"
                value={altitude}
                min={4}
                max={14}
                step={0.1}
                display={`${altitude.toFixed(1)} m`}
                onChange={setAltitude}
              />
              <SliderRow
                label="Tightness"
                value={tightness}
                min={0.35}
                max={1.6}
                step={0.01}
                display={tightness.toFixed(2)}
                onChange={setTightness}
              />
            </>
          ) : buildView === "finished" ? (
            <SliderRow
              label="Prop RPM"
              value={rpm}
              min={0}
              max={9000}
              step={50}
              display={`${Math.round(rpm)}`}
              onChange={setRpm}
            />
          ) : (
            <>
              <SliderRow
                label="Explode"
                value={explode}
                min={0}
                max={1}
                step={0.01}
                display={`${Math.round(explode * 100)}%`}
                onChange={setExplode}
              />
              <SliderRow
                label="Shell"
                value={shell}
                min={0.08}
                max={1}
                step={0.01}
                display={`${Math.round(shell * 100)}%`}
                onChange={setShell}
              />
              <SliderRow
                label="Prop RPM"
                value={rpm}
                min={0}
                max={9000}
                step={50}
                display={`${Math.round(rpm)}`}
                onChange={setRpm}
              />
            </>
          )}

          <div className="hidden min-w-40 flex-col gap-1 sm:flex">
            <span className="font-mono text-2xs uppercase tracking-[0.16em] text-muted">
              Range
            </span>
            <Spark values={hist} />
          </div>
        </div>

        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 md:hidden">
          {PARTS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(selected === p.id ? null : p.id)}
              className={
                "min-h-11 shrink-0 rounded-sm px-3 py-2 font-mono text-2xs uppercase tracking-[0.12em] " +
                (selected === p.id ? "bg-fg text-accent-fg" : "bg-surface text-muted")
              }
            >
              {p.name}
            </button>
          ))}
        </div>
      </footer>

      <div className="pointer-events-none absolute right-4 top-24 flex flex-col items-end gap-1 font-mono text-2xs tabular-nums tracking-[0.12em] text-muted md:right-[23.5rem] md:top-28">
        {mode === "pursuit" && (
          <>
            <span className={"flex items-center gap-1.5 " + lockTone}>
              <Crosshair className="size-3" />
              {LOCK_LABEL[tel.lock]} {Math.round(tel.confidence * 100)}%
            </span>
            <span>AGL {tel.alt.toFixed(1)} m</span>
            <span>GS {tel.speed.toFixed(1)} m/s</span>
            <span>RNG {tel.range.toFixed(1)} m</span>
            <span>YAW {tel.yawErr.toFixed(0)}°</span>
            <span className="flex items-center gap-1">
              <Camera className="size-3" /> {tel.fpsDetect} fps
            </span>
          </>
        )}
        {mode === "controller" && (
          <span className="flex items-center gap-1">
            <Cpu className="size-3" /> H7 · {tel.loopHz} Hz
          </span>
        )}
        {mode === "vision" && (
          <span className="flex items-center gap-1">
            <Radio className="size-3" /> ORIN · 40 TOPS
          </span>
        )}
      </div>

      {part && (
        <div className="pointer-events-auto absolute inset-x-3 bottom-[9.5rem] max-h-28 overflow-y-auto rounded-xl hud-panel p-3 lg:hidden">
          <p className="font-mono text-2xs uppercase tracking-[0.16em] text-subtle">
            {part.group}
          </p>
          <p className="text-sm font-medium">{part.name}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{part.summary}</p>
        </div>
      )}
    </div>
  );
}
