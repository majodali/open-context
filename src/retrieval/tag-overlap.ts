/**
 * Tag-overlap scoring for tag-aware retrieval.
 *
 * Tags follow a `namespace:value` convention (e.g., 'domain:auth', 'applies-to:User').
 * Plain unprefixed tags (e.g., 'experimental') are also supported.
 *
 * The overlap score between two tag sets is a normalized count of matched tags.
 * In the future, partial credit for same-namespace different-value matches could
 * be added, but exact matching is sufficient for initial validation.
 */

/**
 * Compute tag overlap between two tag sets.
 * Returns a value in [0, 1]: fraction of query tags found in unit tags.
 *
 * If queryTags is empty, returns 0 (no signal).
 */
export function tagOverlapScore(queryTags: string[], unitTags: string[]): number {
  if (queryTags.length === 0) return 0;

  const unitTagSet = new Set(unitTags);
  let matches = 0;
  for (const qt of queryTags) {
    if (unitTagSet.has(qt)) matches++;
  }
  return matches / queryTags.length;
}

/**
 * Parse a namespaced tag into its parts.
 * Returns { namespace: 'domain', value: 'auth' } for 'domain:auth'.
 * Returns { namespace: null, value: 'experimental' } for 'experimental'.
 */
export function parseTag(tag: string): { namespace: string | null; value: string } {
  const idx = tag.indexOf(':');
  if (idx < 0) return { namespace: null, value: tag };
  return {
    namespace: tag.substring(0, idx),
    value: tag.substring(idx + 1),
  };
}

/**
 * Filter tags by namespace.
 * Returns tags matching the given namespace prefix.
 */
export function tagsByNamespace(tags: string[], namespace: string): string[] {
  const prefix = `${namespace}:`;
  return tags.filter((t) => t.startsWith(prefix));
}

/**
 * Get the values of tags in a given namespace.
 * For tags ['domain:auth', 'domain:api', 'severity:high'] and namespace 'domain',
 * returns ['auth', 'api'].
 */
export function tagValuesInNamespace(tags: string[], namespace: string): string[] {
  const prefix = `${namespace}:`;
  return tags
    .filter((t) => t.startsWith(prefix))
    .map((t) => t.substring(prefix.length));
}

/**
 * Build a namespaced tag string.
 */
export function makeTag(namespace: string, value: string): string {
  return `${namespace}:${value}`;
}
