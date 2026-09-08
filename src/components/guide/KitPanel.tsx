import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Search } from "lucide-react";
import {
  AIRFRAME,
  CORE_TOTAL,
  FULL_TOTAL,
  GROUPS,
  ITEMS,
  PRINT_ITEMS,
  TIERS,
  kitCsv,
  kitTotal,
  lineTotal,
  originOf,
  type BomItem,
  type Origin,
} from "@/lib/bom";
import { cadFor } from "@/lib/cad";
import { CadSheet } from "@/components/guide/CadSheet";
import { BuildOrder, FitCheck } from "@/components/guide/FitCheck";
import { useKit, type KitTab } from "@/lib/kit-store";
import { usd } from "@/lib/utils";
import { FIT_SUMMARY } from "@/lib/fit";

const ORIGIN_LABEL: Record<Origin, string> = {
  buy: "Buy",
  print: "Print",
  machine: "Machine",
  included: "Incl.",
};

const TABS: { id: KitTab; label: string }[] = [
  { id: "list", label: "Price list" },
  { id: "fit", label: "Fit check" },
  { id: "build", label: "Build order" },
];

function downloadCsv(items: BomItem[]) {
  const blob = new Blob([kitCsv(items)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "HV-1-OSPREY-kit.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function KitPanel() {
  const query = useKit((s) => s.query);
  const setQuery = useKit((s) => s.setQuery);
  const group = useKit((s) => s.group);
  const setGroup = useKit((s) => s.setGroup);
  const tier = useKit((s) => s.tier);
  const setTier = useKit((s) => s.setTier);
  const owned = useKit((s) => s.owned);
  const toggleOwned = useKit((s) => s.toggleOwned);
  const hideOwned = useKit((s) => s.hideOwned);
  const setHideOwned = useKit((s) => s.setHideOwned);
  const tab = useKit((s) => s.tab);
  const setTab = useKit((s) => s.setTab);
  const [openCad, setOpenCad] = useState<string | null>(null);

  useEffect(() => {
    void useKit.persist.rehydrate();
    useKit.getState().markHydrated();
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ITEMS.filter((item) => {
      if (group !== "all" && item.group !== group) return false;
      if (tier !== "all" && item.tier !== tier) return false;
      if (hideOwned && owned.includes(item.id)) return false;
      if (!q) return true;
      const hay = `${item.name} ${item.sku} ${item.brand} ${item.vendor} ${item.group}`.toLowerCase();
      return hay.includes(q);
    });
  }, [group, hideOwned, owned, query, tier]);

  const remaining = kitTotal(ITEMS.filter((i) => !owned.includes(i.id)));
  const haveN = owned.length;

  return (
    <section className="pointer-events-auto flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto bg-bg px-3 pb-8 pt-2 md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-2xs uppercase tracking-[0.22em] text-subtle">
              {AIRFRAME.program} · {AIRFRAME.layout}
            </p>
            <h2 className="mt-1 font-sans text-xl font-medium tracking-tight md:text-2xl">
              Real kit
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
              {tab === "fit"
                ? "Mounts, voltages, pin counts, and clearances — whether this cart actually bolts together."
                : tab === "build"
                  ? "Print, dry-fit, power, then props. Tick each step on the bench."
                  : "Parts that build the Finished airframe. Buy the SKUs, print the fittings, tick Have as they land."}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <Stat k="Article" v={usd(CORE_TOTAL)} />
            <Stat k="With spares" v={usd(FULL_TOTAL)} />
            <Stat k="Still to buy" v={usd(remaining)} />
            <Stat k="In crate" v={`${haveN}/${ITEMS.length}`} />
            <Stat
              k="Fit"
              v={`${FIT_SUMMARY.pass} ok · ${FIT_SUMMARY.watch} watch`}
            />
            {tab === "list" && (
              <button
                type="button"
                onClick={() => downloadCsv(ITEMS)}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-fg px-3 text-sm text-accent-fg"
              >
                <Download className="size-3.5" />
                CSV
              </button>
            )}
          </div>
        </header>

        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <Chip key={t.id} on={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </Chip>
          ))}
        </div>

        {tab === "fit" && <FitCheck />}
        {tab === "build" && <BuildOrder />}
        {tab === "list" && (
          <>
        <div className="flex flex-col gap-3">
          <label className="flex min-h-11 items-center gap-2 rounded-md bg-surface px-3">
            <Search className="size-4 shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search SKU, brand, part"
              className="min-h-11 w-full bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            <Chip on={tier === "all"} onClick={() => setTier("all")}>
              All
            </Chip>
            {TIERS.map((t) => (
              <Chip key={t.id} on={tier === t.id} onClick={() => setTier(t.id)}>
                {t.label}
              </Chip>
            ))}
            <Chip on={hideOwned} onClick={() => setHideOwned(!hideOwned)}>
              Hide owned
            </Chip>
          </div>
          <div className="flex flex-wrap gap-1">
            <Chip on={group === "all"} onClick={() => setGroup("all")}>
              Every group
            </Chip>
            {GROUPS.map((g) => (
              <Chip key={g} on={group === g} onClick={() => setGroup(g)}>
                {g}
              </Chip>
            ))}
          </div>
        </div>

        <div className="hidden overflow-hidden rounded-xl bg-surface md:block">
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-2xs uppercase tracking-[0.14em] text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-3 font-medium">Have</th>
                <th className="px-3 py-3 font-medium">Item</th>
                <th className="px-3 py-3 font-medium">SKU</th>
                <th className="px-3 py-3 font-medium">Origin</th>
                <th className="px-3 py-3 font-medium">Qty</th>
                <th className="px-3 py-3 text-right font-medium">Unit</th>
                <th className="px-3 py-3 text-right font-medium">Line</th>
                <th className="px-3 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <KitRow
                  key={item.id}
                  item={item}
                  have={owned.includes(item.id)}
                  open={openCad === item.id}
                  onHave={() => toggleOwned(item.id)}
                  onCad={() => setOpenCad((id) => (id === item.id ? null : item.id))}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 md:hidden">
          {rows.map((item) => (
            <MobileRow
              key={item.id}
              item={item}
              have={owned.includes(item.id)}
              open={openCad === item.id}
              onHave={() => toggleOwned(item.id)}
              onCad={() => setOpenCad((id) => (id === item.id ? null : item.id))}
            />
          ))}
        </div>

        {rows.length === 0 && (
          <p className="text-sm text-muted">No parts match that filter.</p>
        )}

        <PrintBlock
          openId={openCad}
          onToggle={(id) => setOpenCad((cur) => (cur === id ? null : id))}
        />
          </>
        )}
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="font-mono text-2xs uppercase tracking-[0.16em] text-subtle">{k}</p>
      <p className="mt-1 font-mono text-sm tabular-nums text-fg">{v}</p>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "min-h-11 rounded-sm px-2.5 py-2 font-mono text-2xs uppercase tracking-[0.12em] " +
        (on ? "bg-fg text-accent-fg" : "bg-surface text-muted hover:text-fg")
      }
    >
      {children}
    </button>
  );
}

