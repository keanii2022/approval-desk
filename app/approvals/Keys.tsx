"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The Human Desk's keyboard shortcuts: B goes back to the village, Esc to the menu.
// They match the key caps shown on the dialogue actions and the header shortcut.
// Never while typing in a field, and never with Ctrl, Meta or Alt held, so nothing
// a person types into a note or an amount can move them off the page.
export default function Keys() {
  const router = useRouter();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        router.push("/village");
      } else if (key === "escape") {
        event.preventDefault();
        router.push("/");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);
  return null;
}
