// components/shell/sidebar-state.tsx (PUL-422, §14.1)
//
// Shared by the header's toggle and the sidebar: the saved rail/expanded preference (md and
// up) and whether the phone drawer is open (below md). See sidebar-pref.ts for how the first
// paint avoids a hydration mismatch and a layout flash; the short version is that CSS owns the
// width and this state only owns ARIA and tooltips.

'use client';

import { usePathname } from 'next/navigation';
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  SIDEBAR_MD_QUERY,
  SIDEBAR_STORAGE_KEY,
  SIDEBAR_WIDE_QUERY,
  parseSidebarPref,
  type SidebarPref,
} from './sidebar-pref';

// ── The saved preference: a tiny external store over localStorage ──────────────────────────

/** `undefined` until first read. Kept in memory so a blocked localStorage still toggles. */
let prefCache: SidebarPref | null | undefined;
const prefListeners = new Set<() => void>();

function readPref(): SidebarPref | null {
  if (prefCache === undefined) {
    try {
      prefCache = parseSidebarPref(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
    } catch {
      prefCache = null;
    }
  }
  return prefCache;
}

function writePref(next: SidebarPref) {
  prefCache = next;
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next);
  } catch {
    // Storage blocked: the choice still holds for this page's lifetime, from memory.
  }
  // The CSS reads the attribute, so this is what actually moves the width.
  document.documentElement.dataset.sidebar = next;
  for (const listener of prefListeners) listener();
}

function subscribePref(listener: () => void) {
  prefListeners.add(listener);
  return () => prefListeners.delete(listener);
}

/** `null` on the server and during hydration, so the first client render matches the HTML. */
function useSidebarPref(): SidebarPref | null {
  return useSyncExternalStore(subscribePref, readPref, () => null);
}

/** A media query as an external store. `null` on the server and during hydration. */
function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (listener) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}

// ── Context ─────────────────────────────────────────────────────────────────────────────

interface SidebarState {
  /**
   * md and up: whether the sidebar is the icon rail. The saved choice wins; otherwise the
   * 1440px default. `null` until hydrated (the CSS has already drawn the right width).
   */
  collapsed: boolean | null;
  /** Below md: whether the overlay drawer is open. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  /** Below md, `true`; md and up, `false`; `null` until hydrated. */
  narrow: boolean | null;
  /** The header's button: the drawer below md, the rail/expanded preference above. */
  toggle: () => void;
}

const SidebarStateContext = createContext<SidebarState | null>(null);

export function useSidebarState(): SidebarState {
  const state = useContext(SidebarStateContext);
  if (state === null) throw new Error('useSidebarState outside SidebarStateProvider');
  return state;
}

export function SidebarStateProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pref = useSidebarPref();
  const wide = useMediaQuery(SIDEBAR_WIDE_QUERY);
  const md = useMediaQuery(SIDEBAR_MD_QUERY);

  const collapsed = pref !== null ? pref === 'collapsed' : wide === null ? null : !wide;

  /**
   * The drawer's open flag and the path it was opened on. It closes on navigation, and when the
   * viewport grows past md, by adjusting state during render (React's "when a prop changes"
   * pattern) rather than in an effect. Link clicks also close it directly, which covers a click
   * on the page already showing, where the path does not change.
   */
  const [drawer, setDrawer] = useState({ open: false, path: pathname });
  if (drawer.open && (drawer.path !== pathname || md === true)) {
    setDrawer({ open: false, path: pathname });
  }

  function setDrawerOpen(open: boolean) {
    setDrawer({ open, path: pathname });
  }

  function toggle() {
    // Read live, not from `md`: a click only ever happens after hydration, but this cannot
    // be stale by a render either.
    if (!window.matchMedia(SIDEBAR_MD_QUERY).matches) {
      setDrawerOpen(!drawer.open);
      return;
    }
    // Whatever shows now, from the same rule the CSS applies.
    const saved = readPref();
    const railNow =
      saved !== null ? saved === 'collapsed' : !window.matchMedia(SIDEBAR_WIDE_QUERY).matches;
    writePref(railNow ? 'expanded' : 'collapsed');
  }

  return (
    <SidebarStateContext.Provider
      value={{
        collapsed,
        drawerOpen: drawer.open,
        setDrawerOpen,
        narrow: md === null ? null : !md,
        toggle,
      }}
    >
      {children}
    </SidebarStateContext.Provider>
  );
}
