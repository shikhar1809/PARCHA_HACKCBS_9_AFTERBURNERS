import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * The clinic, running, as one machine you can turn around.
 *
 * Management can read the day as numbers on the Stats page. This is the same
 * day as a thing: five counters on a plate — front desk, vitals, doctor,
 * pharmacy, billing — with the patients between them as cards on a belt. What
 * is on the screens is the clinic's own: today's arrivals by name, the doctor's
 * queue with how long each has waited, the last prescription, the takings.
 *
 * Nothing here is decoration with numbers painted on. A counter stands taller
 * and burns brighter the more people are waiting at it, turns red when somebody
 * has waited past the clinic's own patience, and goes dark and grey when the
 * clinic has nobody on that counter at all — so a manager who turns the plate
 * once can see where the day is stuck before reading a single figure.
 *
 * The geometry, the belt and the camera are ported from the "agentic factory"
 * scene (procedural three.js: no models, no images). What changed is the whole
 * of the content: the stations are counters, every painted screen is redrawn
 * from `data` whenever the queues change, and the one-patient mode follows a
 * real patient through the building.
 */

export type FlowStationId = "desk" | "vitals" | "doctor" | "pharmacy" | "billing";

/** One person waiting at a counter, as the scene draws them. */
export type FlowPerson = {
  token: number | null;
  name: string;
  /** How long they have been at this counter. */
  waitedMinutes: number;
  /** Worth a doctor's eye before the others: an allergy on the record. */
  flagged?: boolean;
};

export type FlowStation = {
  id: FlowStationId;
  /** How many are waiting at this counter right now. */
  count: number;
  /** The longest anyone here has waited, in minutes. Null when nobody is. */
  longestWait: number | null;
  /** Who they are, longest wait first. The scene paints the first few. */
  people: FlowPerson[];
  /** False when this clinic has no such counter at all (no seat for it): it
   *  is drawn dark and says so, and nobody is ever shown waiting at it. */
  present: boolean;
  /** False when the counter exists but nobody active holds it. */
  staffed: boolean;
  /** A line of the counter's own, e.g. "Dr Verma · 2 seen". */
  note?: string | null;
};

/** The one patient the "One patient" mode walks through the building. */
export type FlowFollowing = {
  name: string;
  token: number | null;
  /** 0 = front desk … 4 = billing. */
  step: number;
  /** What is happening to them, in the clinic's words. */
  what: string;
  /** Minutes since they were registered. */
  inBuildingMinutes: number;
};

export type FlowData = {
  clinicName: string;
  stations: FlowStation[];
  following: FlowFollowing | null;
  /** Seen by a doctor today. */
  seenToday: number;
  /** Rupees taken today. */
  takings: number;
  /** The last prescription written, for the pharmacy's screen. */
  lastParcha: { patient: string; diagnosis: string | null; medicines: string[] } | null;
  /** The last bill paid, for the receipt. */
  lastBill: { patient: string; total: number; mode: string | null } | null;
  /** Minutes a patient may wait before a counter is drawn as late. */
  patienceMinutes: number;
};

export type HospitalFlow3DProps = {
  data: FlowData;
  /** Height of the scene box, e.g. 560 or '70vh'. */
  height?: number | string;
  className?: string;
  /** A counter was clicked. */
  onStation?: (id: FlowStationId) => void;
  /** The counter chosen elsewhere on the page: the camera goes to it too, so
   *  the written list and the machine never show different counters. */
  focus?: FlowStationId | null;
};

export default function HospitalFlow3D({
  data,
  height = 560,
  className,
  onStation,
  focus = null,
}: HospitalFlow3DProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  // The scene is built once; `data` reaches it through this ref, so a queue
  // changing repaints the screens instead of rebuilding the machine.
  const latest = useRef({ data, onStation });
  latest.current = { data, onStation };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let scene: SceneHandle | undefined;
    let cancelled = false;
    // The screens are painted on canvases: wait for fonts, or the first paint
    // measures text in a fallback face and never matches the second.
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      scene = initFlowScene(root, getComputedStyle(root).fontFamily, {
        getData: () => latest.current.data,
        onStation: (id) => latest.current.onStation?.(id),
      });
      sceneRef.current = scene ?? null;
    });
    return () => {
      cancelled = true;
      sceneRef.current = null;
      scene?.dispose();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(data);
  }, [data]);

  useEffect(() => {
    if (focus) sceneRef.current?.focus(focus);
  }, [focus]);

  return (
    <div
      ref={rootRef}
      className={["hospital-flow-3d", className].filter(Boolean).join(" ")}
      style={{ height }}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div
        id="scene"
        role="img"
        aria-label="The clinic as a machine: five counters — front desk, vitals, doctor, pharmacy and billing — with today's patients moving between them. Drag to turn it, scroll to come closer, click a counter to see who is waiting there."
      />
      <div className="vignette" />
      <header className="topbar">
        <div className="identity">
          <div className="mark" aria-hidden>
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 3v14M3 10h14"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div>
            <strong id="clinic-name">{data.clinicName}</strong>
            <small>The day, as it stands</small>
          </div>
        </div>
        <div className="status" id="status">
          <i />
          <span id="status-text">In the building</span>
          <span id="status-count" />
        </div>
      </header>
      <div className="scene-heading">
        <span className="chain">Front desk · vitals · doctor · pharmacy · billing</span>
        <span className="index" id="heading-index" />
      </div>
      <div id="journey">
        <div className="journey-icon" aria-hidden>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M3 4h10v9H3zM6 4V2h4v2m-5 4h6" stroke="currentColor" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <strong id="journey-title">Nobody in the building</strong>
          <small id="journey-detail">A patient appears here as soon as the desk registers one.</small>
        </div>
        <div className="track">
          <i id="journey-progress" />
        </div>
      </div>
      <div id="labels" />
      <div id="tooltip" role="tooltip">
        <strong />
        <p />
      </div>
      <div className="controls">
        <nav className="mode-bar" aria-label="What to show">
          <button type="button" data-mode="assembled" aria-pressed="true">
            Whole clinic
          </button>
          <button type="button" data-mode="stations" aria-pressed="false">
            Counters
          </button>
          <button type="button" data-mode="cutaway" aria-pressed="false">
            Cutaway
          </button>
          <button type="button" data-mode="order" aria-pressed="false">
            One patient
          </button>
        </nav>
        <nav className="camera-row" aria-label="View">
          <span className="caption">VIEW</span>
          <button type="button" data-camera="overview" aria-pressed="true">
            Over
          </button>
          <button type="button" data-camera="side" aria-pressed="false">
            Side
          </button>
          <button type="button" data-camera="top" aria-pressed="false">
            Top
          </button>
          <button type="button" data-camera="station" aria-pressed="false">
            Counter
          </button>
          <button type="button" data-camera="flight" aria-pressed="false">
            Around
          </button>
          <span className="divider" />
          <button type="button" id="play" aria-label="Stop the movement" aria-pressed="false">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="1" width="2.5" height="10" rx=".5" />
              <rect x="7.5" y="1" width="2.5" height="10" rx=".5" />
            </svg>
          </button>
        </nav>
      </div>
      <footer className="footer">
        <span className="hint">
          <svg width="13" height="16" viewBox="0 0 13 16" fill="none" aria-hidden>
            <rect x="2" y="1" width="9" height="14" rx="4.5" stroke="currentColor" />
            <path d="M6.5 4v3" stroke="currentColor" strokeLinecap="round" />
          </svg>
          Drag to turn · Ctrl+scroll to zoom · click a counter
        </span>
      </footer>
      <div id="loading">
        <i />
        <span>Building the clinic</span>
      </div>
      <div id="error" role="alert">
        <strong>This view could not start</strong>
        <p>It needs 3D drawing (WebGL) turned on in the browser. Everything else on this page works without it.</p>
      </div>
    </div>
  );
}

/* ========================================================================= *
 * The scene
 * ========================================================================= */

type SceneHandle = {
  dispose: () => void;
  update: (data: FlowData) => void;
  focus: (id: FlowStationId) => void;
};

type SceneOptions = {
  getData: () => FlowData;
  onStation?: (id: FlowStationId) => void;
};

type Mode = "assembled" | "cutaway" | "stations" | "order";
type CameraMode = "overview" | "side" | "top" | "station" | "flight";

/** The five counters, in the order a patient meets them. */
const COUNTERS: {
  id: FlowStationId;
  name: string;
  /** What a patient is waiting for here. */
  waitingFor: string;
  pos: [number, number, number];
}[] = [
  { id: "desk", name: "Front desk", waitingFor: "for an answer from the desk", pos: [4.03, 0.29, 0.12] },
  { id: "vitals", name: "Vitals", waitingFor: "for their reading", pos: [-4.15, 0.29, -0.65] },
  { id: "doctor", name: "Doctor", waitingFor: "for the doctor", pos: [-1.65, 0.29, -2.03] },
  { id: "pharmacy", name: "Pharmacy", waitingFor: "for their medicines", pos: [1.5, 0.29, -2.08] },
  { id: "billing", name: "Billing", waitingFor: "to pay", pos: [0.93, 0.29, 1.85] },
];

const EMPTY_STATION = (id: FlowStationId): FlowStation => ({
  id,
  count: 0,
  longestWait: null,
  people: [],
  present: true,
  staffed: true,
  note: null,
});

export const EMPTY_FLOW: FlowData = {
  clinicName: "Your clinic",
  stations: COUNTERS.map((c) => EMPTY_STATION(c.id)),
  following: null,
  seenToday: 0,
  takings: 0,
  lastParcha: null,
  lastBill: null,
  patienceMinutes: 30,
};

