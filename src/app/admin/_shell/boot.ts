import { MODE_KEY } from "@/lib/themes";

/** Where the desktop sidebar remembers being collapsed to icons (localStorage). */
export const SIDEBAR_KEY = "plaudit-sidebar";

/**
 * Runs before first paint, as the first thing inside every dashboard page
 * (with the page's CSP nonce; see src/app/admin/layout.tsx). It applies the
 * visitor's light/dark choice (the same `plaudit-mode` the home page uses, or
 * the system's) as the `dark` class on <html>, and the sidebar's collapsed
 * state as data-sidebar, so neither flashes nor shifts the layout.
 */
export const adminBootScript = `(function(){var d=document.documentElement;try{var m=null,s=null;try{m=localStorage.getItem(${JSON.stringify(MODE_KEY)});s=localStorage.getItem(${JSON.stringify(SIDEBAR_KEY)})}catch(e){}var k=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);d.classList.toggle("dark",k);if(s==="collapsed")d.setAttribute("data-sidebar","collapsed");else d.removeAttribute("data-sidebar")}catch(e){}})();`;
