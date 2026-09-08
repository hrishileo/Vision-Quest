import { Ban, CircleAlert, CircleCheck } from "lucide-react";
import {
  BUILD_STEPS,
  FIT_CHECKS,
  FIT_SUMMARY,
  stepReady,
  type FitCheck as FitRow,
  type FitStatus,
} from "@/lib/fit";
import { ITEMS } from "@/lib/bom";
import { useKit } from "@/lib/kit-store";

const NAME = Object.fromEntries(ITEMS.map((i) => [i.id, i.name]));

const TONE: Record<FitStatus, string> = {
  pass: "text-lock",
  watch: "text-warn",
  block: "text-alert",
};

const LABEL: Record<FitStatus, string> = {
  pass: "Fits",
  watch: "Watch",
  block: "Block",
};

export function FitCheck() {
  const owned = useKit((s) => s.owned);
  const { pass, watch, block, total } = FIT_SUMMARY;
  const blockers = FIT_CHECKS.filter((c) => c.status === "block");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Score k="Checked" v={`${total}`} />
        <Score k="Fits" v={`${pass}`} tone="text-lock" />
        <Score k="Watch" v={`${watch}`} tone="text-warn" />
        <Score k="Block" v={`${block}`} tone="text-alert" />
      </div>

      {blockers.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          Nothing in this kit physically refuses to assemble. The watch items are
          the ones that strand a build: CSI pin count, the JR bay module, XT90 vs
          XT60, and whether the detector sits rigid or on the gimbal. Work those
          before you click Buy.
        </p>
      ) : (
        <p className="text-sm leading-relaxed text-alert">
          {blockers.length} interface{blockers.length === 1 ? "" : "s"} will not
          go together. Fix those before ordering.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {FIT_CHECKS.map((row) => (
          <FitCard key={row.id} row={row} />
        ))}
      </ul>

      <p className="font-mono text-2xs uppercase tracking-[0.16em] text-subtle">
        {owned.length} of {ITEMS.length} parts marked in crate
      </p>
    </div>
  );
}

function Score({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3">
      <p className="font-mono text-2xs uppercase tracking-[0.16em] text-subtle">{k}</p>
      <p className={"mt-1 font-mono text-lg tabular-nums " + (tone ?? "text-fg")}>{v}</p>
    </div>
  );
}

function FitCard({ row }: { row: FitRow }) {
  const Icon =
    row.status === "pass" ? CircleCheck : row.status === "watch" ? CircleAlert : Ban;
  return (
    <li className="rounded-xl bg-surface p-4">
      <div className="flex items-start gap-3">
        <Icon className={"mt-0.5 size-4 shrink-0 " + TONE[row.status]} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium text-fg">{row.title}</h3>
            <span
              className={
                "font-mono text-2xs uppercase tracking-[0.14em] " + TONE[row.status]
              }
            >
              {LABEL[row.status]}
            </span>
          </div>
          <p className="mt-1 font-mono text-2xs uppercase tracking-[0.12em] text-subtle">
            {row.a} · {row.b}
          </p>
          <p className="mt-2 font-mono text-2xs tabular-nums text-muted">{row.metric}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{row.rule}</p>
          <p className="mt-2 text-sm leading-relaxed text-fg">{row.action}</p>
        </div>
      </div>
    </li>
  );
}

export function BuildOrder() {
  const owned = useKit((s) => s.owned);
  const done = useKit((s) => s.buildDone);
  const toggle = useKit((s) => s.toggleBuild);
  const finished = done.length;
  const total = BUILD_STEPS.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          Print, dry-fit, then power. Tick a step when it is on the bench. Parts
          you marked Have in the price list light up as in crate.
        </p>
        <p className="font-mono text-sm tabular-nums text-fg">
          {finished}/{total} steps
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {BUILD_STEPS.map((step) => {
          const on = done.includes(step.id);
          const ready = stepReady(step, owned);
          const have = step.parts.filter((id) => owned.includes(id)).length;
          return (
            <li key={step.id} className="rounded-xl bg-surface p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(step.id)}
                  className="mt-1 size-4 accent-lock"
                  aria-label={step.title}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-fg">
                      <span className="font-mono text-2xs tabular-nums text-subtle">
                        {String(step.n).padStart(2, "0")}
                      </span>{" "}
                      {step.title}
                    </span>
                    <span className="font-mono text-2xs uppercase tracking-[0.12em] text-subtle">
                      {ready ? "In crate" : `${have}/${step.parts.length} parts`}
                    </span>
                  </span>
                  <span className="mt-2 block text-sm leading-relaxed text-muted">
                    {step.body}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {step.parts.map((id) => (
                      <span
                        key={id}
                        className={
                          "rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-[0.1em] " +
                          (owned.includes(id)
                            ? "bg-elevated text-lock"
                            : "bg-elevated text-subtle")
                        }
                      >
                        {NAME[id] ?? id}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ol>
    </div>
  );
}