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
      ctx.fillStyle = "#0c0d10";
      ctx.fillRect(0, 0, size, size);
      const cell = 8;
      for (let y = 0; y < size; y += cell) {
        for (let x = 0; x < size; x += cell) {
          const twill = ((x / cell | 0) + (y / cell | 0) * 2) % 4;
          const base = twill < 2 ? 22 : 14;
          ctx.fillStyle = `rgb(${base},${base + 1},${base + 3})`;
          ctx.fillRect(x, y, cell, cell);
          ctx.strokeStyle = twill < 2 ? "rgba(200,205,214,0.07)" : "rgba(200,205,214,0.03)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (twill < 2) {
            ctx.moveTo(x, y);
            ctx.lineTo(x + cell, y + cell);
          } else {
            ctx.moveTo(x + cell, y);
            ctx.lineTo(x, y + cell);
          }
          ctx.stroke();
        }
      }
    },
    6,
  );
}

export function makePetgTexture(): THREE.CanvasTexture {
  return canvasTex(128, (ctx, size) => {
    ctx.fillStyle = "#5e6a62";
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 3) {
      ctx.fillStyle = y % 6 === 0 ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.06)";
      ctx.fillRect(0, y, size, 1);
    }
  }, 4);
}

export function loadProductMap(url: string, repeat = 1): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const tex = loader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = repeat > 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat > 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  if (repeat > 1) tex.repeat.set(repeat, repeat);
  tex.needsUpdate = true;
  return tex;
}

export function photoMat(url: string, roughness = 0.48): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: loadProductMap(url),
    color: 0xffffff,
    roughness,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
}

export function carbonPhotoMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: loadProductMap("/bom/tex/carbon.jpg", 3),
    color: 0xffffff,
    roughness: 0.36,
    metalness: 0.38,
  });
}

/** Laser-etched HV-1 OSPREY legend for the top plate. Text is drawn, not generated. */
export function makePlateMark(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context");
  ctx.clearRect(0, 0, 1024, 1024);
  ctx.fillStyle = "rgba(210, 216, 224, 0.22)";
  ctx.textAlign = "center";
  ctx.font = "600 72px 'IBM Plex Sans', sans-serif";
  ctx.fillText("HV-1 OSPREY", 512, 430);
  ctx.font = "500 28px 'IBM Plex Mono', monospace";
  ctx.fillText("HORIZON VISION  ·  650 mm TRUE-X  ·  CREO", 512, 490);
  ctx.strokeStyle = "rgba(210, 216, 224, 0.18)";
  ctx.lineWidth = 3;
  ctx.strokeRect(180, 360, 664, 160);
  ctx.beginPath();
  ctx.arc(512, 620, 48, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "500 22px 'IBM Plex Mono', monospace";
  ctx.fillText("30.5  FC", 512, 700);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeMotorLabel(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context");
  ctx.fillStyle = "#111214";
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#e8ecef";
  ctx.textAlign = "center";
  ctx.font = "700 96px 'IBM Plex Sans', sans-serif";
  ctx.fillText("3115", 256, 220);
  ctx.font = "600 36px 'IBM Plex Sans', sans-serif";
  ctx.fillText("X-ROTOR", 256, 280);
  ctx.font = "500 32px 'IBM Plex Mono', monospace";
  ctx.fillText("900 KV", 256, 340);
  ctx.strokeStyle = "#c8cdd2";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(256, 256, 230, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
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
