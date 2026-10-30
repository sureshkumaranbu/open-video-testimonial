import { MODE_KEY, type ThemeName } from "@/lib/themes";

/**
 * Runs before first paint, as the first child of the page (public pages allow
 * inline scripts; see src/lib/csp.ts). It applies the visitor's stored
 * light/dark choice (or the system's) and a `?theme=` preview to <html>, so
 * there's no flash of the wrong colours, and marks the page `motion-ok` when
 * entrance and in-view motion may run. Without JS or with reduced motion,
 * nothing waits on it: every element is visible in its final state.
 */
export function bootScript(preview: ThemeName | null) {
  return `(function(){var d=document.documentElement;try{${
    preview ? `d.setAttribute("data-theme",${JSON.stringify(preview)});` : ""
  }var m=null;try{m=localStorage.getItem(${JSON.stringify(MODE_KEY)})}catch(e){}var k=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);d.classList.toggle("dark",k);d.style.colorScheme=k?"dark":"light";if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&"IntersectionObserver" in window){document.currentScript.parentElement.classList.add("motion-ok")}}catch(e){}})();`;
}
