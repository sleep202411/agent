// React Native runtimes can expose AbortSignal without throwIfAborted.
// Keep cancellation checks working across mobile flows and shared packages.
if (typeof AbortSignal.prototype.throwIfAborted !== "function") {
  Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
    configurable: true,
    writable: true,
    value: function throwIfAborted(this: AbortSignal): void {
      if (!this.aborted) return;
      if (this.reason !== undefined) throw this.reason;

      // Older native runtimes may also lack reason and DOMException.
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      throw error;
    },
  });
}

export {};
