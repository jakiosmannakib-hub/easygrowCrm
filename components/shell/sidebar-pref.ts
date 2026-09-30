// components/shell/sidebar-pref.ts (PUL-422, §14.1)
//
// The sidebar's saved preference, shared by the server root layout (which inlines the pre-paint
// script below) and the client shell. A plain module on purpose: a value imported from a
// 'use client' file into a server component arrives as a client reference, not a string.
//
// How the first paint stays right with no hydration mismatch and no layout flash:
//
//   1. With nothing saved, the rail/expanded choice is pure CSS. The `rail:` variant in
//      globals.css matches below 1440px unless `<html data-sidebar="expanded">`, so the server
//      HTML is identical for every viewport and the browser picks the width before painting.
//   2. A saved choice lives in localStorage, which the server cannot read. `SIDEBAR_INIT_SCRIPT`
//      runs in <head>, before the body is parsed, and copies it onto `<html data-sidebar>`, so
//      the CSS already knows it at first paint. `<html>` carries `suppressHydrationWarning` for
//      that one attribute (it only reaches one level deep).
//   3. React state never decides the width. It only drives the toggle's `aria-expanded` and
//      whether the rail's tooltips are enabled, and it reads through `useSyncExternalStore`
//      with a `null` server snapshot, so hydration renders exactly what the server sent and
//      the real value arrives in the render after.

export type SidebarPref = 'expanded' | 'collapsed';

/** localStorage key, and the `<html>` attribute (`data-sidebar`) the CSS reads. */
export const SIDEBAR_STORAGE_KEY = 'easygrow.sidebar';

/** Below this width the sidebar defaults to the rail (§14.1, PUL-422). Mirrored in globals.css. */
export const SIDEBAR_WIDE_QUERY = '(min-width: 1440px)';

/** Tailwind's `md`: below it the sidebar is a drawer instead. */
export const SIDEBAR_MD_QUERY = '(min-width: 768px)';

export function parseSidebarPref(raw: string | null): SidebarPref | null {
  return raw === 'expanded' || raw === 'collapsed' ? raw : null;
}

/**
 * Inlined in <head> by the root layout. Wrapped in try/catch because localStorage can throw
 * (private mode, blocked storage); without it the page simply falls back to the CSS default.
 */
export const SIDEBAR_INIT_SCRIPT = `try{var v=localStorage.getItem(${JSON.stringify(
  SIDEBAR_STORAGE_KEY,
)});if(v==='expanded'||v==='collapsed')document.documentElement.dataset.sidebar=v}catch(e){}`;
