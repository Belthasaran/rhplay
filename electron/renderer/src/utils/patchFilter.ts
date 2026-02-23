/**
 * Shared filter for ExtraPatch-like objects (epuuid, patch_code, name, description).
 * - Patch name: substring match at any filter length.
 * - Description: substring match only when filter has 3+ characters.
 * - Patch code: exact match at any length, OR partial match when filter has 3+ characters.
 */
export function matchesPatchFilter(
  patch: { patch_code?: string; name?: string; description?: string },
  filterText: string
): boolean {
  const q = filterText.trim();
  if (!q) return true;
  const qLower = q.toLowerCase();
  const qLen = qLower.length;
  const name = (patch.name ?? '').toLowerCase();
  const code = (patch.patch_code ?? '').toLowerCase();
  const desc = (patch.description ?? '').toLowerCase();
  if (name.includes(qLower)) return true;
  if (qLen >= 3 && desc.includes(qLower)) return true;
  if (code === qLower) return true;
  if (qLen >= 3 && code.includes(qLower)) return true;
  return false;
}
