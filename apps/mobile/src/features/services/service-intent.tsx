import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";

type Intent = "contact" | "order";
type Control = { kind?: Intent; request: (kind: Intent) => void; close: () => void };
const ServiceIntentContext = createContext<Control | undefined>(undefined);

/** Keep only the chosen action across login's service reload, never a message or order draft. */
export function ServiceIntentProvider({ children }: { children: ReactNode }) {
  const auth = useAuth(),
    gate = useAuthGate();
  const active = useRef(false);
  const [intent, setIntent] = useState<{ kind: Intent; generation: number }>();
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <ServiceIntentContext.Provider
      value={{
        kind:
          auth.status === "authenticated" && intent?.generation === auth.generation
            ? intent.kind
            : undefined,
        request: (kind) =>
          gate.requireAuth({
            onAuthenticated: () => {
              if (active.current) setIntent({ kind, generation: getAuthGeneration() });
            },
          }),
        close: () => setIntent(undefined),
      }}
    >
      {children}
    </ServiceIntentContext.Provider>
  );
}
export const useServiceIntent = () => useContext(ServiceIntentContext);
