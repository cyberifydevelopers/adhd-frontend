import { useCallback, useEffect, useRef, useState } from "react";

type CountdownPhase = "practice" | "main";

type CountdownState = {
  phase: CountdownPhase;
  secondsLeft: number;
} | null;

export function useTaskStartCountdown() {
  const [countdown, setCountdown] = useState<CountdownState>(null);
  const onCompleteRef = useRef<(() => void | Promise<void>) | null>(null);

  const startCountdown = useCallback((phase: CountdownPhase, onComplete: () => void | Promise<void>) => {
    setCountdown((current) => {
      if (current) return current;
      onCompleteRef.current = onComplete;
      return { phase, secondsLeft: 3 };
    });
  }, []);

  const cancelCountdown = useCallback(() => {
    onCompleteRef.current = null;
    setCountdown(null);
  }, []);

  useEffect(() => {
    if (!countdown) return;

    if (countdown.secondsLeft <= 1) {
      const id = setTimeout(async () => {
        const complete = onCompleteRef.current;
        try {
          await Promise.resolve(complete?.());
        } finally {
          onCompleteRef.current = null;
          setCountdown(null);
        }
      }, 1000);
      return () => clearTimeout(id);
    }

    const id = setTimeout(() => {
      setCountdown((current) =>
        current ? { ...current, secondsLeft: current.secondsLeft - 1 } : current,
      );
    }, 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  return { countdown, startCountdown, cancelCountdown };
}
