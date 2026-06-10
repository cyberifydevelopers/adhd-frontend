/**
 * Floating main-adaptive inspector (spec + live stats, fixed top-right on task screens).
 * Off by default for production. Set `VITE_SHOW_MAIN_ADAPTIVE_DEBUG=true` in `.env.local` for local debugging.
 */
export const SHOW_MAIN_ADAPTIVE_DEBUG_PANEL =
  import.meta.env.VITE_SHOW_MAIN_ADAPTIVE_DEBUG === "true";
