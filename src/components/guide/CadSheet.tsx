import type { CadDoc, CadPrim, CadView } from "@/lib/cad";

const GAP = 28;
const MARGIN = 10;
const TITLE_H = 32;
const LABEL = 8;

function yUp(viewH: number, y: number) {
  return viewH - y;
}

function arrow(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const s = 1.7;
  const bx = x2 - ux * s;
  const by = y2 - uy * s;
  const px = -uy * 0.75;
  const py = ux * 0.75;
  return `${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}`;
}

function extent(view: CadView) {
  // SVG local space: x same as mm, y = view.h - mmY (y-down).
  let minX = -2;
  let minY = -7;
  let maxX = view.w + 2;
  let maxY = view.h + 2;
  for (const p of view.prims) {
    if (p.t === "dimH") {
      const svgY = view.h - p.y - p.offset;
      minY = Math.min(minY, svgY - 5);
      maxY = Math.max(maxY, view.h - p.y + 2, svgY + 2);
      minX = Math.min(minX, p.x1, p.x2);
      maxX = Math.max(maxX, p.x1, p.x2);
    } else if (p.t === "dimV") {
      const svgX = p.x + p.offset;
      minX = Math.min(minX, p.x, svgX - 9);
      maxX = Math.max(maxX, p.x, svgX + 9);
    }
  }
  if (view.h < 12) maxY += 10;
  if (view.w < 16) maxX += 8;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function Prim({ p, h }: { p: CadPrim; h: number }) {
  if (p.t === "rect") {
    return (
      <rect
        className="cad-object"
        x={p.x}
        y={yUp(h, p.y + p.h)}
        width={p.w}
        height={p.h}
      />
    );
  }
  if (p.t === "circle") {
    return (
      <circle
        className={p.hole ? "cad-object cad-hole" : "cad-object"}
        cx={p.x}
        cy={yUp(h, p.y)}
        r={p.r}
      />
    );
  }
  if (p.t === "line") {
    const cls =
      p.style === "center"
        ? "cad-center"
        : p.style === "hidden"
          ? "cad-hidden"
          : "cad-object";
    return (
      <line
        className={cls}
        x1={p.x1}
        y1={yUp(h, p.y1)}
        x2={p.x2}
        y2={yUp(h, p.y2)}
      />
    );
  }
  if (p.t === "poly") {
    const pts = p.pts.map(([x, y]) => `${x},${yUp(h, y)}`).join(" ");
    return <polygon className="cad-object" points={pts} />;
  }
  if (p.t === "arc") {
    const a0 = (p.a0 * Math.PI) / 180;
    const a1 = (p.a1 * Math.PI) / 180;
    const x0 = p.x + p.r * Math.cos(a0);
    const y0 = p.y + p.r * Math.sin(a0);
    const x1 = p.x + p.r * Math.cos(a1);
    const y1 = p.y + p.r * Math.sin(a1);
    const large = Math.abs(p.a1 - p.a0) > 180 ? 1 : 0;
    return (
      <path
        className="cad-object"
        d={`M ${x0} ${yUp(h, y0)} A ${p.r} ${p.r} 0 ${large} 0 ${x1} ${yUp(h, y1)}`}
      />
    );
  }
  if (p.t === "dimH") {
    const y = yUp(h, p.y) - p.offset;
    const mid = (p.x1 + p.x2) / 2;
    return (
      <g className="cad-dim">
        <line x1={p.x1} y1={yUp(h, p.y)} x2={p.x1} y2={y} />
        <line x1={p.x2} y1={yUp(h, p.y)} x2={p.x2} y2={y} />
        <line x1={p.x1} y1={y} x2={p.x2} y2={y} />
        <polygon points={arrow(mid, y, p.x1, y)} />
        <polygon points={arrow(mid, y, p.x2, y)} />
        <text x={mid} y={y - 1.1} textAnchor="middle">
          {p.text}
        </text>
      </g>
    );
  }
  const x = p.x + p.offset;
  const mid = (p.y1 + p.y2) / 2;
  const yMid = yUp(h, mid);
  return (
    <g className="cad-dim">
      <line x1={p.x} y1={yUp(h, p.y1)} x2={x} y2={yUp(h, p.y1)} />
      <line x1={p.x} y1={yUp(h, p.y2)} x2={x} y2={yUp(h, p.y2)} />
      <line x1={x} y1={yUp(h, p.y1)} x2={x} y2={yUp(h, p.y2)} />
      <polygon points={arrow(x, yMid, x, yUp(h, p.y1))} />
      <polygon points={arrow(x, yMid, x, yUp(h, p.y2))} />
      <text
        x={x + (p.offset >= 0 ? 1.6 : -1.6)}
        y={yMid + 0.9}
        textAnchor={p.offset >= 0 ? "start" : "end"}
      >
        {p.text}
      </text>
    </g>
  );
}

function ViewBlock({
  view,
  x,
  y,
  s,
  ext,
}: {
  view: CadView;
  x: number;
  y: number;
  s: number;
  ext: ReturnType<typeof extent>;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <text className="cad-label" x={0} y={-1.6}>
        {view.name}
      </text>
      <g transform={`translate(${-ext.minX} ${-ext.minY})`}>
        {view.prims.map((p, i) => (
          <Prim key={i} p={p} h={view.h} />
        ))}
      </g>
    </g>
  );
}

function layout(doc: CadDoc) {
  const top = doc.views.find((v) => v.name === "TOP") ?? doc.views[0];
  const front = doc.views.find((v) => v.name === "FRONT") ?? doc.views[1] ?? top;
  const right = doc.views.find((v) => v.name === "RIGHT") ?? doc.views[2] ?? top;
  const eTop = extent(top);
  const eFront = extent(front);
  const eRight = extent(right);
  const rawW = eTop.w + GAP + eRight.w;
  const rawH = eTop.h + LABEL + GAP + eFront.h;
  const s = Math.min(2.6, 230 / Math.max(rawW, 1), 155 / Math.max(rawH, 1));
  const topW = eTop.w * s;
  const topH = (eTop.h + LABEL) * s;
  const frontW = eFront.w * s;
  const frontH = (eFront.h + LABEL) * s;
  const rightW = eRight.w * s;
  const rightH = (eRight.h + LABEL) * s;
  const contentW = Math.max(topW, frontW) + GAP + rightW;
  const contentH = Math.max(topH + GAP + frontH, rightH);
  const sheetW = contentW + MARGIN * 2;
  const sheetH = contentH + TITLE_H + MARGIN * 2 + 4;
  return {
    s,
    sheetW,
    sheetH,
    top: { view: top, ext: eTop, x: MARGIN, y: MARGIN + LABEL },
    front: {
      view: front,
      ext: eFront,
      x: MARGIN,
      y: MARGIN + LABEL + topH + GAP,
    },
    right: {
      view: right,
      ext: eRight,
      x: MARGIN + Math.max(topW, frontW) + GAP,
      y: MARGIN + LABEL,
    },
  };
}

export function CadSheet({ doc }: { doc: CadDoc }) {
  const L = layout(doc);
  const tbY = L.sheetH - TITLE_H - 3;
  const col = L.sheetW / 4;
  return (
    <svg
      className="cad-sheet"
      viewBox={`0 0 ${L.sheetW.toFixed(1)} ${L.sheetH.toFixed(1)}`}
      role="img"
      aria-label={`${doc.number} ${doc.title}`}
    >
      <rect className="cad-frame" x="0.5" y="0.5" width={L.sheetW - 1} height={L.sheetH - 1} />
      <ViewBlock view={L.top.view} x={L.top.x} y={L.top.y} s={L.s} ext={L.top.ext} />
      <ViewBlock view={L.front.view} x={L.front.x} y={L.front.y} s={L.s} ext={L.front.ext} />
      <ViewBlock view={L.right.view} x={L.right.x} y={L.right.y} s={L.s} ext={L.right.ext} />
      <line className="cad-object" x1="0.5" y1={tbY} x2={L.sheetW - 0.5} y2={tbY} />
      <line className="cad-object" x1={col} y1={tbY} x2={col} y2={L.sheetH - 0.5} />
      <line className="cad-object" x1={col * 2} y1={tbY} x2={col * 2} y2={L.sheetH - 0.5} />
      <line className="cad-object" x1={col * 3} y1={tbY} x2={col * 3} y2={L.sheetH - 0.5} />
      <text className="cad-tb-k" x="4" y={tbY + 6}>
        DWG NO
      </text>
      <text className="cad-tb-v" x="4" y={tbY + 13}>
        {doc.number}
      </text>
      <text className="cad-tb-k" x="4" y={tbY + 20}>
        REV {doc.rev} · {doc.qty} OFF
      </text>
      <text className="cad-tb-k" x={col + 3} y={tbY + 6}>
        TITLE
      </text>
      <text className="cad-tb-v" x={col + 3} y={tbY + 13}>
        {doc.title}
      </text>
      <text className="cad-tb-k" x={col + 3} y={tbY + 20}>
        HV-1 OSPREY
      </text>
      <text className="cad-tb-k" x={col * 2 + 3} y={tbY + 6}>
        MATERIAL
      </text>
      <text className="cad-tb-v" x={col * 2 + 3} y={tbY + 13}>
        {doc.material}
      </text>
      <text className="cad-tb-k" x={col * 2 + 3} y={tbY + 20}>
        {doc.mass}
      </text>
      <text className="cad-tb-k" x={col * 3 + 3} y={tbY + 6}>
        PROCESS · mm
      </text>
      <text className="cad-tb-v" x={col * 3 + 3} y={tbY + 13}>
        {doc.process}
      </text>
      <text className="cad-tb-k" x={col * 3 + 3} y={tbY + 20}>
        {doc.projection} · {doc.scale}
      </text>
    </svg>
  );
}
