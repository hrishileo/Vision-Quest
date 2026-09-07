import * as THREE from "three";

function canvasTex(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeat = 1,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.repeat.set(repeat, repeat);
  tex.needsUpdate = true;
  return tex;
}

export function makeCarbonTexture(): THREE.CanvasTexture {
  return canvasTex(
    256,
    (ctx, size) => {
      ctx.fillStyle = "#101114";
      ctx.fillRect(0, 0, size, size);
      for (let i = -size; i < size * 2; i += 5) {
        ctx.strokeStyle = i % 10 === 0 ? "#1c1f25" : "#15171b";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + size, size);
        ctx.stroke();
      }
      for (let i = -size; i < size * 2; i += 5) {
        ctx.strokeStyle = "rgba(220,224,230,0.035)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(i, size);
        ctx.lineTo(i + size, 0);
        ctx.stroke();
      }
    },
    5,
  );
}

export function makeBrushedTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx, size) => {
    ctx.fillStyle = "#c5c8ce";
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      const v = 180 + ((y * 17) % 40);
      ctx.strokeStyle = `rgba(${v},${v + 2},${v + 6},0.35)`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + ((y % 5) - 2));
      ctx.stroke();
    }
  });
}

export function makeAsphaltTexture(): THREE.CanvasTexture {
  return canvasTex(1024, (ctx, size) => {
    ctx.fillStyle = "#161914";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 5200; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const n = 16 + Math.random() * 24;
      ctx.fillStyle = `rgb(${n + 6},${n + 10},${n})`;
      ctx.fillRect(x, y, 2, 2);
    }

    const cx = size / 2;
    const cy = size / 2;
    const rx = size * 0.36;
    const ry = size * 0.24;

    const oval = (rScale: number) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * rScale, ry * rScale, 0, 0, Math.PI * 2);
    };

    ctx.strokeStyle = "#24282c";
    ctx.lineWidth = size * 0.078;
    oval(1);
    ctx.stroke();

    ctx.strokeStyle = "#32363c";
    ctx.lineWidth = size * 0.064;
    oval(1);
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([20, 18]);
    ctx.strokeStyle = "#d8d4c8";
    ctx.lineWidth = 3;
    oval(1);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "#6b6558";
    ctx.lineWidth = 2;
    oval(1.09);
    ctx.stroke();
    oval(0.91);
    ctx.stroke();
  });
}

export function makePcbTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx, size) => {
    ctx.fillStyle = "#143028";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#2f6a4c";
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 20; i++) {
      const y = 12 + i * 12;
      ctx.beginPath();
      ctx.moveTo(6, y);
      ctx.lineTo(size - 6, y + ((i % 3) - 1) * 5);
      ctx.stroke();
    }
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 8; i++) {
      ctx.strokeRect(18 + (i % 4) * 56, 28 + Math.floor(i / 4) * 110, 40, 28);
    }
    ctx.fillStyle = "#d4b45a";
    for (let i = 0; i < 48; i++) {
      ctx.fillRect(10 + (i % 12) * 20, 16 + Math.floor(i / 12) * 60, 2.5, 2.5);
    }
  });
}
