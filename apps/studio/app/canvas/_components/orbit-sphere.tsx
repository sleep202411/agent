"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** WebGL textures need CORS; remote outputs go through the same-origin proxy. */
function texturedSrc(src: string): string {
  return /^https?:/i.test(src) ? `/api/img?url=${encodeURIComponent(src)}` : src;
}

/** Point on a radius-R sphere at (azimuth°, elevation°). Matches three's
 *  `Spherical`: theta = atan2(x, z) = azimuth, phi = acos(y/r) = 90° − elevation
 *  — so OrbitControls' getAzimuthalAngle/getPolarAngle read back these exactly. */
function sphericalToVec3(azimuthDeg: number, elevationDeg: number, r: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(
    r * Math.cos(el) * Math.sin(az),
    r * Math.sin(el),
    r * Math.cos(el) * Math.cos(az)
  );
}

/** Shortest absolute angular gap (deg) between two azimuths, handling wrap. */
function azGap(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

const R = 1;
const DIST = 3.2 * R;

/**
 * Interactive camera-orbit sphere built on three.js' official OrbitControls
 * (shipped with `three`): drag in ANY direction to orbit the camera freely
 * around the subject — horizontal = azimuth (full 360°), vertical = elevation —
 * with inertial damping for a smooth feel. The wireframe globe gives the
 * spatial reference; the subject billboards at the centre so it stays readable
 * while you orbit. Fully controlled: OrbitControls' angles are reported via
 * `onChange`, and external azimuth/elevation changes (sliders / presets) drive
 * the camera back, so the sphere and the sliders stay in sync.
 */
export function OrbitSphere({
  src,
  azimuth,
  elevation,
  minElevation,
  maxElevation,
  onChange,
  className,
}: {
  src: string;
  azimuth: number;
  elevation: number;
  minElevation: number;
  maxElevation: number;
  onChange: (azimuth: number, elevation: number) => void;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Live interaction state in refs so the one-time scene effect never tears
  // down on a prop/handler change (mirrors the panorama viewer's pattern).
  const azRef = useRef(azimuth);
  const elRef = useRef(elevation);
  const onChangeRef = useRef(onChange);
  // Set by the scene effect: imperatively drive the camera to (az, el).
  const applyRef = useRef<((azimuth: number, elevation: number) => void) | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    // Guards the async texture-load callback against firing after teardown.
    let disposed = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.className = "size-full cursor-grab touch-none active:cursor-grabbing";

    // ── Wireframe globe (static; the camera orbits around it) ────────────────
    const gridMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.16,
    });
    const equatorMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
    });
    const globe = new THREE.Group();
    scene.add(globe);
    const circle = (pts: THREE.Vector3[], mat: THREE.LineBasicMaterial) =>
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    const STEPS = 96;
    for (let i = 1; i < 6; i++) {
      const lat = -Math.PI / 2 + (Math.PI * i) / 6;
      const y = R * Math.sin(lat);
      const r = R * Math.cos(lat);
      const pts: THREE.Vector3[] = [];
      for (let a = 0; a <= STEPS; a++) {
        const t = (a / STEPS) * Math.PI * 2;
        pts.push(new THREE.Vector3(r * Math.cos(t), y, r * Math.sin(t)));
      }
      globe.add(circle(pts, i === 3 ? equatorMat : gridMat));
    }
    for (let i = 0; i < 6; i++) {
      const lon = (Math.PI * i) / 6;
      const pts: THREE.Vector3[] = [];
      for (let a = 0; a <= STEPS; a++) {
        const t = (a / STEPS) * Math.PI * 2;
        pts.push(
          new THREE.Vector3(
            R * Math.cos(t) * Math.sin(lon),
            R * Math.sin(t),
            R * Math.cos(t) * Math.cos(lon)
          )
        );
      }
      globe.add(circle(pts, gridMat));
    }

    // ── Subject billboard at centre (readable while the globe orbits) ────────
    const subjectMat = new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 0,
    });
    const subject = new THREE.Mesh(new THREE.PlaneGeometry(0.62 * R, 0.62 * R), subjectMat);
    scene.add(subject);
    new THREE.TextureLoader().setCrossOrigin("anonymous").load(texturedSrc(src), (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      const img = texture.image as { width: number; height: number };
      const aspect = img.width && img.height ? img.width / img.height : 1;
      const base = 0.64 * R;
      subject.geometry.dispose();
      subject.geometry = new THREE.PlaneGeometry(
        aspect >= 1 ? base : base * aspect,
        aspect >= 1 ? base / aspect : base
      );
      subjectMat.map = texture;
      subjectMat.opacity = 0.96;
      subjectMat.needsUpdate = true;
    });

    // ── Official OrbitControls: free, damped drag-orbit in any direction ─────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.55;
    // Elevation bounds map to polar limits: polar = 90° − elevation.
    controls.minPolarAngle = THREE.MathUtils.degToRad(90 - maxElevation);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(90 - minElevation);

    let suppress = false;
    const apply = (azDeg: number, elDeg: number) => {
      const p = sphericalToVec3(azDeg, elDeg, DIST);
      camera.position.set(p.x, p.y, p.z);
      suppress = true;
      controls.update();
      suppress = false;
    };
    apply(azRef.current, elRef.current);
    applyRef.current = apply;

    controls.addEventListener("change", () => {
      if (suppress) return;
      const az = ((THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()) % 360) + 360) % 360;
      const el = 90 - THREE.MathUtils.radToDeg(controls.getPolarAngle());
      azRef.current = az;
      elRef.current = el;
      onChangeRef.current(Math.round(az), Math.round(el));
    });

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

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      subject.lookAt(camera.position);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      applyRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      globe.traverse((o) => {
        if (o instanceof THREE.Line) o.geometry.dispose();
      });
      gridMat.dispose();
      equatorMat.dispose();
      subject.geometry.dispose();
      subjectMat.map?.dispose();
      subjectMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [src, minElevation, maxElevation]);

  // External azimuth/elevation (sliders / presets) drive the camera. Guarded
  // against the echo of our own drag emits (which round to whole degrees).
  useEffect(() => {
    if (!applyRef.current) return;
    if (azGap(azimuth, azRef.current) > 0.5 || Math.abs(elevation - elRef.current) > 0.5) {
      azRef.current = azimuth;
      elRef.current = elevation;
      applyRef.current(azimuth, elevation);
    }
  }, [azimuth, elevation]);

  return <div ref={mountRef} className={className} />;
}
