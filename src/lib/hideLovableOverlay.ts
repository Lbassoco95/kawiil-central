/**
 * Oculta el FAB/badge "Edit with Lovable" que el preview de Lovable inyecta en el DOM.
 * No afecta correos HTML (van en iframes con documento propio).
 */
export function initHideLovableOverlay(): void {
  if (typeof document === "undefined") return;

  const hide = (): void => {
    const candidates = document.querySelectorAll<HTMLElement>(
      "a[href*='lovable.dev'], a[href*='lovable.app'], button[aria-label*='Lovable'], button[aria-label*='lovable'], [data-lovable-badge], [class*='lovable-badge'], [class*='Lovable-badge']",
    );

    candidates.forEach((el) => {
      const href = el.getAttribute("href") || "";
      const text = (el.textContent || "").toLowerCase();
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const isLovableChrome =
        href.includes("lovable.dev") ||
        href.includes("lovable.app") ||
        text.includes("edit with") ||
        text.includes("lovable") ||
        label.includes("lovable") ||
        el.hasAttribute("data-lovable-badge");

      if (!isLovableChrome) return;

      el.style.setProperty("display", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
      el.setAttribute("aria-hidden", "true");

      let parent: HTMLElement | null = el.parentElement;
      for (let depth = 0; depth < 10 && parent && parent !== document.body; depth++) {
        const cs = window.getComputedStyle(parent);
        const onlyOverlay =
          parent.childElementCount <= 4 &&
          (cs.position === "fixed" || parent.getAttribute("data-lovable") != null);
        if (onlyOverlay && (parent.textContent || "").length < 80) {
          parent.style.setProperty("display", "none", "important");
          break;
        }
        parent = parent.parentElement;
      }
    });
  };

  hide();
  const mo = new MutationObserver(() => {
    requestAnimationFrame(hide);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}
