// Scroll entrances for the presentation page. Every element stays visible by
// default (CSS never hides it); only groups still below the viewport are held
// at their start state, and each plays once, so a reload, resize or fast
// scroll never hides content that was already read.
const START_STATE: Record<string, Keyframe> = {
  rise: { opacity: 0, transform: "translateY(20px)" },
  slide: { opacity: 0, transform: "translateX(-16px)" },
  lift: { opacity: 0, transform: "translateY(32px)" },
  "from-left": { opacity: 0, transform: "translateX(-24px)" },
  "from-right": { opacity: 0, transform: "translateX(24px)" },
  // Tilted media: start straight and settle into the CSS rotation.
  tilt: { transform: "rotate(0deg)" },
  stack: { opacity: 0, transform: "rotate(0deg) translateY(16px)" },
};

const MAX_DELAY_MS = 240;

export function installReferenceReveals(root: ParentNode = document): () => void {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const animations = new Map<HTMLElement, Animation>();
  const elements = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];

  const finish = (element: HTMLElement) => {
    element.dataset.revealPlayed = "true";
    animations.get(element)?.cancel();
    animations.delete(element);
  };

  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const element = entry.target as HTMLElement;
              observer?.unobserve(element);
              element.dataset.revealPlayed = "true";
              if (
                reduced.matches ||
                document.visibilityState === "hidden" ||
                entry.boundingClientRect.bottom <= 0
              )
                finish(element);
              else animations.get(element)?.play();
            }
          },
          { threshold: 0, rootMargin: "0px 0px 96px 0px" },
        )
      : undefined;

  const stop = () => {
    observer?.disconnect();
    elements.forEach(finish);
  };
  const onPreference = () => {
    if (reduced.matches) stop();
  };
  reduced.addEventListener("change", onPreference);

  for (const element of elements) {
    if (element.dataset.revealPlayed === "true") continue;
    const rect = element.getBoundingClientRect();
    const hiddenByLayout = rect.width === 0 && rect.height === 0;
    if (
      reduced.matches ||
      !observer ||
      !element.animate ||
      hiddenByLayout ||
      rect.top < innerHeight ||
      document.visibilityState === "hidden"
    ) {
      finish(element);
      continue;
    }
    const start = START_STATE[element.dataset.reveal ?? ""] ?? START_STATE.rise;
    const delay = Math.min(Number(element.dataset.revealDelay ?? 0) || 0, MAX_DELAY_MS);
    // A single keyframe ends on the element's own CSS transform, so rotated
    // cards settle into their rotation instead of snapping to it at the end.
    const animation = element.animate([start], {
      duration: 600,
      delay,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "backwards",
    });
    animation.pause();
    animation.onfinish = () => finish(element);
    animations.set(element, animation);
    observer.observe(element);
  }

  return () => {
    stop();
    reduced.removeEventListener("change", onPreference);
  };
}
