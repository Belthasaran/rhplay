/** Helpers for stage test status display and snapshot matching. */

export function normalizeRequisitesForKey(requisites?: string | null): string {
  if (!requisites || String(requisites).trim() === '') return '';
  return String(requisites)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

export interface StageTestStatusFields {
  test_status?: string | null;
  test_verified_levelnumber?: string | null;
  test_verified_playlevel_patch_code?: string | null;
  test_verified_requisites?: string | null;
  levelnumber?: string | null;
  playlevel_patch_code?: string | null;
  requisites?: string | null;
}

export function stageTestStatusIsCurrent(stage: StageTestStatusFields): boolean {
  if (!stage.test_status) return false;
  const playlevel = stage.playlevel_patch_code || '2lvno';
  if ((stage.test_verified_levelnumber || null) !== (stage.levelnumber || null)) return false;
  if ((stage.test_verified_playlevel_patch_code || null) !== playlevel) return false;
  if (
    normalizeRequisitesForKey(stage.test_verified_requisites)
    !== normalizeRequisitesForKey(stage.requisites)
  ) {
    return false;
  }
  return true;
}

export type TagFeedbackMap = {
  kaizo: boolean;
  non_kaizo: boolean;
  water: boolean;
  castle: boolean;
  boss: boolean;
  secret: boolean;
  troll: boolean;
  final: boolean;
};

export function parseStagetagsList(stagetags?: string | null): string[] {
  if (!stagetags) return [];
  return stagetags
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function defaultTagFeedbackFromStage(stage: {
  water?: number;
  castle?: number;
  boss?: number;
  secret?: number;
  troll?: number;
  final?: number;
  stagetags?: string | null;
}): TagFeedbackMap {
  const tags = parseStagetagsList(stage.stagetags);
  return {
    kaizo: tags.includes('kaizo'),
    non_kaizo: tags.includes('non-kaizo') || tags.includes('non_kaizo'),
    water: (stage.water ?? 0) === 1,
    castle: (stage.castle ?? 0) === 1,
    boss: (stage.boss ?? 0) === 1,
    secret: (stage.secret ?? 0) === 1,
    troll: (stage.troll ?? 0) === 1,
    final: (stage.final ?? 0) === 1,
  };
}

export function mergeTagFeedbackToStagetags(
  existing: string | null | undefined,
  tagFeedback: TagFeedbackMap
): string | null {
  const base = parseStagetagsList(existing).filter(
    (t) => !['kaizo', 'non-kaizo', 'non_kaizo'].includes(t)
  );
  if (tagFeedback.kaizo) base.push('kaizo');
  if (tagFeedback.non_kaizo) base.push('non-kaizo');
  const unique = [...new Set(base)];
  return unique.length > 0 ? unique.join(',') : null;
}

export const STAGE_TEST_CUTOFF_DATE = '2026-06-13';

export type StageTestStateStatus = 'passed' | 'failed' | 'untested';

export interface StageTestResolutionStage extends StageTestStatusFields {
  gameid: string;
  created_at?: string | null;
  playable?: number;
  difficulty?: number;
}

export interface StageFeedbackRow {
  gameid: string;
  levelnumber: string;
  playlevel_patchcode?: string | null;
  test_result?: string | null;
}

export function defaultPlaylevelPatchCode(code?: string | null): string {
  return code && String(code).trim() ? String(code).trim() : '2lvno';
}

function parseStageCreatedDate(createdAt?: string | null): string | null {
  if (!createdAt) return null;
  const datePart = String(createdAt).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}

export function isCreatedAfterCutoff(stage: { created_at?: string | null }): boolean {
  const created = parseStageCreatedDate(stage.created_at);
  if (!created) return false;
  return created > STAGE_TEST_CUTOFF_DATE;
}

export function isGrandfatherPassed(stage: {
  created_at?: string | null;
  playable?: number;
  difficulty?: number;
}): boolean {
  if (isCreatedAfterCutoff(stage)) return false;
  const diff = stage.difficulty ?? 0;
  return (stage.playable ?? 0) === 1 && diff > 1 && diff < 8;
}

function feedbackMatchesTriplet(
  feedbackRow: StageFeedbackRow | null | undefined,
  stage: StageTestResolutionStage
): boolean {
  if (!feedbackRow) return false;
  const stagePlaylevel = defaultPlaylevelPatchCode(stage.playlevel_patch_code);
  const fbPlaylevel = defaultPlaylevelPatchCode(feedbackRow.playlevel_patchcode);
  return (
    String(feedbackRow.gameid) === String(stage.gameid)
    && String(feedbackRow.levelnumber) === String(stage.levelnumber)
    && fbPlaylevel === stagePlaylevel
  );
}

export function resolveStageTestState(
  stage: StageTestResolutionStage,
  userFeedbackRow?: StageFeedbackRow | null
): { status: StageTestStateStatus; source: string | null } {
  const feedback = feedbackMatchesTriplet(userFeedbackRow, stage) ? userFeedbackRow : null;

  if (feedback?.test_result === 'reject') {
    return { status: 'failed', source: 'user_feedback' };
  }
  if (feedback?.test_result === 'accept') {
    return { status: 'passed', source: 'user_feedback' };
  }

  if (stage.test_status === 'reject' && stageTestStatusIsCurrent(stage)) {
    return { status: 'failed', source: 'gamestages' };
  }
  if (stage.test_status === 'accept' && stageTestStatusIsCurrent(stage)) {
    return { status: 'passed', source: 'gamestages' };
  }

  if (isGrandfatherPassed(stage)) {
    return { status: 'passed', source: 'grandfather' };
  }

  return { status: 'untested', source: null };
}

export function needsFullRunFeedbackForm(
  stage: StageTestResolutionStage,
  userFeedbackRow?: StageFeedbackRow | null
): boolean {
  return resolveStageTestState(stage, userFeedbackRow).status === 'untested';
}
