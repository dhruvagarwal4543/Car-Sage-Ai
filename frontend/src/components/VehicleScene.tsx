import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Car } from "../types";
import { CarImage } from "./CarImage";
import { Icon } from "./Icon";
import { useTheme } from "../theme";

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

export default function VehicleScene({ url, car, onError }: { url: string; car: Car; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<(action: string) => void>(() => {});
  const [ready, setReady] = useState(false);
  const { theme } = useTheme();
  const themeRef = useRef(theme); themeRef.current = theme;
  const lighting = useRef<(dark: boolean) => void>(() => {});
  useEffect(() => lighting.current(theme === "dark"), [theme]);

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { onError("3D is unavailable on this device."); return; }
    let disposed = false, frame = 0, animation = 0;
    const abort = new AbortController();
    const mobile = window.matchMedia("(max-width: 600px)").matches;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${car.make} ${car.model} interactive 3D model. Drag to rotate; arrow keys rotate; plus and minus zoom; zero resets.`);
    container.appendChild(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    const initial = new THREE.Vector3(4.6, 2.25, 5.2);
    camera.position.copy(initial);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.65, 0);
    controls.enablePan = false;
    controls.enableZoom = false; // wheel/touch scrolling stays available; use the labelled zoom buttons
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minPolarAngle = Math.PI / 7;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.minDistance = 5;
    controls.maxDistance = 12;
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    dispose(room); pmrem.dispose();
    const fill = new THREE.HemisphereLight(0xffffff, 0xd8dbd5, 2);
    scene.add(fill);
    const light = new THREE.DirectionalLight(0xffffff, 4);
    light.position.set(4, 7, 5); light.castShadow = true;
    light.shadow.mapSize.setScalar(mobile ? 512 : 1024);
    Object.assign(light.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
    light.shadow.bias = -0.001;
    scene.add(light);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 64), new THREE.ShadowMaterial({ opacity: 0.14 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.position.y = -0.015;
    scene.add(floor);

    const render = () => {
      frame = 0;
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
    };
    const invalidate = () => { if (!disposed && !frame) frame = requestAnimationFrame(render); };
    lighting.current = (dark) => {
      renderer.toneMappingExposure = dark ? 1.05 : 1.3;
      scene.environmentIntensity = dark ? .75 : 1;
      fill.color.set(dark ? 0xdce6ff : 0xffffff);
      fill.groundColor.set(dark ? 0x182334 : 0xd8dbd5);
      fill.intensity = dark ? 1.2 : 2;
      light.intensity = dark ? 3 : 4;
      floor.material.opacity = dark ? .32 : .14;
      invalidate();
    };
    lighting.current(themeRef.current === "dark");
    controls.addEventListener("change", invalidate);
    const resize = new ResizeObserver(() => {
      if (disposed) return;
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height); camera.aspect = width / height;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(35) / 2) / Math.max(1, camera.aspect / 1.55)));
      camera.updateProjectionMatrix(); invalidate();
    });
    resize.observe(container);

    actions.current = (action) => {
      cancelAnimationFrame(animation);
      const start = camera.position.clone();
      const spherical = new THREE.Spherical().setFromVector3(start.clone().sub(controls.target));
      if (action === "left") spherical.theta -= Math.PI / 6;
      if (action === "right") spherical.theta += Math.PI / 6;
      if (action === "in") spherical.radius = Math.max(5, spherical.radius * 0.85);
      if (action === "out") spherical.radius = Math.min(12, spherical.radius * 1.15);
      const end = action === "reset" ? initial : new THREE.Vector3().setFromSpherical(spherical).add(controls.target);
      const began = performance.now();
      const move = (now: number) => {
        if (disposed) return;
        const t = motion.matches ? 1 : Math.min(1, (now - began) / 280);
        camera.position.lerpVectors(start, end, 1 - Math.pow(1 - t, 3)); controls.update(); invalidate();
        if (t < 1) animation = requestAnimationFrame(move);
      };
      animation = requestAnimationFrame(move);
    };
    const key = (event: KeyboardEvent) => {
      const action = ({ ArrowLeft: "left", ArrowRight: "right", "+": "in", "=": "in", "-": "out", "0": "reset" } as Record<string, string>)[event.key];
      if (action) { event.preventDefault(); actions.current(action); }
    };
    const lost = (event: Event) => { event.preventDefault(); onError("The 3D view was interrupted."); };
    canvas.addEventListener("keydown", key);
    canvas.addEventListener("webglcontextlost", lost);
    controls.addEventListener("start", () => cancelAnimationFrame(animation));
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
      const scale = 5 / Math.max(size.x, size.y, size.z);
      model.scale.multiplyScalar(scale);
      const bounds = new THREE.Box3().setFromObject(model);
      const centre = bounds.getCenter(new THREE.Vector3());
      model.position.set(-centre.x, -bounds.min.y, -centre.z);
      model.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
      scene.add(model); setReady(true); invalidate();
    }).catch(() => { if (!disposed) onError("The 3D model could not be loaded."); });
    invalidate();

    return () => {
      disposed = true; abort.abort(); cancelAnimationFrame(frame); cancelAnimationFrame(animation);
      resize.disconnect(); controls.dispose(); draco.dispose();
      canvas.removeEventListener("keydown", key); canvas.removeEventListener("webglcontextlost", lost);
      dispose(scene); environment.dispose(); light.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss();
      canvas.remove(); actions.current = () => {}; lighting.current = () => {};
    };
  }, [url, car.make, car.model, onError]);

  return <div className={`vehicle-scene ${ready ? "ready" : ""}`}>
    {!ready && <><CarImage make={car.make} model={car.model} eager /><p className="viewer-loading" role="status"><span className="spinner" /> Loading 3D vehicle…</p></>}
    <div ref={host} className="scene-canvas" />
    {ready && <>
      <p className="viewer-hint">Drag sideways to rotate · Scroll to browse</p>
      <div className="viewer-controls" aria-label="3D view controls">
        <button aria-label="Rotate vehicle left" onClick={() => actions.current("left")}>↶</button>
        <button aria-label="Rotate vehicle right" onClick={() => actions.current("right")}>↷</button>
        <button aria-label="Zoom in" onClick={() => actions.current("in")}><Icon name="plus" size={17} /></button>
        <button aria-label="Zoom out" onClick={() => actions.current("out")}><Icon name="minus" size={17} /></button>
        <button aria-label="Reset vehicle view" onClick={() => actions.current("reset")}><Icon name="rotate" size={17} /></button>
      </div>
    </>}
  </div>;
}
