import { useEffect, useRef } from "react";
import * as THREE from "three";

// A fixed field of dust behind the whole site: one draw call, no lights, drifting slowly.
// It gives every page the same depth as the showroom without competing with anything on it.
const COUNT = 520;

function speckTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function BackdropField() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" }); }
    catch { return; }
    let disposed = false, frame = 0;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 90);
    camera.position.z = 18;

    const positions = new Float32Array(COUNT * 3);
    const colours = new Float32Array(COUNT * 3);
    const scales = new Float32Array(COUNT);
    const cool = new THREE.Color(0xa8c4e8);
    const warm = new THREE.Color(0xb09cff);
    for (let index = 0; index < COUNT; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 52;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 34;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 30;
      const tint = Math.random() < 0.08 ? warm : cool;
      const level = 0.25 + Math.random() * 0.75;
      colours[index * 3] = tint.r * level;
      colours[index * 3 + 1] = tint.g * level;
      colours[index * 3 + 2] = tint.b * level;
      scales[index] = 0.06 + Math.random() * 0.16;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const material = new THREE.PointsMaterial({
      size: 0.17, sizeAttenuation: true, map: speckTexture(), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85,
    });
    const dust = new THREE.Points(geometry, material);
    scene.add(dust);

    let pointerX = 0, pointerY = 0, swayX = 0, swayY = 0;
    const pointer = (event: PointerEvent) => {
      pointerX = event.clientX / window.innerWidth - 0.5;
      pointerY = event.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", pointer, { passive: true });

    let beat = 0;
    const draw = (now: number) => {
      frame = 0;
      if (disposed) return;
      if (!still && now - beat < 32) { frame = requestAnimationFrame(draw); return; }   // ~30fps is plenty for dust
      beat = now;
      if (!still) {
        dust.rotation.y = now / 95000;
        dust.rotation.x = Math.sin(now / 130000) * 0.12;
      }
      swayX += (pointerX - swayX) * 0.02;
      swayY += (pointerY - swayY) * 0.02;
      camera.position.x = swayX * 2.4;
      camera.position.y = -swayY * 1.6;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      if (!still) frame = requestAnimationFrame(draw);
    };
    const invalidate = () => { if (!disposed && !frame) frame = requestAnimationFrame(draw); };

    const resize = () => {
      if (disposed) return;
      const width = window.innerWidth, height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      invalidate();
    };
    resize();
    window.addEventListener("resize", resize);
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else invalidate(); };
    document.addEventListener("visibilitychange", visibility);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", pointer);
      document.removeEventListener("visibilitychange", visibility);
      geometry.dispose(); material.map?.dispose(); material.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, []);

  return <div className="backdrop" ref={host} aria-hidden="true" />;
}
