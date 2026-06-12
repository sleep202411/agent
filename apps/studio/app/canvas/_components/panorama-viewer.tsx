"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { IconLoader2, IconLogout } from "@tabler/icons-react";

/** The 720° panorama glyph (provided by design). */
export function Icon720({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.48 7.624a.13.13 0 0 1 .198.112.14.14 0 0 1-.045.102c-.299.28-.465.588-.465.912 0 .99 1.543 1.835 3.718 2.174v-.88c0-.192.221-.301.375-.184l1.588 1.222a.35.35 0 0 1-.007.56L5.256 12.8a.233.233 0 0 1-.37-.189v-.565C2.218 11.662.294 10.569.293 9.28c0-.615.438-1.186 1.186-1.656m10.845.112a.13.13 0 0 1 .198-.112c.748.47 1.186 1.041 1.186 1.656 0 1.36-2.14 2.5-5.033 2.824a.2.2 0 0 1-.22-.198v-.716c0-.102.078-.188.18-.2 2.425-.283 4.197-1.179 4.198-2.24 0-.324-.166-.632-.465-.912a.14.14 0 0 1-.044-.102m-1.977-6.355a1.34 1.34 0 0 1 1.254.78q.174.356.174.797v4.294q0 .441-.174.804a1.37 1.37 0 0 1-.496.564 1.35 1.35 0 0 1-.758.21q-.456 0-.779-.21a1.35 1.35 0 0 1-.485-.564 1.9 1.9 0 0 1-.164-.804V2.958q0-.446.169-.803.172-.357.495-.565.323-.21.764-.21M4.622 2.532 3.551 8.75H2.44l1.09-6.229H1.925v-1.06h2.697zm2.073-1.151q.392 0 .665.13.274.128.442.366t.243.575q.08.333.079.744 0 .492-.148 1.062a9 9 0 0 1-.388 1.165q-.238.594-.535 1.175-.298.575-.605 1.09h1.696V8.75H5.238V7.688q.343-.525.664-1.105.323-.58.58-1.166a8 8 0 0 0 .417-1.14q.154-.55.154-1.011 0-.328-.065-.61-.064-.283-.293-.283-.227 0-.292.282a2.7 2.7 0 0 0-.064.61v.506h-1.07v-.505q-.001-.436.073-.784.079-.351.248-.595.169-.247.441-.376.273-.13.664-.13m3.653 1.042a.28.28 0 0 0-.273.168.8.8 0 0 0-.084.367v4.294q0 .213.084.377.084.159.273.16a.29.29 0 0 0 .273-.16.8.8 0 0 0 .084-.377V2.958a.8.8 0 0 0-.084-.377.29.29 0 0 0-.273-.158"
      />
    </svg>
  );
}

const AXES: { v: THREE.Vector3; color: string; label: string }[] = [
  { v: new THREE.Vector3(1, 0, 0), color: "#ff5a5a", label: "X" },
  { v: new THREE.Vector3(0, 1, 0), color: "#5ad17a", label: "Y" },
  { v: new THREE.Vector3(0, 0, 1), color: "#5a9dff", label: "Z" },
];

const BASE_FOV = 75;

/** WebGL textures need CORS; remote outputs are served through the same-origin
 *  image proxy. Local blob: object URLs load directly. */
function texturedSrc(src: string): string {
  return /^https?:/i.test(src) ? `/api/img?url=${encodeURIComponent(src)}` : src;
}

/**
 * Inline equirectangular panorama renderer (three.js): the image on the inside
 * of a sphere, camera at center, drag-with-inertia to look around, scroll to
 * zoom. Sizes itself to its parent — embed it in a node, or fill a fullscreen
 * shell. `overlay` adds the X/Y/Z orientation gizmo + yaw/pitch/zoom readout.
 */
