/** Registered by CPT task UI — invoked when adaptive/session max stop latches in the store. */
export type CptBlockEndHandler = () => Promise<boolean>;

let handler: CptBlockEndHandler | null = null;

export function registerCptBlockEndHandler(fn: CptBlockEndHandler | null): void {
  handler = fn;
}

export function scheduleCptBlockEndCompletion(): void {
  queueMicrotask(() => {
    void handler?.();
  });
}
