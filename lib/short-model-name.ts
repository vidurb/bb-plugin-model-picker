import { modelLabels } from "./model-labels.ts";

/** Compact label; the full model and provider remain in the accessible name. */
export function shortModelName(providerId: string, modelId: string, name: string): string {
  const provider = Object.hasOwn(modelLabels, providerId) ? modelLabels[providerId] : undefined;
  if (provider && Object.hasOwn(provider, modelId)) return provider[modelId]!;
  const normalized = name.replace(/[-_]+/g, " ").trim();
  const version = normalized.match(/\b\d+(?:\.\d+)+\b|\b\d+\b/)?.[0];
  const family = normalized.match(/\b(terra|astra|sonnet|opus|haiku|luna|sol|flash|pro|mini|nano)\b/i)?.[0];
  if (version && family) return version + family[0]!.toUpperCase();
  if (version) return version;
  return normalized.length <= 10 ? normalized : normalized.slice(0, 9) + "…";
}
