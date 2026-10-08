import { useEffect, useState } from "react";

// True when the viewport is narrower than `breakpoint` px. Updates on resize/rotate.
export default function useIsMobile(breakpoint = 900) {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = e => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return isMobile;
}
