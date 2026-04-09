import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { setupInterceptors } from "@/src/lib/api";
import { StoreProvider } from "@/src/store/provider";
import { useIframeToken } from "@/src/hooks/use-iframe-token";

export function Providers({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  useEffect(() => {
    if (!initialized.current) {
      setupInterceptors();
      initialized.current = true;
    }
  }, []);

  // Wait for satoken from parent window when running in iframe
  const tokenReady = useIframeToken();

  if (!tokenReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <StoreProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </StoreProvider>
  );
}
