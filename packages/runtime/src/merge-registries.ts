// ============================================================================
// ZAM Runtime — Registry merge helper (shared)
// Single source for mergeRegistries, previously duplicated in create-agent.ts
// and cli/index.ts (DEBT.md C3, item d).
// ============================================================================

/**
 * Merge two registry arrays, with entries in `primary` taking precedence over
 * entries in `defaults` when they share the same `id` field.
 */
export function mergeRegistries(primary: unknown[], defaults: unknown[]): unknown[] {
  const primaryIds = new Set<string>();
  for (const entry of primary) {
    if (entry && typeof entry === 'object' && 'id' in entry) {
      primaryIds.add((entry as { id: string }).id);
    }
  }

  const merged = [...primary];
  for (const entry of defaults) {
    if (entry && typeof entry === 'object' && 'id' in entry) {
      const id = (entry as { id: string }).id;
      if (!primaryIds.has(id)) {
        merged.push(entry);
      }
    }
  }

  return merged;
}
