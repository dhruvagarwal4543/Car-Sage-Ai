import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Car } from "../types";
import { heroScroll } from "../heroScroll";
import { CarImage } from "./CarImage";
import { Icon } from "./Icon";

const VOID = 0x04060c;

type Actions = ((action: string) => void) & { measure?: (model: THREE.Object3D) => void };

function dispose(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
  });
  textures.forEach((texture) => { if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close(); texture.dispose(); });
}

const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// The drive-in. f runs along the car's nose, r across it, v up it — f and r in body lengths,
// v in body heights — so the same path frames any model that loads. The journey ends inside the
// cabin rather than leaving it: the last third of the page is read from the driver's seat.
const JOURNEY = [
  { p: 0.00, f: 1.34, r: 0.78, v: 0.92, tf: 0.00, tr: 0.00, tv: 0.44 },
  { p: 0.22, f: 1.00, r: 0.36, v: 0.40, tf: 0.08, tr: 0.00, tv: 0.36 },
  { p: 0.44, f: 0.66, r: 0.08, v: 0.30, tf: 0.30, tr: 0.00, tv: 0.30 },
  { p: 0.64, f: 0.28, r: -0.04, v: 0.56, tf: -0.20, tr: 0.00, tv: 0.54 },
  { p: 0.80, f: -0.02, r: -0.16, v: 0.70, tf: 1.30, tr: -0.06, tv: 0.54 },
  { p: 1.00, f: -0.22, r: -0.16, v: 0.72, tf: 1.65, tr: -0.03, tv: 0.50 },
];

// A soft round falloff: the pool of light on the floor, and the fade of the floor into the dark.
function falloff(stops: [number, string][], size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([offset, colour]) => gradient.addColorStop(offset, colour));
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Which end is the nose: the half of the body carrying the cabin sits higher, so the camera
// approaches from the other one.
function noseSign(model: THREE.Object3D, axis: "x" | "z", centre: number) {
  const halves = [{ sum: 0, count: 0 }, { sum: 0, count: 0 }];
  const vertex = new THREE.Vector3();
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute("position");
    if (!position) return;
    for (let index = 0; index < position.count; index += 11) {
      vertex.fromBufferAttribute(position as THREE.BufferAttribute, index).applyMatrix4(node.matrixWorld);
      const half = halves[vertex[axis] > centre ? 0 : 1];
      half.sum += vertex.y; half.count += 1;
    }
  });
  const [ahead, behind] = halves.map((half) => (half.count ? half.sum / half.count : 0));
  return ahead < behind ? 1 : -1;
}