export function PanoramaCanvas({
  src,
  overlay = false,
  onLoad,
  className,
}: {
  src: string;
  overlay?: boolean;
  onLoad?: (dims: { w: number; h: number }) => void;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gizmoRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const onLoadRef = useRef(onLoad);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 1100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.className = "size-full cursor-grab touch-none active:cursor-grabbing";

    const geometry = new THREE.SphereGeometry(500, 64, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    scene.add(new THREE.Mesh(geometry, material));

    new THREE.TextureLoader().setCrossOrigin("anonymous").load(texturedSrc(src), (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.needsUpdate = true;
      onLoadRef.current?.({ w: texture.image.width, h: texture.image.height });
      setLoading(false);
    });

    let lon = 0;
    let lat = 0;
    let velLon = 0;
    let velLat = 0;
    let dragging = false;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const target = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const gizmo = gizmoRef.current?.getContext("2d") ?? null;

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (!dragging) {
        lon += velLon;
        lat += velLat;
        velLon *= 0.94;
        velLat *= 0.94;
      }
      lat = Math.max(-85, Math.min(85, lat));
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const theta = THREE.MathUtils.degToRad(lon);
      target.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      camera.lookAt(target);
      renderer.render(scene, camera);

      if (gizmo) {
        forward.copy(target).normalize();
        right.crossVectors(forward, worldUp).normalize();
        up.crossVectors(right, forward).normalize();
        const c = 30;
        const r = 22;
        gizmo.clearRect(0, 0, 60, 60);
        const drawn = AXES.map((a) => ({
          a,
          x: c + a.v.dot(right) * r,
          y: c - a.v.dot(up) * r,
          depth: a.v.dot(forward),
        })).sort((p, q) => p.depth - q.depth);
        for (const p of drawn) {
          gizmo.globalAlpha = p.depth >= 0 ? 1 : 0.35;
          gizmo.strokeStyle = p.a.color;
          gizmo.lineWidth = 1.5;
          gizmo.beginPath();
          gizmo.moveTo(c, c);
          gizmo.lineTo(p.x, p.y);
          gizmo.stroke();
          gizmo.fillStyle = p.a.color;
          gizmo.font = "8px sans-serif";
          gizmo.fillText(p.a.label, p.x - 2, p.y + 3);
        }
        gizmo.globalAlpha = 1;
      }
      if (readoutRef.current) {
        const yaw = ((Math.round(lon) % 360) + 360) % 360;
        const zoom = (BASE_FOV / camera.fov).toFixed(2);
        readoutRef.current.textContent = `H ${yaw}° · V ${Math.round(lat)}°  ·  ${Math.round(camera.fov)}° ${zoom}×`;
      }
    };
    animate();

    const onDown = (e: PointerEvent) => {
      dragging = true;
      velLon = 0;
      velLat = 0;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const speed = 0.1 * (camera.fov / BASE_FOV);
      velLon = -e.movementX * speed;
      velLat = e.movementY * speed;
      lon += velLon;
      lat += velLat;
    };
    const onUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.fov = Math.max(30, Math.min(90, camera.fov + (e.deltaY > 0 ? 2 : -2)));
      camera.updateProjectionMatrix();
    };
    const el = renderer.domElement;
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
      renderer.dispose();
      el.remove();
    };
  }, [src]);

  return (
    <div className={className}>
      <div ref={mountRef} className="size-full" />
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <IconLoader2 className="size-6 animate-spin text-white/60" stroke={1.8} />
        </div>
      )}
      {overlay && (
        <div className="pointer-events-none absolute right-4 bottom-4 flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-black/50 p-1.5 shadow-lg backdrop-blur-sm">
          <canvas ref={gizmoRef} width={60} height={60} className="size-[60px]" />
          <div
            ref={readoutRef}
            className="text-[10px] whitespace-nowrap text-white/70 tabular-nums"
          />
        </div>
      )}
    </div>
  );
}

/** Fullscreen panorama viewer: the inline canvas in a portal shell. */
export function PanoramaViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black">
      <PanoramaCanvas src={src} overlay onLoad={setDims} className="absolute inset-0" />

      <div className="pointer-events-none absolute top-5 left-5 flex items-center gap-2 text-sm text-white/85">
        <Icon720 className="size-4" />
        <span>720° Panorama</span>
        {dims && (
          <span className="text-white/45 tabular-nums">
            {dims.w}×{dims.h}
          </span>
        )}
      </div>

      <button
        type="button"
        aria-label="Exit"
        onClick={onClose}
        className="absolute top-5 right-5 flex size-10 items-center justify-center rounded-xl bg-white/10 text-white/80 backdrop-blur-md transition-colors hover:bg-white/20 hover:text-white"
      >
        <IconLogout className="size-5" stroke={1.8} />
      </button>
    </div>,
    document.body
  );
}
