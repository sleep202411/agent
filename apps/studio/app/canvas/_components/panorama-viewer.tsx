"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconLoader2, IconX } from "@tabler/icons-react";

/**
 * Zero-dependency 360°/720° panorama viewer. Renders an equirectangular image
 * onto a full-viewport canvas via a fragment-shader raycaster (no geometry, no
 * three.js): each pixel casts a ray from the camera, rotates it by the current
 * yaw/pitch, and samples the equirectangular texture. Drag to look around,
 * scroll to zoom. Rendered through a portal so the canvas transform can't clip
 * it to fullscreen.
 */
const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;
const float PI = 3.14159265359;
void main(){
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  float t = tan(uFov * 0.5);
  vec3 dir = normalize(vec3(uv.x * t * aspect, uv.y * t, -1.0));
  float cp = cos(uPitch), sp = sin(uPitch);
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
  float cy = cos(uYaw), sy = sin(uYaw);
  dir = vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy);
  float lon = atan(dir.x, -dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 st = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  gl_FragColor = texture2D(uTex, st);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}

export function PanoramaViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl");
    if (!gl) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uYaw = gl.getUniformLocation(program, "uYaw");
    const uPitch = gl.getUniformLocation(program, "uPitch");
    const uFov = gl.getUniformLocation(program, "uFov");

    const state = { yaw: 0, pitch: 0, fov: 1.2, ready: false };
    let raf = 0;
    let disposed = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const texture = gl.createTexture();
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (disposed) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      state.ready = true;
      if (loadingRef.current) loadingRef.current.style.display = "none";
    };
    image.src = src;

    const render = () => {
      if (disposed) return;
      if (state.ready) {
        gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.uniform1f(uYaw, state.yaw);
        gl.uniform1f(uPitch, state.pitch);
        gl.uniform1f(uFov, state.fov);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      raf = requestAnimationFrame(render);
    };
    render();

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      state.yaw -= ((e.clientX - lastX) / window.innerWidth) * state.fov * 2;
      state.pitch += ((e.clientY - lastY) / window.innerHeight) * state.fov * 2;
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      state.fov = Math.max(0.4, Math.min(2.4, state.fov + (e.deltaY > 0 ? 0.1 : -0.1)));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [src, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black">
      <canvas ref={canvasRef} className="size-full cursor-grab touch-none active:cursor-grabbing" />
      <div
        ref={loadingRef}
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <IconLoader2 className="size-8 animate-spin text-white/60" stroke={1.8} />
      </div>
      <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-2 text-xs text-white/70 backdrop-blur-md">
        Drag to look around · scroll to zoom
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-5 right-5 flex size-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-md transition-colors hover:bg-white/20 hover:text-white"
      >
        <IconX className="size-5" stroke={1.8} />
      </button>
    </div>,
    document.body
  );
}
