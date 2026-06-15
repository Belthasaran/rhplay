/** Shared difficulty labels for Prepare Run and Stage Test feedback (0–10). */

export const DIFFICULTY_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type DifficultyValue = typeof DIFFICULTY_VALUES[number];

export function formatStageDifficulty(diff: number | null | undefined): string {
  if (diff === null || diff === undefined) return '';
  const map: Record<number, string> = {
    0: 'Trivial',
    1: 'Newcomer',
    2: 'Casual',
    3: 'Intermediate',
    4: 'Advanced',
    5: 'Xpert',
    6: 'Master',
    7: 'GM',
    8: 'GM+',
    9: 'Tool-Only',
    10: 'Bugged',
  };
  return map[diff] || `Difficulty ${diff}`;
}

export function getDifficultyLabel(diff: number): string {
  const map: Record<number, string> = {
    0: 'Trivial (Too easy)',
    1: 'Newcomer',
    2: 'Casual (Simple Kaizo Tutorial etc)',
    3: 'Intermediate (Beginner kaizo)',
    4: 'Advanced (Int. Kaizo)',
    5: 'Xpert',
    6: 'Master',
    7: 'GM',
    8: 'GM+',
    9: 'Tool-Only',
    10: 'Broken Unwinnable (Needs fix)',
  };
  return map[diff] || `Difficulty ${diff}`;
}
