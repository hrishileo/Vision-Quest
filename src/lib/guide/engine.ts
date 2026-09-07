import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildDrone, type DroneBuild } from "./build-drone";
import { buildWorld, makeStudioCar, trackPoint, trackTangent, type WorldBuild } from "./build-world";
import { PART_MAP } from "./catalog";
import { TOUR_BEATS, useGuide } from "./store";
import type { BBox, LockState, Telemetry } from "./types";

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ptr = new THREE.Vector2();
const _q = new THREE.Quaternion();
const _look = new THREE.Vector3();

type Label = { id: string; el: HTMLDivElement; obj: CSS2DObject };

function partIdOf(obj: THREE.Object3D | null | undefined): string | null {
  let o: THREE.Object3D | null | undefined = obj;
  while (o) {
    const id = o.userData.partId as string | undefined;
    if (id) return id;
    o = o.parent;
  }
  return null;
}

function taggedRoot(obj: THREE.Object3D): THREE.Object3D {
  const id = partIdOf(obj);
  if (!id) return obj;
  let o = obj;
  while (o.parent && o.parent.userData.partId === id) o = o.parent;
  return o;
}

function ignorePick(obj: THREE.Object3D) {
  obj.traverse((o) => {
    o.userData.helper = true;
    o.raycast = () => {};
  });
}

