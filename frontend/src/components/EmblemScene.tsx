import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// A machined gyroscope, built here rather than loaded: a bevelled lathe disc inside two
// counter-rotating gimbals, around a lit core. It is the brand object for pages with no vehicle.

function bevelledDisc() {
  const profile: THREE.Vector2[] = [];
  const push = (x: number, y: number) => profile.push(new THREE.Vector2(x, y));
  push(0, 0.12); push(0.46, 0.12); push(0.54, 0.09); push(0.58, 0.03);
  push(0.58, -0.03); push(0.54, -0.09); push(0.46, -0.12); push(0, -0.12);
  return new THREE.LatheGeometry(profile, 56);
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(142,203,255,0.85)");
  gradient.addColorStop(0.3, "rgba(176,156,255,0.28)");
  gradient.addColorStop(1, "rgba(142,203,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function EmblemScene({ label = "" }: { label?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { return; }
    let disposed = false, frame = 0;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
    camera.position.set(0, 0.5, 4.3);
    camera.lookAt(0, 0, 0);

    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.5;
    room.traverse((node) => { if (node instanceof THREE.Mesh) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); } });
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0x9fb4d4, 0x05070b, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 4, 4);
    const rim = new THREE.DirectionalLight(0xb09cff, 2.4);
    rim.position.set(-3.4, -1.2, -2.6);
    scene.add(key, rim);

    const steel = new THREE.MeshStandardMaterial({ color: 0x8e9aa8, roughness: 0.26, metalness: 1 });
    const graphite = new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.38, metalness: 0.95 });
    const core = new THREE.MeshStandardMaterial({ color: 0x8ecbff, emissive: 0x8ecbff, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0 });

    const rig = new THREE.Group();
    const discGeometry = bevelledDisc();
    const disc = new THREE.Mesh(discGeometry, steel);
    disc.rotation.x = Math.PI / 2;
    const outerGeometry = new THREE.TorusGeometry(0.98, 0.022, 10, 96);
    const outer = new THREE.Mesh(outerGeometry, graphite);
    const innerGeometry = new THREE.TorusGeometry(0.78, 0.018, 10, 88);
    const inner = new THREE.Mesh(innerGeometry, graphite);
    inner.rotation.y = Math.PI / 2;
    const coreGeometry = new THREE.SphereGeometry(0.1, 24, 16);
    const bead = new THREE.Mesh(coreGeometry, core);
    rig.add(disc, outer, inner, bead);
    rig.rotation.set(-0.42, 0.5, 0.12);
    scene.add(rig);

    const halo = glowTexture();
    const haloMaterial = new THREE.SpriteMaterial({ map: halo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(haloMaterial);
    sprite.scale.setScalar(2.4);
    scene.add(sprite);

    let pointerX = 0, pointerY = 0, swayX = 0, swayY = 0;
    const pointer = (event: PointerEvent) => {
      const box = container.getBoundingClientRect();
      pointerX = THREE.MathUtils.clamp((event.clientX - box.left) / box.width - 0.5, -0.5, 0.5);
      pointerY = THREE.MathUtils.clamp((event.clientY - box.top) / box.height - 0.5, -0.5, 0.5);
    };
    window.addEventListener("pointermove", pointer, { passive: true });

    const draw = (now: number) => {
      frame = 0;
      if (disposed) return;
      if (!still) {
        outer.rotation.z = now / 7000;
        inner.rotation.z = -now / 5200;
        disc.rotation.z = now / 12000;
        bead.scale.setScalar(1 + Math.sin(now / 900) * 0.06);
        core.emissiveIntensity = 1.35 + Math.sin(now / 900) * 0.25;
      }
      swayX += (pointerX - swayX) * 0.045;
      swayY += (pointerY - swayY) * 0.045;
      rig.rotation.x = -0.42 + swayY * 0.5;
      rig.rotation.y = 0.5 + swayX * 0.9;
      renderer.render(scene, camera);
      if (!still) frame = requestAnimationFrame(draw);
    };
    const invalidate = () => { if (!disposed && !frame) frame = requestAnimationFrame(draw); };

    const resize = new ResizeObserver(() => {
      if (disposed) return;
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      invalidate();
    });
    resize.observe(container);

    const watch = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) invalidate();
      else { cancelAnimationFrame(frame); frame = 0; }
    }, { threshold: 0 });
    watch.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect(); watch.disconnect();
      window.removeEventListener("pointermove", pointer);
      [discGeometry, outerGeometry, innerGeometry, coreGeometry].forEach((geometry) => geometry.dispose());
      [steel, graphite, core, haloMaterial].forEach((material) => material.dispose());
      halo.dispose(); environment.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, []);

  return <div className="emblem" ref={host} role={label ? "img" : "presentation"} aria-label={label || undefined} />;
}
