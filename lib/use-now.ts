"use client";
import { useSyncExternalStore } from "react";

/** Unix seconds, ticking once a second, shared by every component that asks. */
let current = Math.floor(Date.now() / 1000);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Math.floor(Date.now() / 1000);
    timer = setInterval(() => {
      current = Math.floor(Date.now() / 1000);
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