function initFlowScene(
  root: HTMLElement,
  fontFamily: string,
  options: SceneOptions,
): SceneHandle | undefined {
  const cleanups: Array<() => void> = [];
  const frameWidth = () => root.clientWidth;
  const frameHeight = () => root.clientHeight;
  const listen = (target: EventTarget, type: string, handler: (event: never) => void) => {
    const fn = handler as unknown as EventListener;
    target.addEventListener(type, fn);
    cleanups.push(() => target.removeEventListener(type, fn));
  };
  function $<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`The scene's markup is missing #${id}`);
    return el;
  }
  function showError(message?: string) {
    $("loading").classList.add("done");
    $("error").style.display = "block";
    if (message) $("error").querySelector("p")!.textContent = message;
  }
  const dispose = () => {
    for (const fn of cleanups.reverse()) fn();
    cleanups.length = 0;
  };

  try {
    const TAU = Math.PI * 2;
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    /** Everything the screens draw. Replaced by update(), read by the painters. */
    let live: FlowData = options.getData();
    const stationData = (id: FlowStationId): FlowStation =>
      live.stations.find((s) => s.id === id) ?? EMPTY_STATION(id);
    const late = (s: FlowStation) => (s.longestWait ?? 0) >= live.patienceMinutes;
    /** Why a counter is dark, or null when it is open. */
    const shut = (s: FlowStation) =>
      !s.present ? "No counter here" : !s.staffed ? "Nobody on this counter" : null;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, frameWidth() / frameHeight(), 0.1, 150);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (e) {
      showError("This computer could not start 3D drawing (WebGL). Everything else on this page works without it.");
      throw e;
    }
    // Transparent: the card's own paper shows through behind the machine.
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio, frameWidth() < 900 ? 1.5 : 1.75));
    renderer.setSize(frameWidth(), frameHeight());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    $("scene").appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 55;
    controls.minPolarAngle = 0.09;
    controls.maxPolarAngle = Math.PI * 0.475;
    controls.rotateSpeed = 0.48;
    controls.zoomSpeed = 0.7;
    // This is one card on a page that scrolls. A wheel over it must scroll
    // Management, not creep the camera in, so zoom is off until the wheel is
    // held with Ctrl (or Cmd) — the capture listener runs before the controls'
    // own, and with zoom off they let the event through to the page.
    controls.enableZoom = false;
    listen(renderer.domElement, "wheel", (e: WheelEvent) => {
      controls.enableZoom = e.ctrlKey || e.metaKey;
    });
    // On a phone one finger scrolls the page (with touch-action: pan-y); two
    // turn and zoom the machine.
    if (matchMedia("(pointer:coarse)").matches) {
      controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
    }

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.62;
    room.dispose();
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xdbe5f4, 0x29211a, 2));
    const key = new THREE.DirectionalLight(0xfff1d8, 4.2);
    key.position.set(-4, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, near: 0.5, far: 35 });
    key.shadow.normalBias = 0.035;
    key.shadow.bias = -0.0002;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc4d4ed, 3.1);
    rim.position.set(3, 7, -8);
    scene.add(rim);
    const warm = new THREE.PointLight(0xffbd42, 28, 20, 2);
    warm.position.set(-4, 5, 3);
    scene.add(warm);
    const front = new THREE.DirectionalLight(0xffffff, 1);
    front.position.set(5, 3, 10);
    scene.add(front);

    const mat = (
      color: number,
      metalness = 0.1,
      roughness = 0.4,
      extra: THREE.MeshStandardMaterialParameters = {},
    ) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
    const M = {
      body: mat(0x30363f, 0.75, 0.29),
      base: mat(0x292f37, 0.85, 0.32),
      edge: mat(0x707986, 0.85, 0.24),
      chrome: mat(0xc3cad0, 0.92, 0.18),
      dark: mat(0x12171d, 0.45, 0.38),
      rubber: mat(0x0b1015, 0.1, 0.6),
      amber: mat(0xff7a1a, 0.52, 0.28),
      ivory: mat(0xe0ded4, 0.48, 0.26),
      copper: mat(0xc57e45, 0.85, 0.3),
      light: mat(0xff7a1a, 0.2, 0.25, { emissive: 0xff7a1a, emissiveIntensity: 1.5 }),
      green: mat(0xc6d9a1, 0.1, 0.3, { emissive: 0x91b364, emissiveIntensity: 0.7 }),
    };

    type Vec3 = [number, number, number];
    type Material = THREE.Material;
    const geometries = new Map<string, THREE.BufferGeometry>();
    function boxGeo(w: number, h: number, d: number, r = 0.04) {
      const k = `b${w},${h},${d},${r}`;
      if (!geometries.has(k))
        geometries.set(
          k,
          r ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3)) : new THREE.BoxGeometry(w, h, d),
        );
      return geometries.get(k)!;
    }
    function box(
      parent: THREE.Object3D,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      m: Material = M.body,
      r = 0.04,
    ) {
      const o = new THREE.Mesh(boxGeo(w, h, d, r), m);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    }
    function cyl(
      parent: THREE.Object3D,
      r: number,
      h: number,
      x: number,
      y: number,
      z: number,
      m: Material = M.chrome,
      r2: number = r,
      segments = 24,
    ) {
      const k = `c${r},${r2},${h},${segments}`;
      if (!geometries.has(k)) geometries.set(k, new THREE.CylinderGeometry(r, r2, h, segments));
      const o = new THREE.Mesh(geometries.get(k)!, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    }
    function ball(parent: THREE.Object3D, r: number, x: number, y: number, z: number, m: Material = M.chrome) {
      const k = `s${r}`;
      if (!geometries.has(k)) geometries.set(k, new THREE.SphereGeometry(r, 12, 8));
      const o = new THREE.Mesh(geometries.get(k)!, m);
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    }
    function tube(parent: THREE.Object3D, pts: Vec3[], r: number, m: Material = M.chrome) {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      const o = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, pts.length * 7), r, 8, false), m);
      o.castShadow = true;
      parent.add(o);
      return o;
    }
    function screw(parent: THREE.Object3D, x: number, y: number, z: number) {
      cyl(parent, 0.055, 0.026, x, y, z, M.chrome, undefined, 12);
      box(parent, 0.068, 0.005, 0.009, x, y + 0.014, z, M.dark, 0);
    }

    type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
    type Painted = { texture: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; w: number; h: number };
    function canvasTexture(w: number, h: number, draw: Draw): Painted {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      draw(ctx, w, h);
      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      return { texture, ctx, w, h };
    }
    /** Draws over a painted surface again; the GPU copy follows. */
    function repaint(target: Painted, draw: Draw) {
      target.ctx.clearRect(0, 0, target.w, target.h);
      target.ctx.textAlign = "left";
      draw(target.ctx, target.w, target.h);
      target.texture.needsUpdate = true;
    }
    function print(
      ctx: CanvasRenderingContext2D,
      txt: string,
      x: number,
      y: number,
      size = 20,
      color = "#f4f1ea",
      weight = 500,
    ) {
      ctx.fillStyle = color;
      ctx.font = `${weight} ${size}px ${fontFamily}`;
      ctx.fillText(txt, x, y);
    }
    /** Keeps a name inside its box rather than letting it run off the screen. */
    function fit(ctx: CanvasRenderingContext2D, txt: string, size: number, weight: number, max: number) {
      ctx.font = `${weight} ${size}px ${fontFamily}`;
      if (ctx.measureText(txt).width <= max) return txt;
      let cut = txt;
      while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
      return `${cut}…`;
    }
    const wait = (m: number | null) => (m == null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

    function screen(
      parent: THREE.Object3D,
      w: number,
      h: number,
      x: number,
      y: number,
      z: number,
      tex: Painted,
    ) {
      const o = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex.texture, toneMapped: false }),
      );
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    }

    const machine = new THREE.Group();
    scene.add(machine);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.ShadowMaterial({ opacity: 0.17 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.43;
    floor.receiveShadow = true;
    scene.add(floor);
    const shadow = canvasTexture(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(64, 64, 12, 64, 64, 64);
      g.addColorStop(0, "rgba(0,0,0,.8)");
      g.addColorStop(0.55, "rgba(0,0,0,.45)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 13),
      new THREE.MeshBasicMaterial({ map: shadow.texture, transparent: true, depthWrite: false, opacity: 0.38 }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -0.415;
    scene.add(contact);

    // The plate, with the clinic's own name engraved along its front edge.
    box(machine, 12.8, 0.38, 8.25, 0, -0.09, 0, M.base, 0.17);
    box(machine, 12.6, 0.055, 8.08, 0, 0.13, 0, M.edge, 0.11);
    box(machine, 12.49, 0.09, 7.96, 0, 0.19, 0, M.body, 0.1);
    box(machine, 12.55, 0.027, 8.02, 0, -0.19, 0, M.dark, 0.06);
    box(machine, 11.9, 0.026, 0.032, 0, -0.17, 4.115, M.light, 0.01);
    for (const x of [-5.6, 5.6])
      for (const z of [-3.35, 3.35]) {
        cyl(machine, 0.39, 0.25, x, -0.31, z, M.rubber);
        cyl(machine, 0.29, 0.09, x, -0.4, z, M.dark);
        screw(machine, x, 0.253, z);
      }
    for (const x of [-6.02, 6.02]) for (const z of [-3.73, 3.73]) screw(machine, x, 0.255, z);
    const nameplate = canvasTexture(1536, 176, () => {});
    function drawNameplate(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = "#252b32";
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "#4d545c";
      c.lineWidth = 2;
      c.strokeRect(2, 2, w - 4, h - 4);
      print(c, fit(c, live.clinicName.toUpperCase(), 40, 650, 520), 45, 79, 40, "#d9d8cd", 650);
      print(c, "·  the day, counter by counter", 600, 79, 34, "#b8bdc1", 450);
      print(c, "FRONT DESK  /  VITALS  /  DOCTOR  /  PHARMACY  /  BILLING", 47, 133, 19, "#737e88", 500);
      print(c, `${live.seenToday} seen today`, 1230, 130, 23, "#c57e45");
    }
    repaint(nameplate, drawNameplate);
    const plate = screen(machine, 7.35, 0.84, -0.4, 0.25, 3.51, nameplate);
    plate.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 16; i++)
      box(machine, 0.015, 0.009, 0.11 + (i % 4) * 0.035, -5.6 + i * 0.09, 0.249, 3.5, M.edge, 0);

    // Faint drafting marks on the floor, so the plate sits on something.
    const drafting = new THREE.Group();
    scene.add(drafting);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x232326, transparent: true, opacity: 0.1 });
    const draftingPoints: THREE.Vector3[] = [];
    for (const r of [7.5, 8.1])
      for (let i = 0; i < 120; i++)
        for (const j of [i, i + 1]) {
          const a = (j / 120) * TAU;
          draftingPoints.push(new THREE.Vector3(Math.cos(a) * r, -0.4, Math.sin(a) * r * 0.72));
        }
    drafting.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(draftingPoints), lineMat));

    /* --------------------------------------------------------------- counters */

    type Station = (typeof COUNTERS)[number] & {
      group: THREE.Group;
      base: THREE.Vector3;
      glowMat: THREE.MeshStandardMaterial;
      label: HTMLDivElement;
      index: number;
      plaque: Painted;
    };
    const stations: Station[] = [];
    const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
    function shell<T extends THREE.Material>(m: T): T {
      const s = m.clone() as T;
      s.clippingPlanes = [cutPlane];
      s.clipShadows = true;
      s.side = THREE.DoubleSide;
      return s;
    }
    const S = { body: shell(M.body), ivory: shell(M.ivory), amber: shell(M.amber) };
    const gears: Array<{ g: THREE.Group; vertical: boolean }> = [];
    function gear(parent: THREE.Object3D, x: number, y: number, z: number, r = 0.3, vertical = false) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      if (vertical) g.rotation.x = Math.PI / 2;
      parent.add(g);
      cyl(g, r, 0.09, 0, 0, 0, M.copper);
      cyl(g, r * 0.66, 0.105, 0, 0, 0, M.dark);
      cyl(g, r * 0.22, 0.14, 0, 0, 0, M.chrome);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const b = box(g, r * 0.26, 0.085, r * 0.2, Math.cos(a) * r, 0, Math.sin(a) * r, M.copper, 0.008);
        b.rotation.y = -a;
      }
      g.userData.moving = true;
      gears.push({ g, vertical });
      return g;
    }

    COUNTERS.forEach((d, i) => {
      const group = new THREE.Group();
      group.position.fromArray(d.pos);
      machine.add(group);
      const glowMat = M.light.clone();
      glowMat.emissiveIntensity = 0.5;
      box(group, 2.05, 0.12, 1.78, 0, 0.03, 0, M.dark, 0.1);
      box(group, 1.97, 0.03, 1.7, 0, 0.12, 0, glowMat, 0.09);
      box(group, 2.03, 0.17, 1.75, 0, 0.215, 0, M.body, 0.1);
      for (const x of [-0.85, 0.85]) for (const z of [-0.7, 0.7]) screw(group, x, 0.311, z);
      gear(group, -0.35, 0.45, 0, 0.27);
      gear(group, 0.22, 0.45, 0.12, 0.21);
      box(group, 0.6, 0.15, 0.36, 0.52, 0.47, -0.33, M.dark);
      for (let j = 0; j < 6; j++) box(group, 0.025, 0.16, 0.37, 0.3 + j * 0.08, 0.47, -0.33, M.edge, 0.004);
      tube(
        group,
        [
          [-0.7, 0.4, -0.4],
          [-0.55, 0.48, 0.4],
          [0.35, 0.45, 0.6],
          [0.7, 0.58, 0.23],
        ],
        0.023,
        M.light,
      );
      // The counter's own plaque: its number, its name and how many are waiting.
      const plaque = canvasTexture(512, 116, () => {});
      screen(group, 1.54, 0.345, 0, 0.27, 0.891, plaque);

      const label = document.createElement("div");
      label.className = "station-label";
      label.innerHTML = `<div class="stem"></div><div class="label-card"><div class="label-title"><span>${String(i + 1).padStart(2, "0")}</span>${d.name}</div><div class="label-meta"></div></div>`;
      $("labels").appendChild(label);
      cleanups.push(() => label.remove());

      stations.push({ ...d, group, base: new THREE.Vector3(...d.pos), glowMat, label, index: i, plaque });
    });

    /* ------------------------------------------------- 01 the front desk */

    const desk = stations[0].group;
    box(desk, 1.75, 1.77, 1.02, 0, 1.24, -0.13, S.body, 0.12);
    box(desk, 1.58, 0.13, 1.09, 0, 2.16, -0.13, S.amber, 0.04);
    box(desk, 1.47, 1.38, 0.055, 0, 1.31, 0.405, M.dark, 0.025);
    const arrivals = canvasTexture(480, 460, () => {});
    function drawArrivals(c: CanvasRenderingContext2D, w: number, h: number) {
      const s = stationData("desk");
      c.fillStyle = "#172224";
      c.fillRect(0, 0, w, h);
      print(c, "ASKED FROM A PHONE", 30, 51, 25, "#e8e8d8", 550);
      print(c, s.count === 0 ? "Nothing waiting for an answer" : `${s.count} waiting · longest ${wait(s.longestWait)}`, 30, 81, 16, late(s) ? "#e58a5a" : "#869991");
      const shown = s.people.slice(0, 3);
      if (shown.length === 0) {
        print(c, "The desk is clear.", 30, 190, 22, "#4e6162");
        return;
      }
      shown.forEach((p, i) => {
        const y = 110 + i * 100;
        c.fillStyle = "#283839";
        c.beginPath();
        c.roundRect(22, y, 436, 83, 8);
        c.fill();
        c.fillStyle = p.waitedMinutes >= live.patienceMinutes ? "#e07c3c" : ["#ff7a1a", "#bdbf9c", "#7d938e"][i];
        c.beginPath();
        c.arc(58, y + 40, 19, 0, TAU);
        c.fill();
        print(c, p.token != null ? String(p.token) : p.name.slice(0, 1).toUpperCase(), p.token != null && p.token > 9 ? 44 : 51, y + 47, 20, "#1b2828", 600);
        print(c, fit(c, p.name, 23, 550, 300), 93, y + 33, 23, "#e6e8dc", 550);
        print(c, `waiting ${wait(p.waitedMinutes)}`, 93, y + 58, 15, "#94a59b");
        if (p.flagged) print(c, "allergy", 370, y + 49, 15, "#e9a06a", 600);
      });
    }
    repaint(arrivals, drawArrivals);
    screen(desk, 1.31, 1.255, 0, 1.37, 0.44, arrivals);
    box(desk, 1.27, 0.075, 0.29, 0, 0.57, 0.55, M.chrome, 0.02);
    for (let i = 0; i < 3; i++) box(desk, 1.15, 0.021, 0.12, 0, 0.58 + i * 0.15, -0.35, M.copper, 0.006);
    tube(
      desk,
      [
        [0.69, 0.43, -0.2],
        [0.89, 0.65, -0.2],
        [0.89, 1.8, -0.2],
        [0.65, 1.99, -0.2],
      ],
      0.033,
      M.chrome,
    );
    // A card drops in each time somebody is registered.
    const incoming = new THREE.Group();
    incoming.userData.moving = true;
    desk.add(incoming);
    box(incoming, 0.86, 0.42, 0.043, 0, 0, 0, M.light, 0.035);
    const incomingCard = canvasTexture(432, 204, () => {});
    function drawIncoming(c: CanvasRenderingContext2D, w: number, h: number) {
      const next = stationData("desk").people[0] ?? live.following;
      c.fillStyle = "#ff7a1a";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#2a2e26";
      c.beginPath();
      c.arc(58, 98, 32, 0, TAU);
      c.fill();
      const token = next && "token" in next ? next.token : null;
      print(c, token != null ? String(token) : "+", token != null && token > 9 ? 36 : 48, 112, 34, "#ff7a1a", 550);
      print(c, fit(c, next?.name ?? "New patient", 38, 600, 300), 108, 91, 38, "#222822", 600);
      print(c, "just registered", 108, 138, 23, "#5b4c22", 500);
    }
    repaint(incomingCard, drawIncoming);
    screen(incoming, 0.82, 0.39, 0, 0, 0.026, incomingCard);

    /* ------------------------------------------------------ 02 the vitals */

    const vitals = stations[1].group;
    box(vitals, 1.74, 0.62, 1.33, 0, 0.65, -0.05, S.ivory, 0.13);
    box(vitals, 1.5, 0.1, 1.16, 0, 0.99, -0.04, S.body, 0.025);
    for (const x of [-0.68, 0.68]) {
      cyl(vitals, 0.065, 1.73, x, 1.35, -0.18, M.chrome);
      box(vitals, 0.22, 1.8, 0.22, x, 1.37, -0.44, S.ivory, 0.035);
    }
    box(vitals, 1.82, 0.27, 0.4, 0, 2.28, -0.35, S.amber, 0.045);
    box(vitals, 1.55, 0.06, 0.06, 0, 2.13, -0.115, M.chrome, 0.01);
    // The arm that takes the reading, sweeping as it works.
    const cuffArm = new THREE.Group();
    vitals.add(cuffArm);
    cuffArm.position.set(0, 1.9, -0.08);
    cuffArm.userData.moving = true;
    box(cuffArm, 0.45, 0.36, 0.44, 0, 0, 0, M.body, 0.05);
    cyl(cuffArm, 0.11, 0.13, 0, -0.24, 0.03, M.chrome, 0.04);
    box(cuffArm, 0.24, 0.045, 0.022, 0, 0.09, 0.23, M.light, 0.01);
    const dials: THREE.Group[] = [];
    for (const [x, y] of [
      [-1.03, 1.82],
      [-0.94, 2.78],
    ]) {
      const dial = new THREE.Group();
      dial.position.set(x, y, -0.48);
      vitals.add(dial);
      dial.userData.moving = true;
      const core = cyl(dial, 0.4, 0.22, 0, 0, 0, M.dark);
      core.rotation.x = Math.PI / 2;
      for (const z of [-0.14, 0.14]) {
        const disc = cyl(dial, 0.46, 0.045, 0, 0, z, M.chrome);
        disc.rotation.x = Math.PI / 2;
      }
      const needle = cyl(dial, 0.095, 0.37, 0, 0, 0, M.amber);
      needle.rotation.x = Math.PI / 2;
      dials.push(dial);
    }
    // The reading as it is written down, upright beside the machine.
    const reading = canvasTexture(384, 640, () => {});
    function drawReading(c: CanvasRenderingContext2D, w: number, h: number) {
      const s = stationData("vitals");
      c.fillStyle = "#ff7a1a";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#c57e45";
      c.beginPath();
      c.arc(330, 205, 210, 0, TAU);
      c.fill();
      print(c, "TODAY'S", 28, 57, 24, "#242320", 650);
      print(c, "READING", 24, 103, 42, "#242320", 700);
      c.fillStyle = "#171b20";
      c.beginPath();
      c.roundRect(25, 150, 334, 300, 12);
      c.fill();
      const p = s.people[0];
      print(c, p ? fit(c, p.name, 27, 600, 290) : "Nobody here", 45, 196, 27, "#f4f1ea", 600);
      print(c, s.count ? `${s.count} waiting for vitals` : "The vitals counter is clear", 45, 234, 19, "#9aa39d");
      print(c, s.count ? wait(s.longestWait) : "—", 45, 310, 54, late(s) ? "#ff9a4a" : "#f4f1ea", 600);
      print(c, "longest wait here", 45, 342, 18, "#8c948f");
      const closed = shut(s);
      print(c, closed ?? "Counter open", 45, 410, 20, closed ? "#e07c3c" : "#a9c08a", 600);
      print(c, "PARCHA", 25, 600, 24, "#242320", 650);
    }
    repaint(reading, drawReading);
    const readingBoard = new THREE.Group();
    readingBoard.userData.moving = true;
    vitals.add(readingBoard);
    box(readingBoard, 0.62, 1.08, 0.055, 0, 1.36, 0.61, M.dark, 0.035);
    screen(readingBoard, 0.56, 0.98, 0, 1.36, 0.641, reading);
    box(vitals, 1.14, 0.12, 0.2, 0, 0.83, 0.66, M.dark, 0.025);
    for (const x of [-0.42, 0.42]) {
      const r = cyl(vitals, 0.115, 0.18, x, 0.92, 0.6, M.chrome);
      r.rotation.z = Math.PI / 2;
    }

    /* ------------------------------------------------------ 03 the doctor */

    const doctor = stations[2].group;
    box(doctor, 1.9, 0.66, 1.36, 0, 0.67, -0.04, S.body, 0.11);
    const consoleTop = new THREE.Group();
    consoleTop.position.set(0, 1.01, -0.08);
    consoleTop.rotation.x = -0.32;
    doctor.add(consoleTop);
    box(consoleTop, 1.76, 0.12, 1.27, 0, 0, 0, S.ivory, 0.04);
    const queue = canvasTexture(640, 340, () => {});
    function drawQueue(c: CanvasRenderingContext2D, w: number, h: number, t = 0) {
      const s = stationData("doctor");
      c.fillStyle = "#111b20";
      c.fillRect(0, 0, w, h);
      print(c, "THE DOCTOR'S QUEUE", 25, 45, 21, "#acb9b8", 550);
      print(c, s.note ?? `${s.count} waiting`, 420, 45, 20, late(s) ? "#e58a5a" : "#ff7a1a", 500);
      const shown = s.people.slice(0, 3);
      if (shown.length === 0) {
        print(c, "Nobody is waiting for the doctor.", 25, 150, 22, "#4a5b5e");
        return;
      }
      shown.forEach((p, i) => {
        const y = 74 + i * 76;
        c.fillStyle = "#202c30";
        c.beginPath();
        c.roundRect(21, y, 598, 61, 6);
        c.fill();
        c.fillStyle = i === 0 ? "#c57e45" : "#626f69";
        c.fillRect(34, y + 10, 27, 41);
        print(c, fit(c, p.name, 19, 500, 270), 77, y + 29, 19, "#d4d8cc");
        print(
          c,
          `${p.token != null ? `token ${p.token} · ` : ""}waiting ${wait(p.waitedMinutes)}${p.flagged ? " · allergy" : ""}`,
          77,
          y + 49,
          11,
          p.waitedMinutes >= live.patienceMinutes ? "#e58a5a" : "#81948f",
        );
        // How far this wait has run against the clinic's own patience.
        const share = Math.min(1, p.waitedMinutes / Math.max(1, live.patienceMinutes));
        c.fillStyle = "#334348";
        c.fillRect(377, y + 26, 214, 7);
        c.fillStyle = share >= 1 ? "#e07c3c" : i === 0 ? "#ff7a1a" : "#607475";
        c.fillRect(377, y + 26, Math.max(6, share * 214), 7);
        if (i === 0) {
          c.fillStyle = "#fff7d4";
          c.fillRect(377, y + 38, Math.max(4, ((t * 0.15) % 1) * 214), 2);
        }
      });
    }
    repaint(queue, (c, w, h) => drawQueue(c, w, h));
    const qs = screen(consoleTop, 1.53, 0.79, 0, 0.067, -0.17, queue);
    qs.rotation.x = -Math.PI / 2;
    const toggles: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const x = -0.57 + i * 0.38;
      cyl(consoleTop, 0.074, 0.035, x, 0.1, 0.45, M.dark);
      const t = cyl(consoleTop, 0.025, 0.15, x, 0.19, 0.45, M.chrome);
      t.rotation.x = -0.4;
      t.userData.moving = true;
      toggles.push(t);
      ball(consoleTop, 0.04, x, 0.275, 0.421, M.ivory);
    }
    cyl(doctor, 0.075, 0.06, 0.77, 1.05, -0.62, M.green);
    for (let i = 0; i < 7; i++) box(doctor, 0.55, 0.027, 0.02, 0, 0.46 + i * 0.05, 0.655, M.dark, 0.003);

    /* ---------------------------------------------------- 04 the pharmacy */

    const pharmacy = stations[3].group;
    box(pharmacy, 1.35, 0.18, 0.88, 0, 0.44, 0, S.ivory, 0.045);
    cyl(pharmacy, 0.095, 1.04, 0, 0.93, -0.31, M.chrome);
    box(pharmacy, 0.56, 0.91, 0.14, 0, 0.99, -0.34, S.body, 0.04);
    box(pharmacy, 2.42, 1.72, 0.2, 0, 1.94, -0.17, S.ivory, 0.08);
    box(pharmacy, 2.28, 1.59, 0.1, 0, 1.94, -0.044, M.dark, 0.045);
    // The board above the counter: the last Parcha, as the pharmacy reads it.
    const parchaBoard = canvasTexture(896, 592, () => {});
    function drawParcha(c: CanvasRenderingContext2D, w: number, h: number) {
      const s = stationData("pharmacy");
      c.fillStyle = "#edece3";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#dedfd7";
      c.fillRect(0, 0, w, 56);
      print(c, "PHARMACY", 33, 36, 19, "#44504c", 650);
      print(c, s.count ? `${s.count} waiting · longest ${wait(s.longestWait)}` : "Nobody waiting", 620, 36, 16, late(s) ? "#b4552a" : "#6a7271");
      const rx = live.lastParcha;
      print(c, rx ? fit(c, rx.patient, 29, 700, 300) : "No prescription yet today", 33, 100, 29, "#22282b", 700);
      print(c, rx?.diagnosis ? fit(c, rx.diagnosis, 19, 400, 300) : "", 33, 128, 19, "#77807b");
      c.fillStyle = "#ff7a1a";
      c.beginPath();
      c.roundRect(32, 150, 287, 382, 10);
      c.fill();
      print(c, "THE LAST", 52, 196, 29, "#242827", 700);
      print(c, "PARCHA", 52, 235, 29, "#242827", 700);
      print(c, rx ? `${rx.medicines.length} medicines` : "—", 52, 290, 23, "#4a3a18", 600);
      const lines = rx?.medicines.slice(0, 7) ?? [];
      lines.forEach((m, i) => print(c, fit(c, `• ${m}`, 19, 500, 240), 52, 330 + i * 28, 19, "#2c2a22"));
      // What is still owed to the people standing there.
      print(c, "WAITING AT THIS COUNTER", 362, 190, 14, "#879088", 600);
      const people = s.people.slice(0, 4);
      if (people.length === 0) print(c, "Nobody. The counter is clear.", 362, 232, 21, "#8a918c");
      people.forEach((p, i) => {
        const y = 222 + i * 54;
        c.fillStyle = "#e2e1d8";
        c.beginPath();
        c.roundRect(360, y, 500, 44, 7);
        c.fill();
        print(c, fit(c, p.name, 20, 550, 300), 376, y + 29, 20, "#22282b", 550);
        print(c, wait(p.waitedMinutes), 740, y + 29, 18, p.waitedMinutes >= live.patienceMinutes ? "#b4552a" : "#77807b");
      });
      print(c, (shut(s) ?? "Counter open").toUpperCase(), 362, 500, 15, shut(s) ? "#b4552a" : "#879088", 600);
    }
    repaint(parchaBoard, drawParcha);
    screen(pharmacy, 2.16, 1.43, 0, 1.95, 0.011, parchaBoard);
    ball(pharmacy, 0.024, 0, 2.747, -0.05, M.dark);
    box(pharmacy, 0.21, 0.019, 0.008, 0, 1.149, 0.013, M.light, 0.003);
    // A packet handed over, bobbing at the counter's edge.
    const handover = new THREE.Group();
    handover.userData.moving = true;
    pharmacy.add(handover);
    box(handover, 0.59, 0.77, 0.045, 0.94, 0.81, 0.55, M.ivory, 0.025);
    const packetFace = canvasTexture(220, 290, () => {});
    function drawPacket(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = "#f4f1ea";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#ff7a1a";
      c.fillRect(15, 16, 190, 168);
      c.fillStyle = "#272e30";
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.roundRect(40 + i * 44, 60, 28, 72, 9);
        c.fill();
      }
      print(c, "MEDICINES", 17, 225, 23, "#283030", 600);
      const rx = live.lastParcha;
      print(c, fit(c, rx?.patient ?? "—", 17, 400, 180), 17, 252, 17, "#5f6a66");
      print(c, rx ? `${rx.medicines.length} items` : "", 17, 274, 15, "#8d9793");
    }
    repaint(packetFace, drawPacket);
    screen(handover, 0.55, 0.72, 0.94, 0.81, 0.575, packetFace);

    /* ----------------------------------------------------- 05 the billing */

    const billing = stations[4].group;
    box(billing, 1.91, 0.63, 1.32, 0, 0.65, -0.06, S.ivory, 0.12);
    box(billing, 1.96, 0.19, 1.38, 0, 0.42, -0.04, S.body, 0.04);
    box(billing, 1.37, 0.09, 0.038, 0, 0.44, 0.66, M.dark, 0.01);
    box(billing, 0.37, 0.042, 0.03, 0, 0.45, 0.687, M.chrome, 0.009);
    box(billing, 1.02, 0.25, 0.91, -0.33, 1.04, -0.03, S.body, 0.045);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++)
        box(
          billing,
          0.19,
          0.085,
          0.17,
          -0.62 + col * 0.27,
          1.21,
          0.27 - row * 0.24,
          col === 2 && row === 2 ? M.amber : M.ivory,
          0.022,
        );
    box(billing, 0.64, 0.6, 0.52, 0.58, 1.04, -0.15, S.body, 0.045);
    box(billing, 0.48, 0.07, 0.09, 0.59, 1.37, -0.1, M.dark, 0.01);
    cyl(billing, 0.06, 0.65, -0.35, 1.6, -0.56, M.chrome);
    box(billing, 1.13, 0.46, 0.19, -0.35, 1.98, -0.56, S.body, 0.045);
    const takings = canvasTexture(512, 176, () => {});
    function drawTakings(c: CanvasRenderingContext2D, w: number, h: number) {
      const s = stationData("billing");
      c.fillStyle = "#12231e";
      c.fillRect(0, 0, w, h);
      print(c, s.count ? `${s.count} still to pay` : "TAKEN TODAY", 22, 44, 23, s.count ? "#e2b07c" : "#9cae91", 500);
      print(c, `₹${live.takings.toLocaleString("en-IN")}`, 26, 131, 60, "#ecedc7", 500);
    }
    repaint(takings, drawTakings);
    screen(billing, 1.015, 0.349, -0.35, 1.98, -0.459, takings);
    const receipt = new THREE.Group();
    receipt.position.set(0.59, 1.37, -0.1);
    receipt.userData.moving = true;
    billing.add(receipt);
    const receiptFace = canvasTexture(280, 540, () => {});
    function drawReceipt(c: CanvasRenderingContext2D, w: number, h: number) {
      const bill = live.lastBill;
      c.fillStyle = "#f4f1ea";
      c.fillRect(0, 0, w, h);
      print(c, fit(c, live.clinicName.toUpperCase(), 21, 650, 230), 25, 52, 21, "#333d36", 650);
      print(c, "RECEIPT", 25, 87, 19, "#566059");
      c.strokeStyle = "#8a9189";
      c.setLineDash([5, 6]);
      c.beginPath();
      c.moveTo(22, 115);
      c.lineTo(258, 115);
      c.stroke();
      c.setLineDash([]);
      print(c, bill ? fit(c, bill.patient, 22, 500, 230) : "No bill yet", 25, 154, 22, "#333d36");
      print(c, bill ? `₹${bill.total.toLocaleString("en-IN")}` : "—", 25, 200, 30, "#333d36", 600);
      print(c, bill?.mode ? bill.mode : "", 25, 236, 19, "#687067");
      print(c, bill ? "PAID" : "", 25, 290, 31, "#333d36", 650);
      for (let i = 0; i < 44; i++) {
        c.fillStyle = "#333d36";
        c.fillRect(25 + i * 5, 370, 1 + (i % 3), 83);
      }
      print(c, `${live.seenToday} seen today`, 25, 496, 17, "#59635b");
    }
    repaint(receiptFace, drawReceipt);
    const rp = screen(receipt, 0.41, 0.83, 0, 0.415, 0.01, receiptFace);
    (rp.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    receipt.rotation.x = -0.16;
    const coin = new THREE.Group();
    coin.userData.moving = true;
    billing.add(coin);
    const coinDisc = cyl(coin, 0.22, 0.065, 0, 0, 0, M.amber, undefined, 32);
    coinDisc.rotation.x = Math.PI / 2;
    const coinRing = new THREE.Mesh(new THREE.TorusGeometry(0.174, 0.014, 6, 32), M.light);
    coinRing.position.z = 0.037;
    coin.add(coinRing);
    const rupee = canvasTexture(128, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.textAlign = "center";
      print(c, "₹", 64, 95, 85, "#80561c", 650);
    });
    const rupeeFace = screen(coin, 0.28, 0.28, 0, 0, 0.04, rupee);
    (rupeeFace.material as THREE.MeshBasicMaterial).transparent = true;
    cyl(billing, 0.33, 0.09, 1.04, 0.39, 0.55, M.dark);
    cyl(billing, 0.26, 0.025, 1.04, 0.445, 0.55, M.copper);

    /* ------------------------------------------------------------- the belt */

    const path = new THREE.CatmullRomCurve3(
      (
        [
          [-3.95, 0.84, 0.65],
          [-3.1, 0.84, -0.12],
          [-1.45, 0.84, -0.79],
          [1.32, 0.84, -0.8],
          [3.3, 0.84, 0.19],
          [3.43, 0.84, 1.21],
          [1.35, 0.84, 2.7],
          [-1.4, 0.84, 2.52],
          [-3.54, 0.84, 1.65],
        ] as Vec3[]
      ).map((p) => new THREE.Vector3(...p)),
      true,
      "catmullrom",
      0.25,
    );
    const belt = new THREE.Group();
    machine.add(belt);
    const frameMesh = new THREE.Mesh(new THREE.TubeGeometry(path, 150, 0.35, 8, true), M.dark);
    frameMesh.scale.y = 0.3;
    frameMesh.position.y = 0.51;
    belt.add(frameMesh);
    const beltCount = 148;
    const beltSlats = new THREE.InstancedMesh(boxGeo(0.135, 0.065, 0.63, 0.012), M.body, beltCount);
    beltSlats.receiveShadow = true;
    beltSlats.castShadow = false;
    belt.add(beltSlats);
    beltSlats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy = new THREE.Object3D();
    const pVec = new THREE.Vector3();
    const tVec = new THREE.Vector3();
    function updateBelt(t: number) {
      for (let i = 0; i < beltCount; i++) {
        const u = (i / beltCount + t * 0.012) % 1;
        path.getPointAt(u, pVec);
        path.getTangentAt(u, tVec);
        dummy.position.copy(pVec);
        dummy.rotation.set(0, -Math.atan2(tVec.z, tVec.x), 0);
        dummy.updateMatrix();
        beltSlats.setMatrixAt(i, dummy.matrix);
      }
      beltSlats.instanceMatrix.needsUpdate = true;
    }
    updateBelt(0);
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) {
        path.getPointAt(i / 160, pVec);
        path.getTangentAt(i / 160, tVec);
        pts.push(pVec.clone().add(new THREE.Vector3(-tVec.z * 0.36 * side, 0.09, tVec.x * 0.36 * side)));
      }
      belt.add(
        new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.028, 6, false), M.chrome),
      );
    }
    for (let i = 0; i < 16; i++) {
      const p = path.getPointAt(i / 16);
      cyl(belt, 0.045, 0.43, p.x, 0.53, p.z, M.chrome);
    }
    // Copper lines between the counters: who sends whom to whom.
    const pipes = new THREE.Group();
    machine.add(pipes);
    for (let i = 0; i < 4; i++) {
      const a = stations[i].base;
      const b = stations[i + 1].base;
      const curve = new THREE.CatmullRomCurve3([
        a.clone().add(new THREE.Vector3(0.4, 0.12, 0)),
        a.clone().lerp(b, 0.35).add(new THREE.Vector3(0, 0.1, -0.6)),
        a.clone().lerp(b, 0.65).add(new THREE.Vector3(0, 0.1, -0.6)),
        b.clone().add(new THREE.Vector3(-0.4, 0.12, 0)),
      ]);
      pipes.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.054, 8, false), M.copper));
    }

    /* ------------------------------------------------- the patients on the belt */

    // One card per patient in the building, up to six. Each carries the
    // patient's own name and token, and changes face as it passes a counter.
    const CARD_FACES = ["At the desk", "Vitals", "With the doctor", "Pharmacy", "Billing"];
    type Packet = {
      group: THREE.Group;
      face: Painted;
      mesh: THREE.Mesh;
      halo: THREE.Mesh;
      stage: number;
      phase: number;
      person: FlowPerson | null;
    };
    const packets: Packet[] = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      g.userData.moving = true;
      machine.add(g);
      box(g, 0.47, 0.71, 0.04, 0, 0, 0, M.ivory, 0.022);
      const face = canvasTexture(256, 352, () => {});
      const mesh = screen(g, 0.43, 0.665, 0, 0, 0.024, face);
      (mesh.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.414, 40),
        new THREE.MeshBasicMaterial({
          color: 0xff7a1a,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = -0.37;
      g.add(halo);
      halo.visible = false;
      packets.push({ group: g, face, mesh, halo, stage: -1, phase: 0, person: null });
    }
    function drawCard(packet: Packet, stage: number) {
      const p = packet.person;
      repaint(packet.face, (c, w, h) => {
        c.fillStyle = stage === 0 ? "#c57e45" : "#eeeae0";
        c.fillRect(0, 0, w, h);
        const ink = stage === 0 ? "#30362d" : "#3b403a";
        print(c, CARD_FACES[stage].toUpperCase(), 21, 48, 20, ink, 650);
        c.strokeStyle = stage === 0 ? "#716431" : "#c8c6ba";
        c.lineWidth = 2;
        c.strokeRect(23, 72, 210, 150);
        print(c, p ? fit(c, p.name, 30, 550, 190) : "—", 40, 140, 30, ink, 550);
        if (p?.token != null) print(c, `TOKEN ${p.token}`, 40, 178, 19, stage === 0 ? "#635728" : "#8b8d80");
        if (p) print(c, `waiting ${wait(p.waitedMinutes)}`, 40, 206, 17, p.waitedMinutes >= live.patienceMinutes ? "#b4552a" : "#8b8d80");
        for (let i = 0; i < 4; i++) {
          c.fillStyle = i === stage % 4 ? "#c57e45" : "#aeb2a5";
          c.fillRect(24, 244 + i * 19, 190 - (i % 3) * 24, 6);
        }
        print(c, p?.flagged ? "ALLERGY ON FILE" : "", 24, 330, 15, "#a4542a", 600);
      });
    }

    let cashU = 0.72;
    function nearestPort(x: number, z: number) {
      let best = 0;
      let dist = Infinity;
      for (let i = 0; i < 300; i++) {
        const p = path.getPointAt(i / 300);
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < dist) {
          dist = d;
          best = i / 300;
        }
      }
      return best;
    }
    const adminU = nearestPort(-1.65, -0.7);
    const storeU = nearestPort(1.5, -0.7);
    cashU = nearestPort(0.93, 2.65);

    /* --------------------------------------------------------- what is live */

    /** Everyone in the building, in the order they meet the counters. */
    function everyone(): { person: FlowPerson; step: number }[] {
      const out: { person: FlowPerson; step: number }[] = [];
      COUNTERS.forEach((c, step) => {
        for (const person of stationData(c.id).people) out.push({ person, step });
      });
      return out;
    }

    function syncLabels() {
      for (const s of stations) {
        const d = stationData(s.id);
        const meta = s.label.querySelector<HTMLElement>(".label-meta")!;
        meta.textContent = shut(d) ?? (d.count === 0 ? "Clear" : `${d.count} waiting · ${wait(d.longestWait)}`);
        s.label.classList.toggle("late", !shut(d) && late(d));
        s.label.classList.toggle("empty", !!shut(d));
        const closed = shut(d);
        repaint(s.plaque, (c, w, h) => {
          c.fillStyle = closed ? "#1b1b1d" : "#151a20";
          c.fillRect(0, 0, w, h);
          print(c, String(s.index + 1).padStart(2, "0"), 24, 76, 42, closed ? "#5d5f63" : "#ff7a1a", 550);
          print(c, s.name.toUpperCase(), 111, 62, 32, closed ? "#8c8f93" : "#d7d9d7", 550);
          print(
            c,
            closed
              ? closed.toLowerCase()
              : d.count === 0
                ? "clear"
                : `${d.count} waiting · ${wait(d.longestWait)}`,
            111,
            96,
            21,
            !closed && late(d) ? "#e58a5a" : "#8f979b",
          );
        });
      }
      const inBuilding = live.stations
        .filter((s) => s.id !== "desk")
        .reduce((n, s) => n + s.count, 0);
      $("status-text").textContent = inBuilding === 0 ? "Nobody in the building" : "In the building";
      $("status-count").textContent = inBuilding === 0 ? "" : String(inBuilding);
      $("status").classList.toggle("quiet", inBuilding === 0);
      $("clinic-name").textContent = live.clinicName;
      const worst = [...live.stations].sort((a, b) => (b.longestWait ?? -1) - (a.longestWait ?? -1))[0];
      const worstName = COUNTERS.find((c) => c.id === worst?.id)?.name ?? "";
      $("heading-index").textContent =
        worst && worst.longestWait != null && worst.longestWait > 0
          ? `LONGEST WAIT: ${worstName.toUpperCase()} · ${wait(worst.longestWait)}`
          : `${live.seenToday} SEEN TODAY`;
      if (live.following) {
        $("journey-title").textContent = `${live.following.name}${live.following.token != null ? ` · token ${live.following.token}` : ""}`;
        $("journey-detail").textContent = `${live.following.what} · ${wait(live.following.inBuildingMinutes)} in the building`;
        $("journey-progress").style.width = `${((live.following.step + 1) / 5) * 100}%`;
      } else {
        $("journey-title").textContent = "Nobody in the building";
        $("journey-detail").textContent = "A patient appears here as soon as the desk registers one.";
        $("journey-progress").style.width = "0%";
      }
    }

    /** Everything painted from clinic data, redrawn when the queues change. */
    function repaintAll() {
      repaint(nameplate, drawNameplate);
      repaint(arrivals, drawArrivals);
      repaint(incomingCard, drawIncoming);
      repaint(reading, drawReading);
      repaint(queue, (c, w, h) => drawQueue(c, w, h, lastDraw));
      repaint(parchaBoard, drawParcha);
      repaint(packetFace, drawPacket);
      repaint(takings, drawTakings);
      repaint(receiptFace, drawReceipt);
      // The cards on the belt carry real people: six at most, the rest implied.
      const riders = everyone();
      packets.forEach((packet, i) => {
        packet.person = riders[i]?.person ?? null;
        packet.stage = -1;
      });
      syncLabels();
    }

    /* ------------------------------------------------------------- assembly */

    function compact(group: THREE.Object3D) {
      for (const child of [...group.children]) if ((child as THREE.Group).isGroup) compact(child);
      const buckets = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
      for (const object of group.children) {
        const child = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material> & { isInstancedMesh?: boolean };
        if (!child.isMesh || child.isInstancedMesh || child.userData.moving || Array.isArray(child.material)) continue;
        const key = child.material.uuid;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(child);
      }
      for (const list of buckets.values()) {
        if (list.length < 2) continue;
        const geos = list.map((m) => {
          m.updateMatrix();
          const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
          return g.applyMatrix4(m.matrix);
        });
        const merged = mergeGeometries(geos, false);
        for (const geo of geos) geo.dispose();
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, list[0].material);
        mesh.castShadow = list.some((x) => x.castShadow);
        mesh.receiveShadow = list.some((x) => x.receiveShadow);
        for (const m of list) group.remove(m);
        group.add(mesh);
      }
    }
    for (const g of [incoming, receipt, coin, readingBoard, handover, cuffArm, ...dials]) g.userData.moving = true;
    compact(machine);
    stations.forEach((s) =>
      s.group.traverse((o) => {
        o.userData.station = s.id;
      }),
    );
    const pickables = stations.map((s) => s.group);

    /* -------------------------------------------------------------- camera */

    let mode: Mode = "assembled";
    let cameraMode: CameraMode = "overview";
    let playing = !reduceMotion;
    let simTime = 0;
    let spread = 0;
    let selected: FlowStationId = "desk";
    let hovered: FlowStationId | null = null;
    let width = frameWidth();
    let height = frameHeight();
    let mobile = width <= 900;
    let lastInteraction = performance.now();
    let dragging = false;
    let wasDragged = false;
    let downX = 0;
    let downY = 0;
    let cameraAnimating = true;
    let flightTime = 0;
    let lastDraw = -1;
    let visible = true;
    let contextLost = false;
    const desiredPosition = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3(0, 1, 0);
    const viewDirection = new THREE.Vector3(10.5, 10.8, 17).normalize();
    let baseDistance = 25;
    let sized = false;

    function layoutCamera() {
      if (!frameWidth() || !frameHeight()) return;
      const first = !sized;
      sized = true;
      width = frameWidth();
      height = frameHeight();
      mobile = width <= 900;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const aspect = width / height;
      const availableWidth = mobile ? 0.91 : Math.min(0.68, aspect > 2 ? 0.66 : 0.7);
      const horizontalFit =
        17.3 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect * availableWidth);
      const verticalFit = 11.5 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.74);
      baseDistance = Math.max(horizontalFit, verticalFit) * (mobile ? 0.97 : 1);
      controls.maxDistance = Math.max(55, baseDistance * 1.6);
      camera.updateProjectionMatrix();
      setCameraGoal();
      cameraAnimating = true;
      if (first) {
        camera.position.copy(desiredPosition);
        controls.target.copy(desiredTarget);
        controls.update();
        cameraAnimating = false;
      }
    }
    function setCameraGoal() {
      const expand = mode === "stations" ? 1.2 : 1;
      if (cameraMode === "station") {
        const s = stations.find((x) => x.id === selected)!;
        desiredTarget.copy(s.group.position).add(new THREE.Vector3(0, 1.25, 0));
        desiredPosition.copy(desiredTarget).addScaledVector(viewDirection, mobile ? 9 : 12);
      } else {
        desiredTarget.set(0, 1, 0);
        const distance = baseDistance * expand;
        if (cameraMode === "side") desiredPosition.set(13, 5, 20).normalize().multiplyScalar(distance).add(desiredTarget);
        else if (cameraMode === "top") desiredPosition.set(0.01, distance, 0.8).add(desiredTarget);
        else desiredPosition.copy(viewDirection).multiplyScalar(distance).add(desiredTarget);
      }
    }
    function syncButtons() {
      root
        .querySelectorAll<HTMLElement>("[data-mode]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
      root
        .querySelectorAll<HTMLElement>("[data-camera]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.camera === cameraMode)));
      $("journey").classList.toggle("visible", mode === "order");
    }
    function setMode(name: string) {
      if (!["assembled", "cutaway", "stations", "order"].includes(name)) return;
      mode = name as Mode;
      lastInteraction = performance.now();
      if (mode === "order") {
        simTime = 0;
        journeyPhase = 0;
        lastDraw = -1;
        playing = true;
        syncPlayback();
        cameraMode = "overview";
      } else if (cameraMode === "station") cameraMode = "overview";
      setCameraGoal();
      cameraAnimating = true;
      syncButtons();
    }
    function focusStation(id: FlowStationId) {
      if (!stations.some((s) => s.id === id)) return;
      selected = id;
      if (mode === "order") mode = "assembled";
      cameraMode = "station";
      lastInteraction = performance.now();
      setCameraGoal();
      cameraAnimating = true;
      syncButtons();
    }
    function setCamera(name: string) {
      if (!["overview", "side", "top", "station", "flight"].includes(name)) return;
      cameraMode = name as CameraMode;
      if (mode === "order") mode = "assembled";
      lastInteraction = performance.now();
      flightTime = 0;
      setCameraGoal();
      cameraAnimating = true;
      syncButtons();
    }
    function syncPlayback() {
      const b = $("play");
      b.setAttribute("aria-label", playing ? "Stop the movement" : "Start the movement");
      b.setAttribute("aria-pressed", String(!playing));
      b.innerHTML = playing
        ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="2.5" height="10" rx=".5"/><rect x="7.5" y="1" width="2.5" height="10" rx=".5"/></svg>'
        : '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1l8 5-8 5z"/></svg>';
    }
    root
      .querySelectorAll<HTMLElement>("[data-mode]")
      .forEach((b) => listen(b, "click", () => setMode(b.dataset.mode ?? "")));
    root
      .querySelectorAll<HTMLElement>("[data-camera]")
      .forEach((b) => listen(b, "click", () => setCamera(b.dataset.camera ?? "")));
    listen($("play"), "click", () => {
      playing = !playing;
      syncPlayback();
    });
    syncPlayback();
    layoutCamera();
    camera.position.copy(desiredPosition);
    controls.target.copy(desiredTarget);
    controls.update();
    cameraAnimating = false;
    listen(window, "resize", layoutCamera);
    const resizeObserver = new ResizeObserver(() => layoutCamera());
    resizeObserver.observe(root);
    cleanups.push(() => resizeObserver.disconnect());
    controls.addEventListener("start", () => {
      dragging = true;
      cameraAnimating = false;
      lastInteraction = performance.now();
    });
    controls.addEventListener("end", () => {
      dragging = false;
      lastInteraction = performance.now();
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const tooltip = $("tooltip");
    const localX = (e: PointerEvent) => e.clientX - root.getBoundingClientRect().left;
    const localY = (e: PointerEvent) => e.clientY - root.getBoundingClientRect().top;
    function hitStation(x: number, y: number) {
      pointer.set((x / width) * 2 - 1, (-y / height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, true);
      return hits.length ? stations.find((s) => s.id === hits[0].object.userData.station) : null;
    }
    listen(renderer.domElement, "pointermove", (e: PointerEvent) => {
      lastInteraction = performance.now();
      if (Math.hypot(localX(e) - downX, localY(e) - downY) > 5) wasDragged = true;
      if (dragging) return;
      const s = hitStation(localX(e), localY(e));
      hovered = s ? s.id : null;
      renderer.domElement.style.cursor = s ? "pointer" : "grab";
      tooltip.classList.toggle("visible", !!s);
      if (s) {
        const d = stationData(s.id);
        tooltip.querySelector("strong")!.innerHTML = `<span>${String(s.index + 1).padStart(2, "0")}</span>${s.name}`;
        tooltip.querySelector("p")!.textContent = !d.present
          ? `This clinic has no ${s.name.toLowerCase()} counter. Nobody waits here.`
          : !d.staffed
            ? `Nobody is on this counter.${d.count ? ` ${d.count} waiting ${s.waitingFor}.` : ""}`
            : d.count === 0
              ? `Nobody is waiting ${s.waitingFor}.`
              : `${d.count} waiting ${s.waitingFor}. The longest has been ${wait(d.longestWait)}: ${d.people[0]?.name ?? ""}.`;
        tooltip.style.left = `${Math.min(width - 255, Math.max(10, localX(e) + 16))}px`;
        tooltip.style.top = `${Math.max(10, Math.min(height - 95, localY(e) - 65))}px`;
      }
    });
    listen(renderer.domElement, "pointerleave", () => {
      hovered = null;
      tooltip.classList.remove("visible");
    });
    listen(renderer.domElement, "pointerdown", (e: PointerEvent) => {
      downX = localX(e);
      downY = localY(e);
      wasDragged = false;
      tooltip.classList.remove("visible");
    });
    listen(renderer.domElement, "pointerup", (e: PointerEvent) => {
      if (wasDragged) return;
      const s = hitStation(localX(e), localY(e));
      if (!s) return;
      focusStation(s.id);
      options.onStation?.(s.id);
    });
    listen(document, "visibilitychange", () => {
      visible = !document.hidden;
      lastFrame = performance.now();
    });
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting && !document.hidden;
        lastFrame = performance.now();
      },
      { threshold: 0.01 },
    );
    observer.observe(renderer.domElement);
    cleanups.push(() => observer.disconnect());
    listen(renderer.domElement, "webglcontextlost", (e: Event) => {
      e.preventDefault();
      contextLost = true;
      showError("The 3D drawing stopped. It comes back on its own; everything else on this page keeps working.");
    });
    listen(renderer.domElement, "webglcontextrestored", () => {
      contextLost = false;
      $("error").style.display = "none";
      lastFrame = performance.now();
    });

    /* --------------------------------------------------------------- frames */

    const anchor = new THREE.Vector3();
    const scratch = new THREE.Vector3();
    const CALM_COLOUR = new THREE.Color(0xff7a1a);
    /** How far along the walk each counter stands, for the one-patient card. */
    const JOURNEY_PHASE = [0.04, 0.2, 0.45, 0.7, 0.95];
    /** Where that card has got to, eased towards the patient's real counter. */
    let journeyPhase = 0;
    const LATE_COLOUR = new THREE.Color(0xff3b18);
    let lastFrame = performance.now();
    let frameCount = 0;
    let measureTime = 0;
    let pixelRatio = renderer.getPixelRatio();
    let rafId = 0;

    function animate(now: number) {
      rafId = requestAnimationFrame(animate);
      const dt = Math.max(0, Math.min((now - lastFrame) / 1000, 0.045));
      lastFrame = now;
      if (!visible || contextLost) return;
      if (playing) {
        simTime += dt;
        flightTime += dt;
      }
      const t = simTime;
      const beat = (t / 4) % 1;
      const tact = (t * TAU) / 4;
      const smooth = 1 - Math.exp(-dt * 5);
      spread = THREE.MathUtils.lerp(spread, mode === "stations" ? 1 : 0, smooth);
      cutPlane.constant = THREE.MathUtils.lerp(cutPlane.constant, mode === "cutaway" ? 0.99 : 10, smooth);

      stations.forEach((s, i) => {
        const d = stationData(s.id);
        s.group.position.copy(s.base);
        s.group.position.x *= 1 + spread * 0.29;
        s.group.position.z *= 1 + spread * 0.37;
        s.group.position.y += spread * (i % 2 ? 0.32 : 0.55);
        // A busy counter stands a little taller than a clear one, so the shape
        // of the day reads before any of the writing does.
        const load = Math.min(1, d.count / 6);
        s.group.position.y += load * 0.22;
        const pulse = Math.pow(Math.max(0, Math.sin(tact - i * 0.9)), 7);
        const lit = hovered === s.id || (cameraMode === "station" && selected === s.id);
        const closed = shut(d);
        s.glowMat.emissiveIntensity = THREE.MathUtils.lerp(
          s.glowMat.emissiveIntensity,
          closed ? 0.04 : lit ? 3.5 : 0.35 + load * 1.6 + pulse * 0.65,
          smooth,
        );
        // Red under a counter somebody has waited at too long.
        s.glowMat.emissive.lerp(late(d) && !closed ? LATE_COLOUR : CALM_COLOUR, smooth);
      });
      belt.scale.set(1 + spread * 0.12, 1, 1 + spread * 0.15);
      pipes.scale.set(1 + spread * 0.25, 1, 1 + spread * 0.3);
      gears.forEach(({ g, vertical }, i) => {
        if (vertical) g.rotation.z = t * (i % 2 ? -1 : 1) * 1.1;
        else g.rotation.y = t * (i % 2 ? -1 : 1) * 1.1;
      });
      dials.forEach((r, i) => (r.rotation.z = -t * (i ? 0.65 : 0.85)));
      cuffArm.position.x = Math.sin(tact) * 0.42;
      cuffArm.position.y = 1.91 + Math.sin(tact * 2) * 0.055;
      readingBoard.position.y = beat * 0.25;
      handover.position.y = Math.sin(tact) * 0.04;
      const orderPhase = (t / 24) % 1;
      const cashBeat = mode === "order" ? THREE.MathUtils.clamp((orderPhase - 0.88) / 0.12, 0, 1) : beat;
      receipt.visible = coin.visible = mode !== "order" || orderPhase > 0.88;
      receipt.scale.y = 0.2 + Math.min(1, cashBeat * 1.5) * 0.8;
      coin.position.set(1.04, 2.7 - Math.min(1, cashBeat * 1.7) ** 2 * 2.17, 0.55);
      coin.rotation.y = t * 3.5;
      coin.scale.setScalar(cashBeat > 0.9 ? 1 - (cashBeat - 0.9) * 8 : 1);
      const incomingBeat = mode === "order" ? Math.min(1, orderPhase / 0.15) : beat;
      incoming.visible = mode !== "order" || orderPhase < 0.15;
      incoming.position.set(
        Math.sin(incomingBeat * Math.PI) * 0.24,
        2.9 - incomingBeat * 1.9,
        1.1 - incomingBeat * 0.55,
      );
      incoming.rotation.z = Math.sin(incomingBeat * Math.PI) * -0.14;
      incoming.scale.setScalar(Math.min(1, incomingBeat * 8 + 0.15, (1 - incomingBeat) * 7 + 0.1));
      toggles.forEach((o, i) => (o.rotation.x = Math.sin(tact + i) > 0 ? -0.4 : 0.4));
      if (t - lastDraw > 1 / 6 || lastDraw < 0) {
        repaint(queue, (c, w, h) => drawQueue(c, w, h, t));
        updateBelt(t);
        lastDraw = t;
      }

      const riders = everyone();
      packets.forEach((packet, i) => {
        const rider = riders[i] ?? null;
        if (rider && packet.person !== rider.person) {
          packet.person = rider.person;
          packet.stage = -1;
        }
        packet.group.visible = !!rider && (mode !== "order" || i === 0);
        if (!rider) return;
        // A card sits at its own counter and drifts a little; in "One patient"
        // mode the first one walks the whole path instead.
        if (mode === "order" && i === 0 && live.following) {
          // The card walks from the door to the counter this patient is
          // actually at, and stops there. It must never carry them through a
          // counter they have not reached: the picture is the day as it is.
          const reached = Math.min(4, Math.max(0, live.following.step));
          journeyPhase = THREE.MathUtils.lerp(journeyPhase, JOURNEY_PHASE[reached], 1 - Math.exp(-dt * 0.8));
          const phase = journeyPhase;
          packet.phase = phase;
          if (phase < 0.15) {
            const f = phase / 0.15;
            packet.group.position.copy(stations[0].group.position).add(new THREE.Vector3(0, 1.6, 0.6));
            scratch.copy(stations[1].group.position).add(new THREE.Vector3(0, 1.3, 0.65));
            packet.group.position.lerp(scratch, f);
            packet.group.position.y += Math.sin(f * Math.PI) * 2;
          } else {
            path.getPointAt(Math.max(0, ((phase - 0.15) / 0.85) * cashU), packet.group.position);
            packet.group.position.y += 0.43 + Math.sin(tact) * 0.04;
          }
          packet.group.rotation.set(0, 0.18, 0);
          packet.group.scale.setScalar(1.35);
          packet.halo.visible = true;
          if (packet.stage !== reached) {
            drawCard(packet, reached);
            packet.stage = reached;
          }
          $("journey-title").textContent = `${live.following.name}${live.following.token != null ? ` · token ${live.following.token}` : ""}`;
          $("journey-detail").textContent = `${COUNTERS[reached].name} · ${live.following.what} · ${wait(live.following.inBuildingMinutes)} in the building`;
          $("journey-progress").style.width = `${((reached + 1) / 5) * 100}%`;
          if (!dragging && playing) {
            desiredTarget.copy(packet.group.position);
            desiredPosition.copy(desiredTarget).addScaledVector(viewDirection, mobile ? 10 : 15);
            cameraAnimating = true;
          }
          return;
        }
        packet.halo.visible = false;
        packet.group.scale.setScalar(1);
        const s = stations[rider.step];
        const lane = i % 3;
        packet.group.position
          .copy(s.group.position)
          .add(new THREE.Vector3(0.95 + lane * 0.1, 1.15 + Math.sin(tact + i) * 0.05, 0.75 - lane * 0.38));
        packet.group.rotation.set(0, 0.38 + Math.sin(tact * 0.5 + i) * 0.06, 0);
        if (packet.stage !== rider.step) {
          drawCard(packet, rider.step);
          packet.stage = rider.step;
        }
      });

      if (cameraMode === "flight" && playing && !dragging) {
        const a = flightTime * 0.12;
        const d = baseDistance * (mode === "stations" ? 1.2 : 1);
        desiredTarget.set(0, 1, 0);
        desiredPosition
          .set(Math.sin(a + 0.55) * d * 0.83, d * (0.5 + Math.sin(a * 0.7) * 0.09), Math.cos(a + 0.55) * d * 0.83)
          .add(desiredTarget);
        cameraAnimating = true;
      } else if (cameraMode === "station" && cameraAnimating) setCameraGoal();
      if (cameraAnimating && !dragging) {
        const speed = 1 - Math.exp(-dt * (mode === "order" ? 2.2 : 3));
        camera.position.lerp(desiredPosition, speed);
        controls.target.lerp(desiredTarget, speed);
        if (
          cameraMode !== "flight" &&
          mode !== "order" &&
          camera.position.distanceTo(desiredPosition) < 0.015 &&
          controls.target.distanceTo(desiredTarget) < 0.015
        )
          cameraAnimating = false;
      }
      controls.autoRotate =
        playing &&
        !reduceMotion &&
        !dragging &&
        !cameraAnimating &&
        mode !== "order" &&
        cameraMode === "overview" &&
        now - lastInteraction > 6500;
      controls.autoRotateSpeed = 0.24;
      controls.update(dt);

      stations.forEach((s, i) => {
        const show = mode === "stations";
        s.label.classList.toggle("visible", show);
        if (!show) return;
        anchor.copy(s.group.position).add(new THREE.Vector3(0, 2.5, 0)).project(camera);
        const offsets = mobile
          ? [
              [16, -1],
              [-30, 25],
              [-27, -50],
              [15, -65],
              [-5, 52],
            ]
          : [
              [30, 20],
              [-48, -14],
              [-8, -64],
              [30, -12],
              [-12, 40],
            ];
        const x = THREE.MathUtils.clamp(
          (anchor.x * 0.5 + 0.5) * width - 40 + offsets[i][0],
          8,
          Math.max(8, width - (s.label.offsetWidth || 150) - 8),
        );
        const y = THREE.MathUtils.clamp((-anchor.y * 0.5 + 0.5) * height - 52 + offsets[i][1], 80, height - 150);
        s.label.style.transform = `translate(${x}px,${y}px)`;
      });

      renderer.render(scene, camera);
      if (playing) {
        frameCount++;
        measureTime += dt;
        if (measureTime > 4) {
          if (frameCount / measureTime < 43 && pixelRatio > 1) {
            pixelRatio = Math.max(1, pixelRatio - 0.25);
            renderer.setPixelRatio(pixelRatio);
          }
          frameCount = 0;
          measureTime = 0;
        }
      }
    }

    repaintAll();
    rafId = requestAnimationFrame(animate);
    cleanups.push(() => {
      cancelAnimationFrame(rafId);
      controls.dispose();
      const textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const list = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        for (const material of list) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
          material.dispose();
        }
      });
      geometries.forEach((g) => g.dispose());
      textures.forEach((x) => x.dispose());
      env.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    });
    renderer.compile(scene, camera);
    $("loading").classList.add("done");
    $("error").style.display = "none";

    return {
      dispose,
      update(next: FlowData) {
        live = next;
        repaintAll();
      },
      focus(id: FlowStationId) {
        if (id !== selected || cameraMode !== "station") focusStation(id);
      },
    };
  } catch (error) {
    console.error("The clinic view could not start", error);
    showError();
    return { dispose, update: () => undefined, focus: () => undefined };
  }
}