export default function VehicleScene({ url, car, stage = false, onError }: { url: string; car: Car; stage?: boolean; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<Actions>(() => {});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    // No post-processing. One pass straight into a multisampled framebuffer is the cheapest route
    // to a clean frame, and the polished floor and rim lights carry the look without bloom.
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
    catch { onError("3D is unavailable on this device."); return; }
    let disposed = false, frame = 0, animation = 0;
    const abort = new AbortController();
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const disposables: { dispose: () => void }[] = [];

    let ratio = Math.min(window.devicePixelRatio, mobile ? 1.1 : 1.25);
    renderer.setPixelRatio(ratio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;      // nothing moves but the camera, so it is drawn once
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${car.make} ${car.model} interactive 3D model. Drag to rotate; arrow keys rotate;${stage ? "" : " plus and minus zoom;"} zero resets.`);
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(VOID);
    scene.fog = new THREE.Fog(VOID, 14, 62);
    const camera = new THREE.PerspectiveCamera(stage ? 36 : 34, 1, stage ? 0.04 : 0.1, 180);
    const home = new THREE.Vector3(4.4, 1.85, 5.4);
    camera.position.copy(home);

    // ——— Studio: a neutral key, a cool fill, and two tinted rims that draw the body line. ———
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.38;
    dispose(room); pmrem.dispose();

    const fill = new THREE.HemisphereLight(0x93aecb, VOID, 0.55);
    scene.add(fill);
    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(4.2, 7.4, 5.2);
    key.castShadow = true;
    key.shadow.mapSize.setScalar(mobile ? 512 : 1024);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    const rimCool = new THREE.DirectionalLight(0x8ecbff, 2.5);
    rimCool.position.set(-6.5, 2.4, -5.2);
    const rimWarm = new THREE.DirectionalLight(0xb09cff, 1.7);
    rimWarm.position.set(6.8, 1.7, -4.6);
    scene.add(rimCool, rimWarm);
    const kicker = new THREE.PointLight(0x8ecbff, 6, 9, 2.1);
    kicker.position.set(-2.4, 0.22, -2.2);
    scene.add(kicker);

    // ——— Floor: polished dark glass, lit by the environment map rather than a mirror pass. ———
    const glassGeometry = new THREE.PlaneGeometry(80, 80);
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x090c14, roughness: 0.14, metalness: 1 });
    const glass = new THREE.Mesh(glassGeometry, glassMaterial);
    glass.rotation.x = -Math.PI / 2; glass.receiveShadow = true;
    scene.add(glass);
    disposables.push(glassGeometry, glassMaterial);

    const fadeTexture = falloff([[0, "rgba(4,6,12,0)"], [0.4, "rgba(4,6,12,0.5)"], [1, "rgba(4,6,12,1)"]]);
    const fadeMaterial = new THREE.MeshBasicMaterial({ map: fadeTexture, transparent: true, depthWrite: false, fog: false });
    const fadeGeometry = new THREE.PlaneGeometry(80, 80);
    const fade = new THREE.Mesh(fadeGeometry, fadeMaterial);
    fade.rotation.x = -Math.PI / 2; fade.position.y = 0.004; fade.renderOrder = 1;
    scene.add(fade);
    disposables.push(fadeTexture, fadeMaterial, fadeGeometry);

    const poolTexture = falloff([[0, "rgba(160,200,245,0.26)"], [0.45, "rgba(120,150,200,0.06)"], [1, "rgba(0,0,0,0)"]]);
    const poolMaterial = new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, depthWrite: false, fog: false });
    const poolGeometry = new THREE.PlaneGeometry(15, 15);
    const pool = new THREE.Mesh(poolGeometry, poolMaterial);
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.007; pool.renderOrder = 2;
    scene.add(pool);
    disposables.push(poolTexture, poolMaterial, poolGeometry);

    let viewWidth = 1, viewHeight = 1;

    // Adaptive quality: a stage that cannot hold a smooth frame gives up resolution once, and
    // never climbs back, so it cannot oscillate.
    let slow = 0, dropped = false, previous = 0;
    const budget = (now: number) => {
      const delta = now - previous;
      previous = now;
      if (dropped || delta <= 0 || delta > 400) return;
      if (delta > 26) slow += 1; else if (delta < 19) slow = Math.max(0, slow - 1);
      if (slow < 40) return;
      dropped = true;
      ratio = 1;
      renderer.setPixelRatio(1);
      renderer.setSize(viewWidth, viewHeight);
      renderer.shadowMap.needsUpdate = true;
    };

    let controls: OrbitControls | undefined;
    let invalidate: () => void;

    if (stage) {
      let length = 5, height = 1.5, nose = new THREE.Vector3(0, 0, 1), across = new THREE.Vector3(1, 0, 0);
      const centre = new THREE.Vector3();
      const spot = new THREE.Vector3();
      const look = new THREE.Vector3();
      let pointerX = 0, pointerY = 0, swingX = 0, swingY = 0;
      let drag = 0, turn = 0, holding = false, lastX = 0;
      let travelled = heroScroll.value;

      const place = (progress: number) => {
        let index = JOURNEY.length - 2;
        while (index > 0 && progress < JOURNEY[index].p) index -= 1;
        const from = JOURNEY[index], to = JOURNEY[index + 1];
        const t = ease(THREE.MathUtils.clamp((progress - from.p) / (to.p - from.p), 0, 1));
        const outside = 1 - THREE.MathUtils.clamp((progress - 0.6) / 0.2, 0, 1);
        spot.copy(centre)
          .addScaledVector(nose, mix(from.f, to.f, t) * length)
          .addScaledVector(across, mix(from.r, to.r, t) * length + swingX * outside * length * 0.2)
          .setY(mix(from.v, to.v, t) * height + swingY * 0.14 * height);
        look.copy(centre)
          .addScaledVector(nose, mix(from.tf, to.tf, t) * length)
          .addScaledVector(across, mix(from.tr, to.tr, t) * length + swingX * (1 - outside) * length * 0.12)
          .setY(mix(from.tv, to.tv, t) * height);
        camera.position.copy(spot.sub(look).applyAxisAngle(THREE.Object3D.DEFAULT_UP, drag * outside).add(look));
        camera.lookAt(look);
        // The headline owns the top of the frame, so the car is pushed below it until the drive-in starts.
        const shift = viewHeight * 0.11 * (1 - THREE.MathUtils.clamp(progress / 0.3, 0, 1));
        if (shift > 0.5) camera.setViewOffset(viewWidth, viewHeight, 0, -shift, viewWidth, viewHeight);
        else camera.clearViewOffset();
        renderer.toneMappingExposure = 1.05 + progress * 0.3;
        kicker.intensity = 6 + progress * 4;
      };

      const loop = (now: number) => {
        frame = 0;
        if (disposed) return;
        budget(now);
        const aim = heroScroll.value;
        const settling = Math.abs(aim - travelled) + Math.abs(pointerX - swingX) + Math.abs(pointerY - swingY) + Math.abs(turn - drag);
        travelled += (aim - travelled) * (motion.matches ? 1 : 0.1);
        swingX += (pointerX - swingX) * 0.06;
        swingY += (pointerY - swingY) * 0.06;
        drag += (turn - drag) * 0.09;
        place(THREE.MathUtils.clamp(travelled, 0, 1));
        renderer.render(scene, camera);
        // Nothing animates on its own, so a settled stage stops drawing altogether.
        if (settling < 0.0004) return;
        frame = requestAnimationFrame(loop);
      };
      invalidate = () => { if (!disposed && !frame) frame = requestAnimationFrame(loop); };
      disposables.push({ dispose: heroScroll.subscribe(() => invalidate()) });

      const pointer = (event: PointerEvent) => {
        const box = container.getBoundingClientRect();
        pointerX = THREE.MathUtils.clamp((event.clientX - box.left) / box.width - 0.5, -0.5, 0.5);
        pointerY = THREE.MathUtils.clamp(0.5 - (event.clientY - box.top) / box.height, -0.5, 0.5);
        if (holding) {
          turn = THREE.MathUtils.clamp(turn + (event.clientX - lastX) * 0.004, -0.9, 0.9);
          lastX = event.clientX;
        }
        invalidate();
      };
      const grab = (event: PointerEvent) => { holding = true; lastX = event.clientX; canvas.setPointerCapture(event.pointerId); };
      const release = () => { holding = false; };
      const leave = () => { pointerX = 0; pointerY = 0; holding = false; invalidate(); };
      canvas.addEventListener("pointermove", pointer);
      canvas.addEventListener("pointerdown", grab);
      canvas.addEventListener("pointerup", release);
      canvas.addEventListener("pointercancel", release);
      canvas.addEventListener("pointerleave", leave);
      disposables.push({ dispose: () => {
        canvas.removeEventListener("pointermove", pointer); canvas.removeEventListener("pointerdown", grab);
        canvas.removeEventListener("pointerup", release); canvas.removeEventListener("pointercancel", release);
        canvas.removeEventListener("pointerleave", leave);
      } });

      actions.current = (action) => {
        if (action === "left") turn = THREE.MathUtils.clamp(turn - 0.5, -0.9, 0.9);
        if (action === "right") turn = THREE.MathUtils.clamp(turn + 0.5, -0.9, 0.9);
        if (action === "reset") turn = 0;
        invalidate();
      };

      const watch = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) invalidate();
        else { cancelAnimationFrame(frame); frame = 0; }
      }, { threshold: 0 });
      watch.observe(container);
      const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else invalidate(); };
      document.addEventListener("visibilitychange", visibility);
      disposables.push({ dispose: () => { watch.disconnect(); document.removeEventListener("visibilitychange", visibility); } });

      actions.current.measure = (model) => {
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        bounds.getCenter(centre); centre.y = 0;
        const lengthwise = size.x >= size.z ? "x" : "z";
        length = Math.max(size.x, size.z); height = Math.max(size.y, 0.6);
        const sign = noseSign(model, lengthwise, centre[lengthwise]);
        nose = lengthwise === "x" ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign);
        across = new THREE.Vector3().crossVectors(nose, THREE.Object3D.DEFAULT_UP).normalize();
        key.target.position.copy(centre);
        pool.position.set(centre.x, 0.007, centre.z);
        kicker.position.copy(centre).addScaledVector(nose, -length * 0.45).addScaledVector(across, -length * 0.4).setY(0.22);
      };
    } else {
      controls = new OrbitControls(camera, canvas);
      controls.target.set(0, 0.62, 0);
      controls.enablePan = false;
      controls.enableZoom = false;        // wheel and touch keep scrolling the page; the labelled buttons zoom
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.minPolarAngle = Math.PI / 7;
      controls.maxPolarAngle = Math.PI / 2.12;
      controls.minDistance = 5;
      controls.maxDistance = 12;
      const render = (now: number) => {
        frame = 0;
        if (disposed) return;
        budget(now);
        const moved = controls!.update();
        renderer.render(scene, camera);
        if (moved) frame = requestAnimationFrame(render);
      };
      invalidate = () => { if (!disposed && !frame) frame = requestAnimationFrame(render); };
      controls.addEventListener("change", invalidate);
      controls.addEventListener("start", () => cancelAnimationFrame(animation));
      actions.current = (action) => {
        cancelAnimationFrame(animation);
        const start = camera.position.clone();
        const spherical = new THREE.Spherical().setFromVector3(start.clone().sub(controls!.target));
        if (action === "left") spherical.theta -= Math.PI / 6;
        if (action === "right") spherical.theta += Math.PI / 6;
        if (action === "in") spherical.radius = Math.max(5, spherical.radius * 0.85);
        if (action === "out") spherical.radius = Math.min(12, spherical.radius * 1.15);
        const end = action === "reset" ? home : new THREE.Vector3().setFromSpherical(spherical).add(controls!.target);
        const began = performance.now();
        const move = (now: number) => {
          if (disposed) return;
          const t = motion.matches ? 1 : Math.min(1, (now - began) / 320);
          camera.position.lerpVectors(start, end, 1 - Math.pow(1 - t, 3)); controls!.update(); invalidate();
          if (t < 1) animation = requestAnimationFrame(move);
        };
        animation = requestAnimationFrame(move);
      };
      actions.current.measure = (model) => {
        const bounds = new THREE.Box3().setFromObject(model);
        key.target.position.set(0, 0, 0);
        controls!.target.set(0, bounds.getSize(new THREE.Vector3()).y * 0.42, 0);
      };
    }

    const resize = new ResizeObserver(() => {
      if (disposed) return;
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      viewWidth = width; viewHeight = height;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const base = stage ? 36 : 34;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) / Math.max(1, camera.aspect / (stage ? 1.85 : 1.55))));
      camera.updateProjectionMatrix();
      invalidate();
    });
    resize.observe(container);

    const keys = (event: KeyboardEvent) => {
      const action = ({ ArrowLeft: "left", ArrowRight: "right", "+": "in", "=": "in", "-": "out", "0": "reset" } as Record<string, string>)[event.key];
      if (action) { event.preventDefault(); actions.current(action); }
    };
    const lost = (event: Event) => { event.preventDefault(); onError("The 3D view was interrupted."); };
    canvas.addEventListener("keydown", keys);
    canvas.addEventListener("webglcontextlost", lost);

    const draco = new DRACOLoader(); draco.setDecoderPath("/assets/draco/");
    const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
    fetch(url, { signal: abort.signal }).then((response) => {
      if (!response.ok) throw new Error("model unavailable");
      return response.arrayBuffer();
    }).then((buffer) => loader.parseAsync(buffer, new URL(".", new URL(url, window.location.origin)).href)).then((gltf) => {
      if (disposed) { dispose(gltf.scene); return; }
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.multiplyScalar(5 / Math.max(size.x, size.y, size.z));
      const bounds = new THREE.Box3().setFromObject(model);
      const middle = bounds.getCenter(new THREE.Vector3());
      model.position.set(-middle.x, -bounds.min.y, -middle.z);
      model.updateMatrixWorld(true);
      model.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
      actions.current.measure?.(model);
      scene.add(model); renderer.shadowMap.needsUpdate = true; setReady(true); invalidate();
    }).catch(() => { if (!disposed) onError("The 3D model could not be loaded."); });
    invalidate();

    return () => {
      disposed = true; abort.abort(); cancelAnimationFrame(frame); cancelAnimationFrame(animation);
      resize.disconnect(); controls?.dispose(); draco.dispose();
      canvas.removeEventListener("keydown", keys); canvas.removeEventListener("webglcontextlost", lost);
      disposables.forEach((item) => item.dispose());
      dispose(scene); environment.dispose(); key.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss();
      canvas.remove(); actions.current = () => {};
    };
  }, [url, car.make, car.model, stage, onError]);

  return <div className={`vehicle-scene ${stage ? "stage " : ""}${ready ? "ready" : ""}`}>
    {!ready && <><CarImage make={car.make} model={car.model} eager /><p className="viewer-loading" role="status"><span className="spinner" /> Loading 3D vehicle…</p></>}
    <div ref={host} className="scene-canvas" />
    {ready && <>
      <p className="viewer-hint">{stage ? "Drag to look · Scroll to drive in" : "Drag to rotate"}</p>
      <div className="viewer-controls" aria-label="3D view controls">
        <button aria-label="Rotate vehicle left" onClick={() => actions.current("left")}>↶</button>
        <button aria-label="Rotate vehicle right" onClick={() => actions.current("right")}>↷</button>
        {!stage && <button aria-label="Zoom in" onClick={() => actions.current("in")}><Icon name="plus" size={16} /></button>}
        {!stage && <button aria-label="Zoom out" onClick={() => actions.current("out")}><Icon name="minus" size={16} /></button>}
        <button aria-label="Reset vehicle view" onClick={() => actions.current("reset")}><Icon name="rotate" size={16} /></button>
      </div>
    </>}
  </div>;
}
