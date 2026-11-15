/** Compact label; the full model and provider remain in the accessible name. */
export function shortModelName(name: string): string {
  const normalized = name.replace(/[-_]+/g, " ").trim();
  const version = normalized.match(/\b\d+(?:\.\d+)+\b|\b\d+\b/)?.[0];
  const family = normalized.match(/\b(terra|astra|sonnet|opus|haiku|luna|sol|flash|pro|mini|nano)\b/i)?.[0];
  if (version && family) return version + family[0]!.toUpperCase();
  if (version) return version;
  return normalized.length <= 10 ? normalized : normalized.slice(0, 9) + "…";
}