/* ========================================================================= *
 * Styles, scoped to this view.
 * ========================================================================= */

const STYLES = String.raw`
/**
 * The Parcha look, not a dark console: paper card, charcoal ink, coral accent,
 * a 3px outline and the same hard shadow every other card on the page carries.
 * The machine itself is drawn on a transparent canvas, so what is behind it is
 * this card's own paper.
 */
.hospital-flow-3d {
  position: relative;
  width: 100%;
  overflow: hidden;
  contain: layout;
  border-radius: 1rem;
  border: 3px solid #232326;
  box-shadow: 3px 3px 0 #232326;
  background: var(--color-card, oklch(0.995 0.005 85));
  color: var(--color-foreground, #232326);
  font-size: 13px;
  font-weight: 700;
  -webkit-font-smoothing: antialiased;
  --ink: #232326;
  --paper: var(--color-card, oklch(0.995 0.005 85));
  --accent: var(--brand, oklch(0.72 0.17 40));
  --quiet: var(--color-muted-foreground, oklch(0.36 0.015 285));
  --late: oklch(0.52 0.19 28);
}
.hospital-flow-3d, .hospital-flow-3d * { box-sizing: border-box; }
.hospital-flow-3d button { font: inherit; font-weight: 700; color: inherit; cursor: pointer; }
.hospital-flow-3d button:focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
/* pan-y, not none: a finger scrolls the page past the machine. */
.hospital-flow-3d #scene { position: absolute; inset: 0; touch-action: pan-y; }
.hospital-flow-3d #scene canvas { display: block; width: 100%; height: 100%; }
/* Just enough shading at the edges to seat the machine on the page. */
.hospital-flow-3d .vignette {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at 50% 46%, transparent 58%, rgba(35, 35, 38, 0.07) 100%);
}
.hospital-flow-3d .topbar {
  position: absolute; inset: 16px 18px auto; display: flex;
  justify-content: space-between; align-items: center; pointer-events: none; gap: 12px;
}
.hospital-flow-3d .identity { display: flex; gap: 10px; align-items: center; min-width: 0; }
.hospital-flow-3d .mark {
  width: 30px; height: 30px; border: 3px solid var(--ink); border-radius: 10px;
  display: grid; place-items: center; color: var(--ink); background: var(--accent); flex: none;
}
.hospital-flow-3d .identity strong {
  display: block; font-size: 15px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 42vw;
}
.hospital-flow-3d .identity small {
  display: block; margin-top: 2px; font-size: 10px; letter-spacing: 1.2px;
  color: var(--quiet); text-transform: uppercase;
}
.hospital-flow-3d .status {
  display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--quiet);
  background: var(--paper); border: 2px solid var(--ink); border-radius: 999px; padding: 4px 12px;
}
.hospital-flow-3d .status i {
  width: 8px; height: 8px; border-radius: 50%; background: var(--accent); border: 1px solid var(--ink);
}
.hospital-flow-3d .status.quiet i { background: var(--paper); }
.hospital-flow-3d .status span:last-child {
  font-variant-numeric: tabular-nums; color: var(--ink); font-size: 16px;
}
.hospital-flow-3d .scene-heading {
  position: absolute; top: 62px; left: 18px; right: 18px; pointer-events: none;
  display: flex; align-items: center; gap: 10px; font-size: 10px; letter-spacing: 1.2px;
  color: var(--quiet); text-transform: uppercase;
}
.hospital-flow-3d .scene-heading .index { margin-left: auto; color: var(--ink); letter-spacing: 0.8px; }
.hospital-flow-3d .controls {
  position: absolute; bottom: 42px; left: 14px; right: 14px; display: flex;
  align-items: center; flex-direction: column; gap: 10px; z-index: 5;
}
.hospital-flow-3d .mode-bar {
  display: flex; gap: 4px; align-items: center; padding: 5px;
  border: 3px solid var(--ink); border-radius: 14px; background: var(--paper);
  box-shadow: 3px 3px 0 var(--ink); max-width: 100%; overflow-x: auto;
}
.hospital-flow-3d .mode-bar button {
  border: 0; background: none; color: var(--ink); white-space: nowrap; padding: 9px 14px;
  font-size: 13px; border-radius: 9px;
}
.hospital-flow-3d .mode-bar button:hover { background: var(--color-accent, oklch(0.78 0.14 40)); }
.hospital-flow-3d .mode-bar button[aria-pressed='true'] { background: var(--accent); }
.hospital-flow-3d .camera-row {
  display: flex; align-items: center; justify-content: center; gap: 2px; flex-wrap: wrap;
  background: var(--paper); border: 2px solid var(--ink); border-radius: 999px; padding: 3px 10px;
}
.hospital-flow-3d .camera-row .caption { font-size: 10px; letter-spacing: 1.2px; color: var(--quiet); margin-right: 6px; }
.hospital-flow-3d .camera-row button {
  border: 0; background: transparent; color: var(--quiet); padding: 4px 8px; font-size: 12px; border-radius: 7px;
}
.hospital-flow-3d .camera-row button:hover { color: var(--ink); }
.hospital-flow-3d .camera-row button[aria-pressed='true'] { color: var(--ink); background: var(--accent); }
.hospital-flow-3d .camera-row .divider { width: 2px; height: 14px; background: var(--ink); margin: 0 7px; opacity: .25; }
.hospital-flow-3d .camera-row #play { padding: 4px; width: 26px; height: 26px; display: grid; place-items: center; }
.hospital-flow-3d .footer {
  position: absolute; bottom: 12px; left: 18px; right: 18px; display: flex;
  align-items: center; justify-content: flex-end; pointer-events: none;
}
.hospital-flow-3d .hint { display: flex; align-items: center; gap: 6px; color: var(--quiet); font-size: 11px; }
.hospital-flow-3d #labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.hospital-flow-3d .station-label {
  position: absolute; left: 0; top: 0; opacity: 0; transition: opacity .3s;
  will-change: transform; pointer-events: none; min-width: 138px;
}
.hospital-flow-3d .station-label.visible { opacity: 1; }
.hospital-flow-3d .station-label .stem {
  height: 22px; width: 2px; background: var(--ink); opacity: .45; margin-left: 11px;
}
.hospital-flow-3d .station-label .label-card {
  background: var(--paper); border: 3px solid var(--ink); border-radius: 10px;
  padding: 8px 11px; box-shadow: 2px 2px 0 var(--ink);
}
.hospital-flow-3d .station-label.late .label-card { background: oklch(0.94 0.05 25); }
.hospital-flow-3d .station-label.empty .label-card { background: var(--color-muted, oklch(0.94 0.016 85)); opacity: .9; }
.hospital-flow-3d .station-label .label-title {
  font-size: 13px; display: flex; gap: 8px; align-items: center; white-space: nowrap; color: var(--ink);
}
.hospital-flow-3d .station-label .label-title span { color: var(--ink); opacity: .55; font: 700 10px ui-monospace, Menlo, monospace; }
.hospital-flow-3d .station-label .label-meta { font-size: 11px; color: var(--quiet); margin: 3px 0 0 21px; white-space: nowrap; }
.hospital-flow-3d .station-label.late .label-meta { color: var(--late); }
.hospital-flow-3d #tooltip {
  position: absolute; pointer-events: none; z-index: 10; opacity: 0; transition: opacity .15s;
  padding: 10px 12px; border: 3px solid var(--ink); background: var(--paper);
  box-shadow: 3px 3px 0 var(--ink); border-radius: 10px; max-width: 255px;
}
.hospital-flow-3d #tooltip.visible { opacity: 1; }
.hospital-flow-3d #tooltip strong { font-size: 13px; color: var(--ink); }
.hospital-flow-3d #tooltip strong span { font-size: 11px; color: var(--ink); opacity: .55; margin-right: 7px; }
.hospital-flow-3d #tooltip p { font-size: 12px; color: var(--quiet); margin: 5px 0 0; line-height: 1.45; }
.hospital-flow-3d #journey {
  position: absolute; left: 18px; right: 18px; top: 88px; opacity: 0; transform: translateY(-5px);
  transition: .4s; pointer-events: none; display: flex; align-items: center; gap: 11px;
  background: var(--paper); border: 3px solid var(--ink); border-radius: 12px;
  box-shadow: 3px 3px 0 var(--ink); padding: 8px 12px;
}
.hospital-flow-3d #journey.visible { opacity: 1; transform: none; }
.hospital-flow-3d .journey-icon {
  width: 28px; height: 28px; border: 2px solid var(--ink); border-radius: 50%;
  display: grid; place-items: center; color: var(--ink); background: var(--accent); flex: none;
}
.hospital-flow-3d #journey strong { font-size: 13px; color: var(--ink); }
.hospital-flow-3d #journey small { display: block; font-size: 11px; margin-top: 2px; color: var(--quiet); }
.hospital-flow-3d #journey .track {
  height: 6px; background: var(--color-muted, oklch(0.94 0.016 85)); flex: 1; margin-left: 8px;
  border: 2px solid var(--ink); border-radius: 999px; overflow: hidden;
}
.hospital-flow-3d #journey .track i { display: block; height: 100%; background: var(--accent); width: 0; transition: width .5s; }
.hospital-flow-3d #loading {
  position: absolute; left: 50%; top: 48%; transform: translate(-50%,-50%); display: flex;
  align-items: center; gap: 10px; color: var(--quiet); font-size: 13px; transition: opacity .4s; z-index: 20;
}
.hospital-flow-3d #loading i {
  height: 18px; width: 18px; border-radius: 50%; border: 3px solid var(--color-muted, oklch(0.94 0.016 85));
  border-top-color: var(--accent); animation: hospital-flow-3d-spin 1s linear infinite;
}
@keyframes hospital-flow-3d-spin { to { transform: rotate(360deg); } }
.hospital-flow-3d #loading.done { opacity: 0; pointer-events: none; }
.hospital-flow-3d #error {
  position: absolute; left: 8%; right: 8%; top: 34%; border: 3px solid var(--ink);
  background: var(--paper); box-shadow: 3px 3px 0 var(--ink); padding: 18px; border-radius: 14px;
  display: none; font-size: 14px; line-height: 1.6; color: var(--ink);
}
.hospital-flow-3d #error strong { font-size: 16px; }
.hospital-flow-3d #error p { color: var(--quiet); margin: 6px 0 0; }
@media (max-width: 900px) {
  .hospital-flow-3d .scene-heading { font-size: 9px; letter-spacing: .9px; top: 58px; }
  .hospital-flow-3d .mode-bar button { padding: 9px 10px; font-size: 12px; }
  .hospital-flow-3d .hint { display: none; }
  .hospital-flow-3d .station-label { min-width: 122px; }
  .hospital-flow-3d .identity small { display: none; }
  .hospital-flow-3d #journey { top: 80px; }
}
/* On a phone the two heading lines cannot share a row, and the name has to
   give way to the count that matters. */
@media (max-width: 620px) {
  .hospital-flow-3d .topbar { inset: 12px 12px auto; gap: 8px; }
  .hospital-flow-3d .identity strong { font-size: 13px; max-width: 48vw; }
  .hospital-flow-3d .mark { width: 24px; height: 24px; border-width: 2px; border-radius: 8px; }
  .hospital-flow-3d .status { padding: 3px 9px; gap: 6px; font-size: 11px; }
  .hospital-flow-3d .status span:last-child { font-size: 14px; }
  .hospital-flow-3d .scene-heading { top: 52px; left: 12px; right: 12px; }
  .hospital-flow-3d .scene-heading .chain { display: none; }
  .hospital-flow-3d .scene-heading .index { margin-left: 0; }
  .hospital-flow-3d .station-label { min-width: 0; }
  .hospital-flow-3d .station-label .label-card { padding: 6px 9px; border-width: 2px; }
  .hospital-flow-3d .station-label .label-title { font-size: 11px; gap: 6px; }
  .hospital-flow-3d .station-label .label-meta { font-size: 10px; margin-left: 0; white-space: normal; }
  .hospital-flow-3d .controls { left: 8px; right: 8px; bottom: 34px; }
  .hospital-flow-3d #journey { left: 12px; right: 12px; top: 72px; padding: 6px 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .hospital-flow-3d, .hospital-flow-3d * { transition: none !important; }
  .hospital-flow-3d #loading i { animation: none; }
}
`;
