import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PanoramaCanvas } from "./panorama-viewer";
const m = vi.hoisted(() => ({
  loads: [] as Array<(texture: any) => void>,
  materials: [] as any[],
  renderers: [] as any[],
}));
vi.mock("three", () => ({
  Vector3: class {
    set() {
      return this;
    }
  },
  Scene: class {
    add() {}
  },
  PerspectiveCamera: class {
    fov = 75;
    updateProjectionMatrix() {}
    lookAt() {}
  },
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    dispose = vi.fn();
    setPixelRatio() {}
    setSize() {}
    render() {}
    constructor() {
      m.renderers.push(this);
    }
  },
  SphereGeometry: class {
    scale() {}
    dispose() {}
  },
  MeshBasicMaterial: class {
    map: any;
    dispose = vi.fn();
    constructor() {
      m.materials.push(this);
    }
  },
  Mesh: class {},
  TextureLoader: class {
    setCrossOrigin() {
      return this;
    }
    load(_src: string, done: (texture: any) => void) {
      m.loads.push(done);
    }
  },
  MathUtils: { degToRad: (n: number) => (n * Math.PI) / 180 },
  SRGBColorSpace: "srgb",
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@tabler/icons-react", () => ({
  IconLoader2: () => createElement("span", { "data-testid": "loading" }),
  IconLogout: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  m.loads = [];
  m.materials = [];
  m.renderers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function show(src: string, onLoad = vi.fn()) {
  act(() => root!.render(createElement(PanoramaCanvas, { src, onLoad })));
  return onLoad;
}
function texture() {
  return { image: { width: 800, height: 400 }, dispose: vi.fn() };
}
it("ignores and disposes a texture arriving after unmount", () => {
  const onLoad = show("a");
  act(() => root!.unmount());
  root = undefined;
  const late = texture();
  act(() => m.loads[0](late));
  expect(onLoad).not.toHaveBeenCalled();
  expect(late.dispose).toHaveBeenCalledOnce();
  expect(m.materials[0].map).toBeUndefined();
});
it("does not deliver old image dimensions to the replacement callback", () => {
  show("a");
  const current = show("b");
  const late = texture();
  act(() => m.loads[0](late));
  expect(current).not.toHaveBeenCalled();
  expect(late.dispose).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-testid="loading"]')).not.toBeNull();
});
it("restores loading state while the replacement image loads", () => {
  show("a");
  act(() => m.loads[0](texture()));
  expect(host.querySelector('[data-testid="loading"]')).toBeNull();
  show("b");
  expect(host.querySelector('[data-testid="loading"]')).not.toBeNull();
});
it("reports the current image and disposes the loaded texture on cleanup", () => {
  const onLoad = show("a");
  const loaded = texture();
  act(() => m.loads[0](loaded));
  expect(onLoad).toHaveBeenCalledWith({ w: 800, h: 400 });
  act(() => root!.unmount());
  root = undefined;
  expect(loaded.dispose).toHaveBeenCalledOnce();
  expect(m.renderers[0].dispose).toHaveBeenCalledOnce();
});
