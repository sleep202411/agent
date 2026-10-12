import { useEffect, useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { toHref } from "@/lib/navigation";
import { StoryTopUpRecoveryDialog } from "../components/story-top-up-recovery-dialog";
import { storyTopUpReturnPath, storyTopUpReturnStore } from "../lib/story-top-up-return";

/** Home-only recovery leaves incoming deep links and live checkout navigation alone. */
export function useStoryTopUpRecovery() {
  const auth = useAuth();
  const active = useScreenActive();
  const offered = useRef("");
  const [notice, setNotice] = useState<{ generation: number; dialog: ReactNode } | null>(null);
  const accountId =
    auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : "";
  useEffect(() => {
    // Reconcile the external durable destination at the account/focus boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotice(null);
    if (!active || !accountId) return;
    let current = true;
    const owns = () => current && getAuthGeneration() === auth.generation;
    const store = storyTopUpReturnStore(accountId);
    const failed = (error: unknown) =>
      setNotice({
        generation: auth.generation,
        dialog: (
          <StoryTopUpRecoveryDialog
            error={error instanceof Error ? error.message : String(error)}
            onCancel={() => {
              if (owns()) setNotice(null);
            }}
          />
        ),
      });
    try {
      const entry = store.interrupted();
      if (!entry || offered.current === entry.id) return;
      offered.current = entry.id;
      let responded = false;
      const act = (resume: boolean) => {
        if (!owns() || responded) return;
        responded = true;
        try {
          if (!store.matches(entry.id)) {
            setNotice(null);
            return;
          }
          if (resume) router.push(toHref(storyTopUpReturnPath(entry)));
          else store.clear(entry.id);
          setNotice(null);
        } catch (error) {
          offered.current = "";
          failed(error);
        }
      };
      setNotice({
        generation: auth.generation,
        dialog: (
          <StoryTopUpRecoveryDialog onCancel={() => act(false)} onContinue={() => act(true)} />
        ),
      });
    } catch (error) {
      failed(error);
    }
    return () => {
      current = false;
      offered.current = "";
    };
  }, [accountId, active, auth.generation]);
  return active && accountId && notice?.generation === auth.generation ? notice.dialog : null;
}
