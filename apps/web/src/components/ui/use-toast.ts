"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A message that disappears after a few seconds ("That try won't count", "Entry saved"). */
export function useToast(ms = 2500): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef(0);
  const show = useCallback(
    (next: string) => {
      setMessage(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMessage(null), ms);
    },
    [ms],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [message, show];
}