function KitRow({
  item,
  have,
  open,
  onHave,
  onCad,
}: {
  item: BomItem;
  have: boolean;
  open: boolean;
  onHave: () => void;
  onCad: () => void;
}) {
  const origin = originOf(item);
  const doc = cadFor(item.cadId);
  const line = lineTotal(item);
  return (
    <>
      <tr className="border-b border-border/70 align-top">
        <td className="px-3 py-3">
          <label className="flex min-h-11 items-center">
            <input
              type="checkbox"
              checked={have}
              onChange={onHave}
              className="size-4 accent-lock"
              aria-label={`Have ${item.name}`}
            />
          </label>
        </td>
        <td className="px-3 py-3">
          <p className="text-fg">{item.name}</p>
          <p className="mt-0.5 font-mono text-2xs uppercase tracking-[0.12em] text-subtle">
            {item.group} · {item.brand}
          </p>
        </td>
        <td className="px-3 py-3 font-mono text-2xs text-muted">{item.sku}</td>
        <td className="px-3 py-3 font-mono text-2xs uppercase tracking-[0.12em] text-muted">
          {ORIGIN_LABEL[origin]}
        </td>
        <td className="px-3 py-3 font-mono text-2xs tabular-nums text-muted">{item.qty}</td>
        <td className="px-3 py-3 text-right font-mono text-2xs tabular-nums text-muted">
          {item.included ? "—" : usd(item.unitUsd)}
        </td>
        <td className="px-3 py-3 text-right font-mono text-sm tabular-nums">
          {line ? usd(line) : "—"}
        </td>
        <td className="px-3 py-3 text-right">
          {item.buyUrl ? (
            <a
              href={item.buyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-sm px-2 text-sm text-lock hover:text-fg"
            >
              Buy
              <ExternalLink className="size-3.5" />
            </a>
          ) : doc ? (
            <button
              type="button"
              onClick={onCad}
              className="min-h-11 rounded-sm px-2 font-mono text-2xs uppercase tracking-[0.12em] text-lock hover:text-fg"
            >
              {open ? "Hide" : "Drawing"}
            </button>
          ) : null}
        </td>
      </tr>
      {doc && open && (
        <tr>
          <td colSpan={8} className="bg-elevated px-3 py-3">
            <p className="mb-2 text-sm text-muted">{item.why}</p>
            <CadSheet doc={doc} />
          </td>
        </tr>
      )}
    </>
  );
}

function MobileRow({
  item,
  have,
  open,
  onHave,
  onCad,
}: {
  item: BomItem;
  have: boolean;
  open: boolean;
  onHave: () => void;
  onCad: () => void;
}) {
  const origin = originOf(item);
  const doc = cadFor(item.cadId);
  const line = lineTotal(item);
  return (
    <article className="rounded-xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            checked={have}
            onChange={onHave}
            className="mt-1 size-4 accent-lock"
          />
          <span>
            <span className="block text-sm text-fg">{item.name}</span>
            <span className="mt-0.5 block font-mono text-2xs text-muted">{item.sku}</span>
          </span>
        </label>
        <span className="font-mono text-sm tabular-nums">{line ? usd(line) : "—"}</span>
      </div>
      <p className="mt-2 font-mono text-2xs uppercase tracking-[0.12em] text-subtle">
        {ORIGIN_LABEL[origin]} · qty {item.qty} · {item.group}
      </p>
      {item.buyUrl ? (
        <a
          href={item.buyUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-sm bg-fg px-3 text-sm text-accent-fg"
        >
          Buy
          <ExternalLink className="size-3.5" />
        </a>
      ) : doc ? (
        <button
          type="button"
          onClick={onCad}
          className="mt-3 min-h-11 rounded-sm px-3 font-mono text-2xs uppercase tracking-[0.12em] text-lock"
        >
          {open ? "Hide drawing" : "Print drawing"}
        </button>
      ) : null}
      {doc && open && (
        <div className="mt-3">
          <CadSheet doc={doc} />
        </div>
      )}
    </article>
  );
}

function PrintBlock({
  openId,
  onToggle,
}: {
  openId: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-xl bg-surface p-4 md:p-5">
      <p className="font-mono text-2xs uppercase tracking-[0.18em] text-subtle">
        Print fittings · {PRINT_ITEMS.length}
      </p>
      <p className="mt-1 text-sm text-muted">
        PETG and TPU parts that do not exist as a SKU. Open a drawing, slice, print.
      </p>
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {PRINT_ITEMS.map((item) => {
          const doc = cadFor(item.cadId);
          const open = openId === item.id;
          return (
            <li key={item.id} className="rounded-md bg-elevated p-3">
              <p className="text-sm text-fg">{item.name}</p>
              <p className="mt-0.5 font-mono text-2xs text-muted">
                {item.sku} · {item.materialName ?? item.process}
              </p>
              {doc && (
                <button
                  type="button"
                  onClick={() => onToggle(item.id)}
                  className="mt-2 min-h-11 rounded-sm px-2 font-mono text-2xs uppercase tracking-[0.12em] text-lock hover:text-fg"
                >
                  {open ? "Hide drawing" : "Print drawing"}
                </button>
              )}
              {doc && open && (
                <div className="mt-2">
                  <CadSheet doc={doc} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}