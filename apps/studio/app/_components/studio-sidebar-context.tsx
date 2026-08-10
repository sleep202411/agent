"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

const SIDEBAR_MEDIA_QUERY = "(max-width: 1023px)";
const SIDEBAR_CHANGE_EVENT = "fizzstudio:sidebar-change";
const EXPANDED_WIDTH = 240;
const COLLAPSED_WIDTH = 72;
let narrowSidebarOpen = false;
let desktopSidebarCollapsed = false;

type StudioSidebarContextValue = {
  collapsed: boolean;
  narrowSidebarOpen: boolean;
  width: number;
  expandSidebar: () => void;
  collapseSidebar: () => void;
};

const StudioSidebarContext = createContext<StudioSidebarContextValue | null>(null);

type SidebarSnapshot =
  | "desktop-expanded"
  | "desktop-collapsed"
  | "narrow-collapsed"
  | "narrow-open";

function getSidebarSnapshot(): SidebarSnapshot {
  if (window.matchMedia(SIDEBAR_MEDIA_QUERY).matches) {
    return narrowSidebarOpen ? "narrow-open" : "narrow-collapsed";
  }
  return desktopSidebarCollapsed ? "desktop-collapsed" : "desktop-expanded";
}

function getServerSidebarSnapshot(): SidebarSnapshot {
  return "desktop-expanded";
}

function subscribeToSidebar(listener: () => void) {
  const mediaQuery = window.matchMedia(SIDEBAR_MEDIA_QUERY);
  const onViewportChange = () => {
    narrowSidebarOpen = false;
    listener();
  };

  window.addEventListener(SIDEBAR_CHANGE_EVENT, listener);
  mediaQuery.addEventListener("change", onViewportChange);

  return () => {
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, listener);
    mediaQuery.removeEventListener("change", onViewportChange);
  };
}

function setSidebarCollapsed(collapsed: boolean) {
  if (window.matchMedia(SIDEBAR_MEDIA_QUERY).matches) {
    narrowSidebarOpen = !collapsed;
  } else {
    desktopSidebarCollapsed = collapsed;
  }
  window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
}

export function StudioSidebarProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeToSidebar,
    getSidebarSnapshot,
    getServerSidebarSnapshot
  );
  const collapsed = snapshot === "desktop-collapsed" || snapshot === "narrow-collapsed";
  const overlayOpen = snapshot === "narrow-open";

  const value = useMemo<StudioSidebarContextValue>(
    () => ({
      collapsed,
      narrowSidebarOpen: overlayOpen,
      width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
      expandSidebar: () => setSidebarCollapsed(false),
      collapseSidebar: () => setSidebarCollapsed(true),
    }),
    [collapsed, overlayOpen]
  );

  const shellStyle = {
    "--studio-sidebar-width": `${value.width}px`,
  } as CSSProperties;

  return (
    <StudioSidebarContext.Provider value={value}>
      <div className="contents" style={shellStyle}>
        {children}
      </div>
    </StudioSidebarContext.Provider>
  );
}

export function useStudioSidebar() {
  const context = useContext(StudioSidebarContext);
  if (!context) {
    throw new Error("useStudioSidebar must be used within StudioSidebarProvider");
  }
  return context;
}

export function StudioSidebarInset({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { width } = useStudioSidebar();

  return (
    <div
      className={className}
      style={{
        marginLeft: width,
        width: `calc(100% - ${width}px)`,
        transition: "margin-left 240ms ease, width 240ms ease",
      }}
    >
      {children}
    </div>
  );
}
