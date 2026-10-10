/** Offline equirectangular renderer. The host supplies bytes, never credentials. */
const initial = JSON.parse(document.querySelector("[data-initial]")!.textContent!);
const canvas = document.querySelector("canvas")!;
const status = document.querySelector("[data-status]")!;
const send = (type: string, detail?: string) => {
  const raw = JSON.stringify({ sessionId: initial.sessionId, type, detail });
  const host = window as unknown as { ReactNativeWebView?: { postMessage(raw: string): void } };
  if (host.ReactNativeWebView) host.ReactNativeWebView.postMessage(raw);
  else window.parent.postMessage(raw, "*");
};
let disposed = false;
const cleanups: (() => void)[] = [];
function dispose() {
  if (disposed) return;
  disposed = true;
  cleanups.reverse().forEach((cleanup) => cleanup());
}
function fail() {
  if (disposed) return;
  send("error");
  dispose();
}
try {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
  if (!gl) throw Error("WebGL unavailable");
  const shader = (kind: number, source: string) => {
    const value = gl.createShader(kind)!;
    cleanups.push(() => gl.deleteShader(value));
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw Error("Shader compilation failed");
    return value;
  };
  const program = gl.createProgram()!;
  cleanups.push(() => gl.deleteProgram(program));
  gl.attachShader(
    program,
    shader(
      gl.VERTEX_SHADER,
      `attribute vec2 p; varying vec2 uv; void main(){uv=p;gl_Position=vec4(p,0.,1.);}`
    )
  );
  gl.attachShader(
    program,
    shader(
      gl.FRAGMENT_SHADER,
      `precision highp float;
    varying vec2 uv; uniform sampler2D image; uniform vec4 view;
    void main(){
      vec3 ray=normalize(vec3(uv.x*view.w,uv.y,1./tan(radians(view.z)*.5)));
      float pitch=radians(view.y); float yaw=radians(view.x);
      vec3 pitched=vec3(ray.x,ray.y*cos(pitch)+ray.z*sin(pitch),ray.z*cos(pitch)-ray.y*sin(pitch));
      vec3 dir=vec3(pitched.x*cos(yaw)+pitched.z*sin(yaw),pitched.y,pitched.z*cos(yaw)-pitched.x*sin(yaw));
      vec2 coord=vec2(fract(atan(dir.x,dir.z)/6.2831853+.5),.5-asin(clamp(dir.y,-1.,1.))/3.14159265);
      gl_FragColor=texture2D(image,coord);
    }`
    )
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error("Shader link failed");
  gl.useProgram(program);
  const buffer = gl.createBuffer()!;
  cleanups.push(() => gl.deleteBuffer(buffer));
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const position = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture()!;
  cleanups.push(() => gl.deleteTexture(texture));
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  let yaw = 0,
    pitch = 0,
    fov = 75,
    ready = false;
  const view = gl.getUniformLocation(program, "view");
  const draw = () => {
    if (disposed || !ready || document.hidden) return;
    pitch = Math.max(-85, Math.min(85, pitch));
    fov = Math.max(30, Math.min(90, fov));
    yaw = ((yaw % 360) + 360) % 360;
    const w = Math.max(1, canvas.clientWidth),
      h = Math.max(1, canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * ratio)) canvas.width = Math.round(w * ratio);
    if (canvas.height !== Math.round(h * ratio)) canvas.height = Math.round(h * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform4f(view, yaw, pitch, fov, w / h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    status.textContent = `${Math.round(yaw)}° · ${Math.round(pitch)}° · ${(75 / fov).toFixed(1)}×`;
  };
  const image = new Image();
  const timeout = setTimeout(fail, 20000);
  cleanups.push(() => {
    clearTimeout(timeout);
    image.onload = null;
    image.onerror = null;
    image.src = "";
  });
  image.onload = () => {
    if (disposed) return;
    try {
      clearTimeout(timeout);
      if (!image.width || !image.height || Math.abs(image.width / image.height - 2) >= 0.15)
        throw Error("Invalid panorama");
      // Downsample only the preview to the device texture limit; never alter the asset.
      const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
      let pixels: TexImageSource = image;
      if (image.width > max || image.height > max) {
        const resize = document.createElement("canvas");
        const scale = Math.min(max / image.width, max / image.height);
        resize.width = Math.floor(image.width * scale);
        resize.height = Math.floor(image.height * scale);
        resize.getContext("2d")!.drawImage(image, 0, 0, resize.width, resize.height);
        pixels = resize;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw Error("Texture upload failed");
      ready = true;
      draw();
      send("loaded", `${image.width}×${image.height}`);
    } catch {
      fail();
    }
  };
  image.onerror = fail;
  image.src = initial.src;
  const points = new Map<number, { x: number; y: number }>();
  const distance = () => {
    const [a, b] = [...points.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const listen = (
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions
  ) => {
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  };
  listen(canvas, "pointerdown", ((e: PointerEvent) => {
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
  }) as EventListener);
  listen(canvas, "pointermove", ((e: PointerEvent) => {
    const previous = points.get(e.pointerId);
    if (!previous) return;
    const oldDistance = distance();
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.size === 1) {
      yaw -= ((e.clientX - previous.x) * 0.1 * fov) / 75;
      pitch += ((e.clientY - previous.y) * 0.1 * fov) / 75;
    } else {
      const next = distance();
      if (next > 0 && oldDistance > 0) fov *= oldDistance / next;
    }
    draw();
  }) as EventListener);
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    listen(canvas, event, ((e: PointerEvent) => {
      points.delete(e.pointerId);
    }) as EventListener);
  listen(
    canvas,
    "wheel",
    ((e: WheelEvent) => {
      e.preventDefault();
      fov += e.deltaY > 0 ? 2 : -2;
      draw();
    }) as EventListener,
    { passive: false }
  );
  const actions: Record<string, () => void> = {
    left: () => (yaw -= 15),
    right: () => (yaw += 15),
    up: () => (pitch += 15),
    down: () => (pitch -= 15),
    zoomIn: () => (fov -= 5),
    zoomOut: () => (fov += 5),
    reset: () => {
      yaw = 0;
      pitch = 0;
      fov = 75;
    },
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-action]"))
    listen(button, "click", () => {
      actions[button.dataset.action!]!();
      draw();
    });
  listen(canvas, "keydown", ((e: KeyboardEvent) => {
    const key: Record<string, string> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      "+": "zoomIn",
      "-": "zoomOut",
      "0": "reset",
    };
    if (key[e.key]) {
      e.preventDefault();
      actions[key[e.key]!]!();
      draw();
    }
  }) as EventListener);
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  cleanups.push(() => observer.disconnect());
  listen(document, "visibilitychange", () => {
    points.clear();
    draw();
  });
  listen(canvas, "webglcontextlost", (e) => {
    e.preventDefault();
    fail();
  });
  listen(window, "pagehide", dispose);
} catch {
  fail();
}

export {};