export class GuideEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly drone: DroneBuild;
  readonly world: WorldBuild;
  readonly studio: THREE.Group;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private raf = 0;
  private disposed = false;
  private clock = new THREE.Timer();
  private clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0.18, 0.08), 0.02);
  private boxHelper: THREE.BoxHelper;
  private frustum: THREE.LineSegments;
  private lockBeam: THREE.Mesh;
  private predMesh: THREE.Mesh;
  private studioCar: THREE.Group;
  private studioFog: THREE.Fog;
  private pursuitFog: THREE.Fog;
  private imuAxes: THREE.AxesHelper;
  private signalLines: THREE.Line[];
  private dronePos = new THREE.Vector3(0, 7, 18);
  private droneVel = new THREE.Vector3();
  private prevErr = new THREE.Vector3();
  private yaw = 0;
  private roll = 0;
  private pitch = 0;
  private pred = new THREE.Vector3();
  private predVel = new THREE.Vector3();
  private lock: LockState = "search";
  private lockAge = 0;
  private missAge = 0;
  private confidence = 0;
  private targetIndex = 0;
  private pidP = 0;
  private pidI = 0;
  private pidD = 0;
  private integral = new THREE.Vector3();
  private lastTelemetry = 0;
  private pointerNdc = new THREE.Vector2();
  private dragging = false;
  private pointerHeld = false;
  private hoverObj: THREE.Object3D | null = null;
  private down = { x: 0, y: 0 };
  private idle = 0;
  private labelList: Label[] = [];
  private tip: HTMLDivElement;
  private tipGroup: HTMLSpanElement;
  private tipName: HTMLSpanElement;
  private envTex: THREE.Texture;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private host: HTMLElement;
  private reduced = false;
  private useBloom = true;
  private tourT = 0;
  private tourIndex = 0;
  private bbox: BBox | null = null;
  private pipelineStep = 0;
  private mix: [number, number, number, number] = [0.18, 0.18, 0.18, 0.18];
  private studioCarPhase = 0;
  private wasTouring = false;
  private lastMode: string = "anatomy";
  private lastBuild: string = "skeleton";
  private ro: ResizeObserver | null = null;
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;
  private onPointerLeave: () => void;
  private onKey: (e: KeyboardEvent) => void;
  private onResize: () => void;

  constructor(host: HTMLElement) {
    this.host = host;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.useBloom = host.clientWidth >= 700 && !this.reduced;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.useBloom ? 2 : 1.5));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.useBloom ? 0.92 : 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x0a0b0d, 1);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    this.renderer = renderer;

    const labels = new CSS2DRenderer();
    labels.setSize(host.clientWidth, host.clientHeight);
    labels.domElement.style.position = "absolute";
    labels.domElement.style.inset = "0";
    labels.domElement.style.pointerEvents = "none";
    host.appendChild(labels.domElement);
    this.labels = labels;

    this.tip = document.createElement("div");
    this.tip.className = "part-tip";
    this.tip.hidden = true;
    this.tip.setAttribute("aria-hidden", "true");
    this.tipGroup = document.createElement("span");
    this.tipGroup.className = "part-tip-k";
    this.tipName = document.createElement("span");
    this.tipName.className = "part-tip-n";
    this.tip.append(this.tipGroup, this.tipName);
    (host.parentElement ?? host).appendChild(this.tip);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0b0d);
    this.studioFog = new THREE.Fog(0x0a0b0d, 8, 18);
    this.pursuitFog = new THREE.Fog(0x0c1014, 28, 95);
    this.scene.fog = this.studioFog;

    this.camera = new THREE.PerspectiveCamera(
      38,
      Math.max(host.clientWidth, 1) / Math.max(host.clientHeight, 1),
      0.04,
      200,
    );
    this.camera.position.set(2.05, 1.18, 2.28);

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xd5dbe0, 0x1a1c20, 1.05);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xf2efe6, 2.8);
    this.key.position.set(3.2, 4.4, 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(this.useBloom ? 1024 : 512, this.useBloom ? 1024 : 512);
    this.key.shadow.camera.near = 0.2;
    this.key.shadow.camera.far = 60;
    this.key.shadow.camera.left = -16;
    this.key.shadow.camera.right = 16;
    this.key.shadow.camera.top = 16;
    this.key.shadow.camera.bottom = -16;
    this.scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0x9aa8b4, 0.85);
    this.rim.position.set(-2.2, 1.4, -1.8);
    this.scene.add(this.rim);

    this.studio = new THREE.Group();
    const grid = new THREE.GridHelper(4.2, 42, 0x3a3e46, 0x1c1e24);
    grid.position.y = -0.046;
    this.studio.add(grid);
    const discGeo = new THREE.CircleGeometry(1.7, 64);
    const discMat = new THREE.MeshStandardMaterial({
      color: 0x1a1d24,
      roughness: 0.88,
      metalness: 0.08,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.045;
    disc.receiveShadow = true;
    this.studio.add(disc);
    this.scene.add(this.studio);

    this.drone = buildDrone();
    this.scene.add(this.drone.group);

    this.imuAxes = new THREE.AxesHelper(0.045);
    this.drone.imuObject.add(this.imuAxes);
    this.imuAxes.visible = false;
    ignorePick(this.imuAxes);

    this.world = buildWorld();
    this.world.group.visible = false;
    this.scene.add(this.world.group);
    this.world.cars.forEach((c, i) => {
      c.group.traverse((o) => {
        o.userData.carIndex = i;
      });
    });

    this.studioCar = makeStudioCar();
    this.studioCar.visible = false;
    this.studioCar.position.set(0.55, 0, 1.15);
    this.scene.add(this.studioCar);

    this.frustum = this.makeFrustum();
    this.frustum.visible = false;
    this.scene.add(this.frustum);
    ignorePick(this.frustum);

    this.boxHelper = new THREE.BoxHelper(this.drone.group, 0x8fbf9a);
    this.boxHelper.visible = false;
    this.scene.add(this.boxHelper);

    const beamGeo = new THREE.CylinderGeometry(0.006, 0.002, 1, 8, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    this.lockBeam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        color: 0x8fbf9a,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.lockBeam.visible = false;
    this.scene.add(this.lockBeam);
    ignorePick(this.lockBeam);

    this.predMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 1.2, 4.6),
      new THREE.MeshBasicMaterial({
        color: 0x8fbf9a,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
      }),
    );
    this.predMesh.visible = false;
    this.scene.add(this.predMesh);
    ignorePick(this.predMesh);

    this.signalLines = this.makeSignals();
    this.signalLines.forEach(ignorePick);
    this.drone.thrustCones.forEach(ignorePick);
    ignorePick(this.boxHelper);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.85;
    this.controls.maxDistance = 48;
    this.controls.target.set(0, 0.04, 0);
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.maxPolarAngle = Math.PI * 0.48;

    if (this.useBloom) {
      const composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(this.scene, this.camera);
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(host.clientWidth, host.clientHeight),
        0.38,
        0.42,
        0.84,
      );
      composer.addPass(renderPass);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.renderPass = renderPass;
      this.bloomPass = bloom;
    }

    this.mountLabels();

    this.onResize = () => this.resize();
    this.onPointerDown = (e) => {
      this.dragging = false;
      this.pointerHeld = true;
      this.down.x = e.clientX;
      this.down.y = e.clientY;
      this.idle = 0;
      this.controls.autoRotate = false;
    };
    this.onPointerMove = (e) => {
      const rect = this.host.getBoundingClientRect();
      this.pointerNdc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      if (
        this.pointerHeld &&
        Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5
      ) {
        this.dragging = true;
      }
      this.idle = 0;
      this.pickHover(e.clientX, e.clientY);
    };
    this.onPointerLeave = () => {
      this.pointerHeld = false;
      this.dragging = false;
      this.hoverObj = null;
      this.hideTip();
      if (useGuide.getState().hovered) useGuide.getState().setHovered(null);
    };
    this.onPointerUp = (e) => {
      if (!this.dragging && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 6) {
        this.pickClick();
      }
      this.dragging = false;
      this.pointerHeld = false;
    };
    this.onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const map: Record<string, "anatomy" | "controller" | "vision" | "pursuit"> = {
        Digit1: "anatomy",
        Digit2: "controller",
        Digit3: "vision",
        Digit4: "pursuit",
      };
      if (map[e.code]) useGuide.getState().setMode(map[e.code]);
      if (e.code === "Space") {
        e.preventDefault();
        useGuide.getState().togglePaused();
      }
      if (e.code === "Escape") useGuide.getState().setSelected(null);
      if (e.code === "KeyC") useGuide.getState().toggleCutaway();
      if (e.code === "KeyT") useGuide.getState().toggleTour();
      if (e.code === "KeyB") {
        const st = useGuide.getState();
        st.setBuildView(st.buildView === "finished" ? "skeleton" : "finished");
      }
    };

    window.addEventListener("resize", this.onResize);
    host.addEventListener("pointerdown", this.onPointerDown);
    host.addEventListener("pointermove", this.onPointerMove);
    host.addEventListener("pointerup", this.onPointerUp);
    host.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("keydown", this.onKey);

    this.resize();
    this.clock.connect(document);
    this.clock.update();
    this.loop = this.loop.bind(this);
    this.renderer.setAnimationLoop(this.loop);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
  }

  private makeFrustum(): THREE.LineSegments {
    const d = 0.55;
    const hw = Math.tan(THREE.MathUtils.degToRad(35)) * d;
    const hh = hw * (9 / 16);
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-hw, -hh, -d),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(hw, -hh, -d),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(hw, hh, -d),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-hw, hh, -d),
      new THREE.Vector3(-hw, -hh, -d),
      new THREE.Vector3(hw, -hh, -d),
      new THREE.Vector3(hw, -hh, -d),
      new THREE.Vector3(hw, hh, -d),
      new THREE.Vector3(hw, hh, -d),
      new THREE.Vector3(-hw, hh, -d),
      new THREE.Vector3(-hw, hh, -d),
      new THREE.Vector3(-hw, -hh, -d),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: 0x8fbf9a,
        transparent: true,
        opacity: 0.55,
      }),
    );
  }

  private makeSignals(): THREE.Line[] {
    const paths: THREE.Vector3[][] = [
      [new THREE.Vector3(0, -0.022, 0), new THREE.Vector3(0, 0.008, 0)],
      [new THREE.Vector3(0, 0.008, 0), new THREE.Vector3(0, 0.018, 0)],
      [new THREE.Vector3(0, 0.018, 0), new THREE.Vector3(0, 0.028, 0)],
      [new THREE.Vector3(0, 0.028, 0), new THREE.Vector3(0, -0.01, 0.095)],
    ];
    const lines: THREE.Line[] = [];
    for (const pts of paths) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({
        color: 0x8fbf9a,
        dashSize: 0.012,
        gapSize: 0.008,
        transparent: true,
        opacity: 0.0,
      });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      this.drone.group.add(line);
      lines.push(line);
    }
    return lines;
  }

  private mountLabels() {
    const seen = new Set<string>();
    for (const piece of this.drone.pieces) {
      if (seen.has(piece.id)) continue;
      seen.add(piece.id);
      const info = PART_MAP[piece.id];
      if (!info) continue;
      const el = document.createElement("div");
      el.className = "anno";
      el.textContent = info.name;
      const obj = new CSS2DObject(el);
      obj.position.set(0, 0.03, 0);
      obj.visible = false;
      piece.object.add(obj);
      this.labelList.push({ id: piece.id, el, obj });
    }
  }

  private resize() {
    const w = Math.max(this.host.clientWidth, 1);
    const h = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloomPass?.setSize(w, h);
  }

  private loop() {
    if (this.disposed) return;
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.08);
    this.update(dt);
    this.render();
  }

  private update(dt: number) {
    const s = useGuide.getState();
    const simDt = s.paused ? 0 : dt;
    this.idle += dt;

    if (s.mode !== this.lastMode) {
      this.onModeChange(this.lastMode, s.mode);
      this.lastMode = s.mode;
    }
    if (s.buildView !== this.lastBuild) {
      this.lastBuild = s.buildView;
      if (s.mode !== "pursuit") this.onModeChange(s.mode, s.mode);
    }

    if (s.touring && !s.paused) {
      if (!this.wasTouring) {
        this.tourIndex = 0;
        this.tourT = 0;
      }
      this.advanceTour(dt);
    }
    this.wasTouring = s.touring;

    const studio = s.mode !== "pursuit";
    this.studio.visible = studio;
    this.world.group.visible = !studio;
    this.studioCar.visible = s.mode === "vision";
    this.scene.fog = studio ? this.studioFog : this.pursuitFog;
    this.scene.background = new THREE.Color(studio ? 0x0a0b0d : 0x0c1014);
    this.scene.environmentIntensity = studio ? 0.58 : 0.28;
    this.hemi.intensity = studio ? 1.05 : 0.5;
    this.key.intensity = studio ? 2.8 : 1.45;
    this.key.position.set(studio ? 3.2 : 18, studio ? 4.4 : 22, studio ? 2.2 : 8);
    this.controls.autoRotate =
      !this.reduced &&
      studio &&
      s.camView === "orbit" &&
      this.idle > 3.5 &&
      !this.dragging &&
      !s.selected;
    this.controls.enabled = s.camView === "orbit";
    this.controls.enableRotate = s.camView === "orbit";
    this.controls.enablePan = s.camView === "orbit";
    this.controls.enableZoom = s.camView !== "fpv";
    this.imuAxes.visible = s.mode === "controller";

    if (studio) {
      this.drone.group.position.set(0, 0, 0);
      if (s.mode === "controller") {
        const t = this.clock.getElapsed();
        this.roll = Math.sin(t * 0.85) * 0.14;
        this.pitch = Math.cos(t * 0.62) * 0.09;
        this.drone.group.rotation.order = "YXZ";
        this.drone.group.rotation.set(this.pitch, 0, this.roll);
        this.mix = [
          THREE.MathUtils.clamp(0.22 - this.roll * 0.7 + this.pitch * 0.45, 0.05, 1),
          THREE.MathUtils.clamp(0.22 + this.roll * 0.7 + this.pitch * 0.45, 0.05, 1),
          THREE.MathUtils.clamp(0.22 + this.roll * 0.7 - this.pitch * 0.45, 0.05, 1),
          THREE.MathUtils.clamp(0.22 - this.roll * 0.7 - this.pitch * 0.45, 0.05, 1),
        ];
        this.pidP = Math.min(1, Math.abs(this.roll) * 4 + Math.abs(this.pitch) * 3);
        this.pidD = Math.min(1, 0.25 + Math.abs(Math.cos(t * 0.85)) * 0.4);
        this.pidI = Math.min(1, 0.12 + Math.abs(this.roll) * 1.2);
      } else {
        this.drone.group.rotation.set(0, 0, 0);
        this.yaw = 0;
        this.roll = 0;
        this.pitch = 0;
        this.mix = [0.18, 0.18, 0.18, 0.18];
      }
    }

    const explode = this.isDressed(s) ? 0 : s.explode;
    for (const piece of this.drone.pieces) {
      piece.object.position.copy(piece.rest).addScaledVector(piece.explode, explode);
    }

    const dressed = this.isDressed(s);
    this.drone.finishGroup.visible = dressed;
    const cutPeek = s.cutaway && studio;
    for (const o of this.drone.skeletonOnly) o.visible = !dressed || cutPeek;

    const shell = dressed ? 1 : s.mode === "pursuit" ? 1 : s.shell;
    for (const m of this.drone.shellMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.transparent = shell < 0.97;
      mat.opacity = shell;
      mat.depthWrite = shell > 0.6;
    }

    const cut = s.cutaway && studio;
    this.renderer.clippingPlanes = cut ? [this.clipPlane] : [];
    for (const m of this.drone.clipMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.clippingPlanes = cut ? [this.clipPlane] : [];
    }

    const rpm =
      s.mode === "pursuit"
        ? 1800 + useGuide.getState().telemetry.throttle * 7200
        : s.mode === "controller"
          ? 2400 + this.pidP * 1800
          : s.rpm;
    const spin = (rpm / 60) * Math.PI * 2 * simDt;
    for (const p of this.drone.propPivots) {
      const dir = p.userData.cw ? 1 : -1;
      p.rotation.y += dir * spin;
    }
    for (const r of this.drone.rotorPivots) {
      const dir = r.userData.cw ? 1 : -1;
      r.rotation.y += dir * spin;
    }

    const t = this.clock.getElapsed();
    for (const led of this.drone.ledMats) {
      led.emissiveIntensity = 0.55 + Math.sin(t * 5.5) * 0.4;
    }

    const showSignals = studio && explode > 0.28 && !dressed;
    for (const line of this.signalLines) {
      const mat = line.material as THREE.LineDashedMaterial;
      const target = showSignals ? 0.4 + Math.sin(t * 4.2) * 0.18 : 0;
      mat.opacity = THREE.MathUtils.damp(mat.opacity, target, 6, dt);
      line.visible = mat.opacity > 0.02;
    }

    if (s.mode === "pursuit") {
      this.updatePursuit(simDt, s.standoff, s.altitude, s.tightness);
    } else if (s.mode === "vision") {
      this.updateVisionStudio(simDt, t);
    } else {
      this.lockBeam.visible = false;
      this.predMesh.visible = false;
      this.frustum.visible = s.mode === "controller";
      this.bbox = null;
      this.pipelineStep = s.mode === "controller" ? 5 : 0;
      if (s.mode === "anatomy") {
        this.drone.gimbalYaw.rotation.y = THREE.MathUtils.damp(
          this.drone.gimbalYaw.rotation.y,
          0,
          4,
          dt,
        );
        this.drone.gimbalPitch.rotation.x = THREE.MathUtils.damp(
          this.drone.gimbalPitch.rotation.x,
          0,
          4,
          dt,
        );
      } else {
        this.drone.gimbalYaw.rotation.y = THREE.MathUtils.damp(
          this.drone.gimbalYaw.rotation.y,
          0.15,
          3,
          dt,
        );
        this.drone.gimbalPitch.rotation.x = THREE.MathUtils.damp(
          this.drone.gimbalPitch.rotation.x,
          0.35,
          3,
          dt,
        );
      }
    }

    this.updateThrust(s.mode);
    this.syncFrustum(s.mode);
    this.updateSelection(s.selected, s.hovered);
    this.updateLabels(s);
    this.updateCamera(dt, s.mode, s.camView, s.selected);
    if (s.camView === "orbit") this.controls.update();

    this.lastTelemetry += dt;
    if (this.lastTelemetry > 0.12) {
      this.lastTelemetry = 0;
      this.pushTelemetry(s.mode);
    }
  }

  private onModeChange(from: string, to: string) {
    this.idle = 0;
    this.lockBeam.visible = false;
    this.predMesh.visible = false;
    this.frustum.visible = to === "controller" || to === "vision" || to === "pursuit";
    this.hoverObj = null;
    if (to === "pursuit") {
      this.controls.maxDistance = 48;
      this.controls.minDistance = 1.2;
      const back = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.camera.position.copy(this.dronePos).addScaledVector(back, -7.2).add(_v3.set(0, 3.1, 0));
      this.controls.target.copy(this.dronePos);
      this.controls.target.y += 0.4;
    } else {
      this.drone.group.position.set(0, 0, 0);
      this.drone.group.rotation.set(0, 0, 0);
      this.yaw = 0;
      this.roll = 0;
      this.pitch = 0;
      this.drone.gimbalYaw.rotation.y = 0;
      this.drone.gimbalPitch.rotation.x = to === "controller" ? 0.35 : 0;
      const dressed = useGuide.getState().buildView === "finished";
      const pos =
        to === "controller"
          ? [0.62, 0.4, 0.78]
          : to === "vision"
            ? [1.22, 0.55, 1.38]
            : dressed
              ? [2.32, 1.28, 2.52]
              : [2.05, 1.18, 2.28];
      const tgt = to === "vision" ? [0, 0.02, 0.08] : [0, 0.04, 0];
      this.camera.position.set(pos[0]!, pos[1]!, pos[2]!);
      this.controls.target.set(tgt[0]!, tgt[1]!, tgt[2]!);
      this.controls.minDistance = to === "controller" ? 0.18 : 0.22;
      this.controls.maxDistance = 12;
    }
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    void from;
  }

  private isDressed(s: ReturnType<typeof useGuide.getState>) {
    return s.buildView === "finished" || s.mode === "pursuit";
  }

  private advanceTour(dt: number) {
    const beat = TOUR_BEATS[this.tourIndex];
    if (!beat) {
      this.tourIndex = 0;
      this.tourT = 0;
      return;
    }
    const st = useGuide.getState();
    if (st.mode !== beat.mode) st.setMode(beat.mode);
    if (st.selected !== beat.part) st.setSelected(beat.part);
    const explode = THREE.MathUtils.damp(st.explode, beat.explode, 2.2, dt);
    if (Math.abs(explode - st.explode) > 0.004) st.setExplode(explode);
    this.tourT += dt;
    if (this.tourT >= beat.seconds) {
      this.tourT = 0;
      this.tourIndex = (this.tourIndex + 1) % TOUR_BEATS.length;
    }
  }

  private syncFrustum(mode: string) {
    this.drone.droneCam.updateMatrixWorld();
    this.drone.droneCam.getWorldPosition(_v);
    this.drone.droneCam.getWorldQuaternion(_q);
    this.frustum.position.copy(_v);
    this.frustum.quaternion.copy(_q);
    this.frustum.scale.setScalar(mode === "pursuit" ? 8 : 1);
  }

  private updateThrust(mode: string) {
    const show = mode === "controller" || mode === "pursuit";
    for (let i = 0; i < this.drone.thrustCones.length; i++) {
      const cone = this.drone.thrustCones[i]!;
      const v = this.mix[i] ?? 0.18;
      cone.visible = show;
      cone.scale.set(0.7 + v * 0.8, 0.45 + v * 1.6, 0.7 + v * 0.8);
      const mat = cone.material as THREE.MeshBasicMaterial;
      mat.opacity = show ? 0.08 + v * 0.28 : 0;
    }
  }

  private updateVisionStudio(dt: number, t: number) {
    if (dt > 0) this.studioCarPhase += dt * 0.35;
    const r = 1.05;
    this.studioCar.position.set(
      Math.sin(this.studioCarPhase) * r,
      0,
      0.85 + Math.cos(this.studioCarPhase) * 0.35,
    );
    this.studioCar.rotation.y = this.studioCarPhase + Math.PI / 2;

    this.drone.group.updateMatrixWorld(true);
    const tgt = this.studioCar.position;
    const gPos = this.drone.gimbalYaw.getWorldPosition(_v);
    const local = _v2
      .set(tgt.x - gPos.x, tgt.y + 0.12 - gPos.y, tgt.z - gPos.z)
      .applyQuaternion(this.drone.group.getWorldQuaternion(_q).invert());
    const gy = Math.atan2(local.x, local.z);
    const gp = Math.atan2(-local.y, Math.hypot(local.x, local.z));
    this.drone.gimbalYaw.rotation.y = THREE.MathUtils.damp(
      this.drone.gimbalYaw.rotation.y,
      THREE.MathUtils.clamp(gy, -1.2, 1.2),
      5,
      dt || 1 / 60,
    );
    this.drone.gimbalPitch.rotation.x = THREE.MathUtils.damp(
      this.drone.gimbalPitch.rotation.x,
      THREE.MathUtils.clamp(gp, -0.9, 0.45),
      5,
      dt || 1 / 60,
    );

    this.drone.droneCam.updateMatrixWorld();
    _ndc.copy(tgt).setY(tgt.y + 0.12).project(this.drone.droneCam);
    const inView = Math.abs(_ndc.x) < 0.92 && Math.abs(_ndc.y) < 0.92 && _ndc.z > 0 && _ndc.z < 1;
    if (inView) {
      this.lock = "track";
      this.confidence = Math.min(1, this.confidence + (dt || 0) * 1.2);
      const nx = (_ndc.x + 1) / 2;
      const ny = (1 - _ndc.y) / 2;
      this.bbox = { nx: nx - 0.12, ny: ny - 0.16, nw: 0.24, nh: 0.32 };
    } else {
      this.lock = "search";
      this.bbox = null;
    }
    this.pipelineStep = inView ? 3 + Math.floor((t * 0.7) % 3) : 1;
    this.frustum.visible = true;
    this.frustum.scale.setScalar(1);
    this.lockBeam.visible = inView;
    if (inView) this.placeBeam(gPos, tgt.clone().setY(0.12));
    this.predMesh.visible = false;
  }

  private placeBeam(from: THREE.Vector3, to: THREE.Vector3) {
    const mid = _v2.copy(from).add(to).multiplyScalar(0.5);
    const len = from.distanceTo(to);
    this.lockBeam.position.copy(mid);
    this.lockBeam.scale.set(1, 1, len);
    this.lockBeam.lookAt(to);
  }

  private updatePursuit(dt: number, standoff: number, altitude: number, tightness: number) {
    if (dt <= 0) return;
    for (const car of this.world.cars) {
      car.phase += car.speed * dt;
      const p = trackPoint(car.phase);
      const tan = trackTangent(car.phase);
      car.group.position.set(p.x, 0, p.z);
      car.group.rotation.y = Math.atan2(tan.x, tan.z);
      const wspin = car.speed * 28 * dt;
      for (const w of car.wheels) w.rotation.x += wspin;
    }

    const car = this.world.cars[this.targetIndex] ?? this.world.cars[0]!;
    const tgt = car.group.position;
    const tan = trackTangent(car.phase);
    const desired = _v.copy(tgt).addScaledVector(tan, -standoff);
    desired.y = altitude;

    const err = _v2.copy(desired).sub(this.dronePos);
    const dErr = _v3.copy(err).sub(this.prevErr).multiplyScalar(1 / Math.max(dt, 1 / 120));
    this.prevErr.copy(err);
    this.integral.addScaledVector(err, dt);
    this.integral.clampLength(0, 4);

    const kp = 1.55 * tightness;
    const kd = 0.72;
    const ki = 0.12;
    const acc = err.multiplyScalar(kp).addScaledVector(dErr, kd).addScaledVector(this.integral, ki);
    acc.y *= 1.1;
    this.droneVel.addScaledVector(acc, dt);
    this.droneVel.multiplyScalar(0.9);
    this.droneVel.clampLength(0, 18);
    this.dronePos.addScaledVector(this.droneVel, dt);

    this.pidP = Math.min(1, err.length() * 0.12);
    this.pidD = Math.min(1, dErr.length() * 0.02);
    this.pidI = Math.min(1, this.integral.length() * 0.15);

    const lookX = tgt.x - this.dronePos.x;
    const lookZ = tgt.z - this.dronePos.z;
    const wantYaw = Math.atan2(lookX, lookZ);
    this.yaw = THREE.MathUtils.damp(this.yaw, wantYaw, 3.2, dt);
    const lat = this.droneVel.clone().setY(0);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wantRoll = THREE.MathUtils.clamp(-lat.dot(right) * 0.08, -0.38, 0.38);
    const wantPitch = THREE.MathUtils.clamp(-this.droneVel.y * 0.04 - 0.06, -0.28, 0.2);
    this.roll = THREE.MathUtils.damp(this.roll, wantRoll, 5, dt);
    this.pitch = THREE.MathUtils.damp(this.pitch, wantPitch, 5, dt);

    this.drone.group.position.copy(this.dronePos);
    this.drone.group.rotation.order = "YXZ";
    this.drone.group.rotation.set(this.pitch, this.yaw, this.roll);

    this.drone.group.updateMatrixWorld(true);
    const gPos = this.drone.gimbalYaw.getWorldPosition(_v);
    const lx = tgt.x - gPos.x;
    const ly = tgt.y + 0.6 - gPos.y;
    const lz = tgt.z - gPos.z;
    const local = new THREE.Vector3(lx, ly, lz).applyQuaternion(
      this.drone.group.getWorldQuaternion(_q).invert(),
    );
    const gy = Math.atan2(local.x, local.z);
    const gp = Math.atan2(-local.y, Math.hypot(local.x, local.z));
    this.drone.gimbalYaw.rotation.y = THREE.MathUtils.damp(
      this.drone.gimbalYaw.rotation.y,
      THREE.MathUtils.clamp(gy, -1.2, 1.2),
      6,
      dt,
    );
    this.drone.gimbalPitch.rotation.x = THREE.MathUtils.damp(
      this.drone.gimbalPitch.rotation.x,
      THREE.MathUtils.clamp(gp, -0.9, 0.45),
      6,
      dt,
    );

    this.drone.droneCam.updateMatrixWorld();
    _ndc.copy(tgt).setY(tgt.y + 0.6).project(this.drone.droneCam);
    const inView =
      Math.abs(_ndc.x) < 0.92 && Math.abs(_ndc.y) < 0.92 && _ndc.z > 0 && _ndc.z < 1;

    const camPos = this.drone.droneCam.getWorldPosition(_v2);
    _ray.set(camPos, _v3.copy(tgt).setY(1).sub(camPos).normalize());
    const hits = _ray.intersectObjects(this.world.buildings, false);
    const distCar = camPos.distanceTo(tgt);
    const occluded = hits.length > 0 && hits[0]!.distance < distCar - 1.2;

    const detected = inView && !occluded;
    if (detected) {
      this.lockAge += dt;
      this.missAge = 0;
      if (this.lock === "search" && this.lockAge > 0.28) this.lock = "acquire";
      if (this.lock === "acquire" && this.lockAge > 0.7) this.lock = "track";
      if (this.lock === "lost") this.lock = "acquire";
      this.confidence = Math.min(1, this.confidence + dt * 1.4);
      const nx = (_ndc.x + 1) / 2;
      const ny = (1 - _ndc.y) / 2;
      const scale = THREE.MathUtils.clamp(4.2 / distCar, 0.08, 0.28);
      this.bbox = { nx: nx - scale * 0.55, ny: ny - scale * 0.7, nw: scale * 1.1, nh: scale * 1.4 };
    } else {
      this.missAge += dt;
      this.lockAge = 0;
      this.confidence = Math.max(0, this.confidence - dt * 0.9);
      this.bbox = null;
      if (this.missAge > 0.55 && (this.lock === "track" || this.lock === "acquire")) {
        this.lock = "lost";
      }
      if (this.missAge > 1.6) this.lock = "search";
    }

    const meas = tgt.clone().setY(0.6);
    if (detected) {
      const innov = meas.clone().sub(this.pred);
      this.pred.addScaledVector(innov, 0.35);
      this.predVel.lerp(tan.clone().multiplyScalar(car.speed * Math.hypot(28.8, 19.2)), 0.25);
    } else {
      this.pred.addScaledVector(this.predVel, dt);
    }

    this.predMesh.visible = this.lock !== "search";
    this.predMesh.position.copy(this.pred);
    this.predMesh.rotation.copy(car.group.rotation);

    this.lockBeam.visible = this.lock === "track" || this.lock === "acquire";
    if (this.lockBeam.visible) this.placeBeam(this.dronePos, tgt.clone().setY(0.8));
    this.frustum.visible = true;
    this.frustum.scale.setScalar(8);
    this.pipelineStep =
      this.lock === "search" ? 1 : this.lock === "acquire" ? 3 : this.lock === "lost" ? 0 : 5;

    const throttle = THREE.MathUtils.clamp(
      0.22 + this.droneVel.length() * 0.04 + Math.abs(this.roll) * 0.3,
      0.12,
      0.95,
    );
    this.mix = [
      THREE.MathUtils.clamp(throttle - this.roll * 0.25 + this.pitch * 0.15, 0.05, 1),
      THREE.MathUtils.clamp(throttle + this.roll * 0.25 + this.pitch * 0.15, 0.05, 1),
      THREE.MathUtils.clamp(throttle + this.roll * 0.25 - this.pitch * 0.15, 0.05, 1),
      THREE.MathUtils.clamp(throttle - this.roll * 0.25 - this.pitch * 0.15, 0.05, 1),
    ];
  }

  private updateSelection(selected: string | null, hovered: string | null) {
    const id = selected ?? hovered;
    if (!id) {
      this.boxHelper.visible = false;
      return;
    }
    let obj: THREE.Object3D | null = null;
    if (this.hoverObj && partIdOf(this.hoverObj) === id) {
      obj = taggedRoot(this.hoverObj);
    } else {
      obj = this.drone.pieces.find((p) => p.id === id)?.object ?? null;
    }
    if (!obj) {
      this.boxHelper.visible = false;
      return;
    }
    this.boxHelper.visible = true;
    this.boxHelper.setFromObject(obj);
    const color = selected ? 0x8fbf9a : 0xc5cdc8;
    (this.boxHelper.material as THREE.LineBasicMaterial).color.setHex(color);
  }

  private updateLabels(s: ReturnType<typeof useGuide.getState>) {
    for (const lab of this.labelList) {
      lab.obj.visible = false;
      lab.el.classList.remove("is-active");
    }
    void s;
  }

  private updateCamera(dt: number, mode: string, camView: string, selected: string | null) {
    if (camView === "fpv" && mode === "pursuit") return;
    if (camView === "chase" && mode === "pursuit") {
      const back = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const desired = _v2.copy(this.dronePos).addScaledVector(back, -7.2).add(_v3.set(0, 3.1, 0));
      this.camera.position.lerp(desired, 1 - Math.exp(-2.4 * dt));
      const car = this.world.cars[this.targetIndex]!;
      _look.copy(this.dronePos).add(car.group.position).multiplyScalar(0.5);
      _look.y += 0.4;
      this.controls.target.lerp(_look, 1 - Math.exp(-3 * dt));
      this.camera.lookAt(this.controls.target);
      return;
    }
    if (selected && mode !== "pursuit") {
      const piece = this.drone.pieces.find((p) => p.id === selected);
      if (piece) {
        piece.object.getWorldPosition(_v);
        this.controls.target.lerp(_v, 1 - Math.exp(-2.4 * dt));
        return;
      }
    }
    if (mode === "controller") {
      this.controls.target.lerp(new THREE.Vector3(0, 0.04, 0), 1 - Math.exp(-2 * dt));
      this.controls.minDistance = 0.18;
    } else if (mode === "vision") {
      this.controls.target.lerp(new THREE.Vector3(0, 0.02, 0.08), 1 - Math.exp(-2 * dt));
    } else if (mode === "anatomy") {
      this.controls.target.lerp(new THREE.Vector3(0, 0.03, 0), 1 - Math.exp(-1.6 * dt));
      this.controls.minDistance = 0.22;
    } else {
      this.controls.minDistance = 1.2;
    }
  }

  private pickHover(clientX: number, clientY: number) {
    if (this.dragging) {
      this.hoverObj = null;
      this.hideTip();
      return;
    }
    const hit = this.raycast();
    this.hoverObj = hit?.object ?? null;
    const part = hit ? partIdOf(hit.object) : null;
    if (useGuide.getState().hovered !== part) useGuide.getState().setHovered(part);
    this.showTip(part, clientX, clientY);
  }

  private showTip(id: string | null, clientX: number, clientY: number) {
    const info = id && useGuide.getState().camView !== "fpv" ? PART_MAP[id] : undefined;
    if (!info) {
      this.hideTip();
      return;
    }
    this.tipGroup.textContent = info.group;
    this.tipName.textContent = info.name;
    this.tip.hidden = false;
    const rect = this.host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const flipX = x > rect.width - 200;
    const flipY = y > rect.height - 80;
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
    this.tip.style.transform = `translate(${flipX ? "-12px" : "14px"}, ${flipY ? "-12px" : "14px"}) ${flipX ? "translateX(-100%)" : ""} ${flipY ? "translateY(-100%)" : ""}`;
    this.renderer.domElement.style.cursor = "pointer";
  }

  private hideTip() {
    if (!this.tip.hidden) this.tip.hidden = true;
    this.renderer.domElement.style.cursor = "grab";
  }

  private pickClick() {
    const hit = this.raycast();
    if (!hit) {
      useGuide.getState().setSelected(null);
      return;
    }
    const carIndex = hit.object.userData.carIndex as number | undefined;
    if (carIndex !== undefined && useGuide.getState().mode === "pursuit") {
      this.targetIndex = carIndex;
      this.lock = "search";
      this.lockAge = 0;
      this.confidence = 0.1;
      return;
    }
    const part = partIdOf(hit.object);
    useGuide.getState().setSelected(part);
  }

  private raycast(): THREE.Intersection | null {
    _ptr.copy(this.pointerNdc);
    _ray.setFromCamera(_ptr, this.activeCamera());
    _ray.params.Line = { threshold: 0.004 };
    const objs: THREE.Object3D[] = [this.drone.group];
    if (this.world.group.visible) objs.push(this.world.group);
    const hits = _ray.intersectObjects(objs, true);
    for (const h of hits) {
      if (h.object.userData.helper) continue;
      if (!(h.object as THREE.Mesh).isMesh) continue;
      let vis: THREE.Object3D | null = h.object;
      let hidden = false;
      while (vis) {
        if (!vis.visible) {
          hidden = true;
          break;
        }
        vis = vis.parent;
      }
      if (hidden) continue;
      if (h.object.userData.carIndex !== undefined) return h;
      if (partIdOf(h.object)) return h;
    }
    return null;
  }

  private activeCamera() {
    const s = useGuide.getState();
    if (s.mode === "pursuit" && s.camView === "fpv") return this.drone.droneCam;
    return this.camera;
  }

  private pushTelemetry(mode: string) {
    const car = this.world.cars[this.targetIndex] ?? this.world.cars[0]!;
    const range = this.dronePos.distanceTo(car.group.position);
    const speed = this.droneVel.length();
    const yawErr = THREE.MathUtils.radToDeg(
      Math.atan2(car.group.position.x - this.dronePos.x, car.group.position.z - this.dronePos.z) -
        this.yaw,
    );
    const throttle = this.mix.reduce((a, b) => a + b, 0) / 4;
    const tel: Telemetry = {
      alt: mode === "pursuit" ? this.dronePos.y : 0,
      speed: mode === "pursuit" ? speed : 0,
      range: mode === "pursuit" ? range : mode === "vision" ? 1.2 : 0,
      yawErr: mode === "pursuit" ? yawErr : 0,
      lock: mode === "pursuit" || mode === "vision" ? this.lock : "search",
      confidence: mode === "pursuit" || mode === "vision" ? this.confidence : 0,
      fpsDetect: 30 + Math.round(this.confidence * 30),
      throttle,
      motors: this.mix,
      pidP: this.pidP,
      pidI: this.pidI,
      pidD: this.pidD,
      loopHz: mode === "controller" ? 1000 : mode === "pursuit" ? 400 : 1000,
      targetId: this.targetIndex,
      pipelineStep: this.pipelineStep,
      bbox: mode === "vision" || mode === "pursuit" ? this.bbox : null,
    };
    useGuide.getState().setTelemetry(tel, mode === "pursuit" ? range : 0);
  }

  private render() {
    const s = useGuide.getState();
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const fpv = s.mode === "pursuit" && s.camView === "fpv";
    const cam = fpv ? this.drone.droneCam : this.camera;
    if (fpv) {
      this.drone.droneCam.aspect = w / Math.max(h, 1);
      this.drone.droneCam.updateProjectionMatrix();
    }

    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    const helperOn = this.frustum.visible;
    this.frustum.visible = this.frustum.visible && !fpv;

    if (this.composer && this.renderPass && !fpv) {
      this.renderPass.camera = cam;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, cam);
    }
    this.labels.render(this.scene, cam);

    const wantPip = (s.mode === "vision" || s.mode === "pursuit") && !fpv && w >= 720;
    if (wantPip) {
      const pipW = Math.min(300, Math.floor(w * 0.26));
      const pipH = Math.floor(pipW * (9 / 16));
      const pipX = 20;
      const pipY = 20;
      this.drone.droneCam.aspect = pipW / pipH;
      this.drone.droneCam.updateProjectionMatrix();
      this.drone.droneCam.updateMatrixWorld();
      this.frustum.visible = false;
      this.renderer.setScissorTest(true);
      this.renderer.setViewport(pipX, pipY, pipW, pipH);
      this.renderer.setScissor(pipX, pipY, pipW, pipH);
      this.renderer.render(this.scene, this.drone.droneCam);
      this.renderer.setScissorTest(false);
    }
    this.frustum.visible = helperOn && !fpv;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    this.host.removeEventListener("pointerdown", this.onPointerDown);
    this.host.removeEventListener("pointermove", this.onPointerMove);
    this.host.removeEventListener("pointerup", this.onPointerUp);
    this.host.removeEventListener("pointerleave", this.onPointerLeave);
    this.ro?.disconnect();
    this.controls.dispose();
    this.composer?.dispose();
    this.drone.geometries.forEach((g) => g.dispose());
    this.drone.materials.forEach((m) => m.dispose());
    this.drone.textures.forEach((t) => t.dispose());
    this.world.geometries.forEach((g) => g.dispose());
    this.world.materials.forEach((m) => m.dispose());
    this.world.textures.forEach((t) => t.dispose());
    this.envTex.dispose();
    const studioGeos = this.studioCar.userData.geos as THREE.BufferGeometry[] | undefined;
    studioGeos?.forEach((g) => g.dispose());
    const studioMats = this.studioCar.userData.mats as THREE.Material[] | undefined;
    studioMats?.forEach((m) => m.dispose());
    this.lockBeam.geometry.dispose();
    (this.lockBeam.material as THREE.Material).dispose();
    this.predMesh.geometry.dispose();
    (this.predMesh.material as THREE.Material).dispose();
    this.frustum.geometry.dispose();
    (this.frustum.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.tip.remove();
    this.labels.domElement.remove();
    this.renderer.domElement.remove();
  }
}
