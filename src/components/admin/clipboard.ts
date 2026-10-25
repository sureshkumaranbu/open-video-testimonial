/**
 * Copies text, falling back to a hidden text box and execCommand where the
 * Clipboard API is missing (plain-http self-hosted installs aren't a secure
 * context, so navigator.clipboard is undefined there). `within` is where the
 * fallback text box goes: inside an open modal dialog, everything else is
 * inert and can't be selected.
 */
export async function copyText(text: string, within?: HTMLElement | null): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused or no focus; try the fallback.
  }
  if (typeof document === "undefined") return false;
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
  const host = within ?? document.body;
  const active = document.activeElement as HTMLElement | null;
  host.appendChild(box);
  try {
    box.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    box.remove();
    active?.focus?.();
  }
}
