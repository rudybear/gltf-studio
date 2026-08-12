import { useMemo } from "react";
import { buildAssetUsageIndex, buildUsageIndex, NO_ASSET_USAGE_INDEX, type AssetUsageIndex, type UsageDocJson, type UsageRef } from "@gltf-studio/usage-index";

/**
 * specs/ux-usage-mapping.md UX-1113/UX-1115: the ONE place both the scene
 * tree's and the asset browser's ⚡ reference badges (UX-1116), plus the
 * Inspector's "Used in behavior" section, derive `@gltf-studio/usage-index`
 * from — memoized on `json`'s own identity (editor-core's patches always
 * produce a fresh top-level `json` object on a real edit, never on an
 * unrelated selection change), the same convention `UsageSection.tsx`
 * already established for `buildUsageIndex` alone before this hook existed.
 * Cheap enough (well under a millisecond even at the racer sample's real
 * scale, per `packages/usage-index`'s own racer-scale test) that computing
 * it independently in a few components rather than lifting it into the
 * store is a deliberate simplicity choice, not a perf compromise.
 */
export interface UsageIndexes {
  nodes: Map<number, UsageRef[]>;
  assets: AssetUsageIndex;
}

const EMPTY: UsageIndexes = { nodes: new Map(), assets: NO_ASSET_USAGE_INDEX };

export function useUsageIndexes(json: unknown | undefined): UsageIndexes {
  return useMemo(() => {
    if (!json) return EMPTY;
    const doc = json as UsageDocJson;
    return { nodes: buildUsageIndex(doc), assets: buildAssetUsageIndex(doc) };
  }, [json]);
}
