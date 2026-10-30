"use client";

import { useEffect } from "react";

// After a decision the page comes back with ?result=. The console rail is its own
// scrolling box and keeps its position across that navigation, so the desk keeper's
// answer could point at an "Approved but not paid" section the person can't see.
// Whenever the stamp changes (a result, and the queue it left behind), the rail
// goes back to the top, where that section and the next request begin.
export default function RailScroll({ stamp }: { stamp: string | null }) {
  useEffect(() => {
    if (stamp === null) return;
    document.querySelector<HTMLElement>(".v-rail")?.scrollTo({ top: 0 });
  }, [stamp]);
  return null;
}
