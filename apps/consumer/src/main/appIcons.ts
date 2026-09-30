/**
 * Real app icons for the UI: the tracked exe path (looked up here, never taken from the renderer) is handed to
 * Windows for its icon, returned as a data URL. One lookup per app per run; a missing icon is remembered as null
 * so the renderer falls back to the coloured initials.
 */
export interface AppIconDeps {
  pathFor(appName: string): string | null;
  iconFor(path: string): Promise<string | null>;
}

export function createAppIcons(d: AppIconDeps): (appName: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  return (appName) => {
    let hit = cache.get(appName);
    if (!hit) {
      const path = d.pathFor(appName);
      hit = path ? d.iconFor(path).catch(() => null) : Promise.resolve(null);
      cache.set(appName, hit);
    }
    return hit;
  };
}
