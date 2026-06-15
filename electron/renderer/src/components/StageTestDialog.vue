<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-backdrop stage-test-backdrop" @click.self.prevent>
      <div class="modal stage-test-modal">
        <header class="modal-header">
          <h3>🧪 Level Patch Test</h3>
        </header>

        <section class="modal-body">
          <!-- Launching -->
          <div v-if="phase === 'launching'" class="test-progress-content">
            <div class="test-progress-message">{{ progressMessage }}</div>
            <div class="loading-spinner"></div>
          </div>

          <!-- Failed -->
          <div v-else-if="phase === 'failed'" class="test-failed-content">
            <div class="test-error-message">{{ errorMessage }}</div>
          </div>

          <!-- Feedback -->
          <div v-else-if="phase === 'feedback'" class="test-feedback-content">
            <p class="feedback-intro">
              Level {{ launchMeta?.levelHex }} — {{ stage?.levelname }}
            </p>
            <StageFeedbackForm
              ref="feedbackFormRef"
              mode="full"
              :initial-stage="stage"
              :show-comment="false"
            />
          </div>
        </section>

        <footer class="modal-footer">
          <template v-if="phase === 'failed'">
            <button class="btn-primary" :disabled="launching" @click="retryLaunch">Retry</button>
            <button class="btn-secondary" @click="closeDialog">Close</button>
          </template>
          <template v-else-if="phase === 'feedback'">
            <button class="btn-primary" :disabled="saving" @click="submitFeedback">Done</button>
            <button class="btn-secondary" :disabled="saving" @click="closeDialog">Cancel</button>
          </template>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import StageFeedbackForm from '@/components/StageFeedbackForm.vue';
import { runStageTestLaunch, type StageTestLaunchStage } from '@/utils/stage-test-launch';
import {
  mergeTagFeedbackToStagetags,
  normalizeRequisitesForKey,
} from '@/utils/stage-test-utils';
import { showAlert } from '@/utils/dialogs';

export interface StageTestDialogStage extends StageTestLaunchStage {
  stage_uuid?: string;
  gameid: string;
  versions?: string;
  submapid?: string | null;
  translevel_13bf?: string | null;
  tile_x?: string | null;
  tile_y?: string | null;
  tile_value?: string | null;
  playable: number;
  rando: number;
  mainexit: number;
  keyhole: number;
  credits: number;
  water: number;
  ghouse: number;
  spalace: number;
  castle: number;
  boss: number;
  secret: number;
  troll: number;
  final: number;
  lock?: number;
  excluded_patchcodes?: string | null;
  extradescription?: string | null;
  stagetags?: string | null;
  test_status?: string | null;
}

const props = defineProps<{
  isOpen: boolean;
  stage: StageTestDialogStage | null;
  gameId: string;
  gameName?: string;
  gameVersion?: number | null;
  activeLaunchMethod?: 'manual' | 'program' | 'usb2snes';
  canEdit: boolean;
  getPlaylevelPatchCode: (stage: StageTestLaunchStage) => string;
  getRequisiteTags: (stage: StageTestLaunchStage) => string[];
  formatLevelNumberHex: (levelnumber?: string | null) => string;
  calculateTranslevel: (stage: StageTestDialogStage) => string | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  'stage-updated': [stage: StageTestDialogStage];
}>();

type Phase = 'launching' | 'failed' | 'feedback';

const phase = ref<Phase>('launching');
const progressMessage = ref('Preparing test build...');
const errorMessage = ref('');
const launching = ref(false);
const saving = ref(false);

const launchMeta = ref<{
  playlevelPatchCode: string;
  appliedPatchCodes: string[];
  levelHex: string;
} | null>(null);

const feedbackFormRef = ref<InstanceType<typeof StageFeedbackForm> | null>(null);

async function runLaunch() {
  if (!props.stage || launching.value) return;

  launching.value = true;
  phase.value = 'launching';
  progressMessage.value = 'Preparing test build...';
  errorMessage.value = '';

  const result = await runStageTestLaunch(props.stage, {
    gameId: props.gameId,
    gameVersion: props.gameVersion,
    gameName: props.gameName,
    activeLaunchMethod: props.activeLaunchMethod || 'usb2snes',
    getPlaylevelPatchCode: props.getPlaylevelPatchCode,
    getRequisiteTags: props.getRequisiteTags,
    formatLevelNumberHex: props.formatLevelNumberHex,
    onProgress: (msg) => {
      progressMessage.value = msg;
    },
  });

  launching.value = false;

  if (!result.success) {
    phase.value = 'failed';
    errorMessage.value = result.error || 'Unknown error';
    return;
  }

  launchMeta.value = {
    playlevelPatchCode: result.playlevelPatchCode || props.getPlaylevelPatchCode(props.stage),
    appliedPatchCodes: result.appliedPatchCodes || [],
    levelHex: result.levelHex || props.formatLevelNumberHex(props.stage.levelnumber),
  };

  feedbackFormRef.value?.resetFromStage(props.stage);
  phase.value = 'feedback';
}

function retryLaunch() {
  runLaunch();
}

function closeDialog() {
  emit('close');
}

async function submitFeedback() {
  if (!props.stage || saving.value) return;
  saving.value = true;

  const stage = props.stage;
  const meta = launchMeta.value;
  const api = (window as any)?.electronAPI;

  try {
    if (!api?.saveStageFeedback) {
      await showAlert('Save feedback not available', 'Error');
      return;
    }

    const formValue = feedbackFormRef.value?.getValue();
    if (!formValue) return;

    const difficultyVal = formValue.difficulty_feedback;
    const testResult = formValue.test_result;
    const tagFeedback = formValue.tag_feedback;
    const feedbackPayload = {
      gameid: props.gameId,
      levelnumber: stage.levelnumber,
      translevel: props.calculateTranslevel(stage),
      levelname: stage.levelname || null,
      difficulty_feedback: difficultyVal,
      comment: null,
      current_difficulty: stage.difficulty,
      flag_values: null,
      global_conditions: JSON.stringify([]),
      applied_patches: JSON.stringify(meta?.appliedPatchCodes || []),
      playlevel_patchcode: meta?.playlevelPatchCode || props.getPlaylevelPatchCode(stage),
      feedback_source: 'stage_test',
      test_result: testResult,
      tag_feedback: JSON.stringify(tagFeedback),
      stage_uuid: stage.stage_uuid || null,
    };

    const fbResult = await api.saveStageFeedback(feedbackPayload);
    if (!fbResult?.success) {
      await showAlert(`Failed to save feedback: ${fbResult?.error || 'Unknown error'}`, 'Error');
      return;
    }

    if (props.canEdit) {
      stage.difficulty = difficultyVal ?? stage.difficulty;
      stage.water = tagFeedback.water ? 1 : 0;
      stage.castle = tagFeedback.castle ? 1 : 0;
      stage.boss = tagFeedback.boss ? 1 : 0;
      stage.secret = tagFeedback.secret ? 1 : 0;
      stage.troll = tagFeedback.troll ? 1 : 0;
      stage.final = tagFeedback.final ? 1 : 0;
      stage.stagetags = mergeTagFeedbackToStagetags(stage.stagetags, tagFeedback);
      stage.translevel_13bf = props.calculateTranslevel(stage);

      const savePayload: Record<string, unknown> = {
        stage_uuid: stage.stage_uuid || null,
        gameid: stage.gameid,
        version: props.gameVersion,
        gameVersion: props.gameVersion,
        levelnumber: stage.levelnumber,
        levelname: stage.levelname,
        versions: stage.versions || '*',
        submapid: stage.submapid,
        translevel_13bf: stage.translevel_13bf,
        tile_x: stage.tile_x || null,
        tile_y: stage.tile_y || null,
        tile_value: stage.tile_value || null,
        requisites: stage.requisites || null,
        playable: stage.playable,
        rando: stage.rando,
        difficulty: stage.difficulty,
        mainexit: stage.mainexit,
        keyhole: stage.keyhole,
        credits: stage.credits,
        water: stage.water,
        ghouse: stage.ghouse,
        spalace: stage.spalace,
        castle: stage.castle,
        boss: stage.boss,
        secret: stage.secret,
        troll: stage.troll,
        final: stage.final,
        lock: stage.lock || 0,
        playlevel_patch_code: stage.playlevel_patch_code || '2lvno',
        extradescription: stage.extradescription || null,
        stagetags: stage.stagetags || null,
      };

      if (testResult === 'accept' || testResult === 'reject') {
        savePayload.test_status = testResult;
      } else {
        savePayload.test_status = null;
      }

      if (api.saveGameStage) {
        const saveResult = await api.saveGameStage(savePayload);
        if (saveResult?.success) {
          if (saveResult.stage_uuid && !stage.stage_uuid) {
            stage.stage_uuid = saveResult.stage_uuid;
          }
          if (testResult === 'accept' || testResult === 'reject') {
            stage.test_status = testResult;
            stage.test_status_at = Math.floor(Date.now() / 1000);
            stage.test_verified_levelnumber = stage.levelnumber || null;
            stage.test_verified_playlevel_patch_code = stage.playlevel_patch_code || '2lvno';
            stage.test_verified_requisites = normalizeRequisitesForKey(stage.requisites) || null;
          } else {
            stage.test_status = null;
            stage.test_status_at = null;
            stage.test_verified_levelnumber = null;
            stage.test_verified_playlevel_patch_code = null;
            stage.test_verified_requisites = null;
          }
        } else {
          await showAlert(`Feedback saved but stage update failed: ${saveResult?.error || 'Unknown error'}`, 'Warning');
        }
      }

      emit('stage-updated', stage);
      emit('saved');
    }

    emit('close');
  } catch (err: any) {
    await showAlert(`Error saving: ${err?.message || String(err)}`, 'Error');
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.isOpen,
  (open) => {
    if (open && props.stage) {
      launchMeta.value = null;
      runLaunch();
    } else if (!open) {
      phase.value = 'launching';
      progressMessage.value = '';
      errorMessage.value = '';
      launching.value = false;
      saving.value = false;
    }
  }
);
</script>

<style scoped>
.stage-test-backdrop {
  z-index: 26000;
}

.stage-test-modal {
  max-width: 720px;
  width: 92%;
}

.test-progress-content,
.test-failed-content {
  min-height: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
}

.test-progress-message,
.test-error-message {
  text-align: center;
  line-height: 1.4;
}

.test-error-message {
  color: #e74c3c;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent-color, #4a90d9);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.feedback-intro {
  margin: 0 0 16px;
  font-weight: 600;
}

.feedback-section {
  margin-bottom: 20px;
}

.section-label {
  display: block;
  font-weight: 600;
  margin-bottom: 6px;
}

.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-chip {
  border: 1px solid var(--border-color, #555);
  border-radius: 16px;
  padding: 4px 12px;
  background: var(--bg-secondary, #2a2a2a);
  cursor: pointer;
  font-size: 0.9em;
}

.tag-chip.active {
  border-color: var(--accent-color, #4a90d9);
  background: rgba(74, 144, 217, 0.2);
}

.test-result-tiles {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.test-result-tile {
  flex: 1;
  min-width: 100px;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #555);
  border-radius: 6px;
  background: var(--bg-secondary, #2a2a2a);
  cursor: pointer;
  text-align: center;
}

.test-result-tile.active {
  border-color: var(--accent-color, #4a90d9);
  background: rgba(74, 144, 217, 0.2);
}

.test-result-tile.active:has(+ .test-result-tile) {
  /* noop placeholder for future accept/reject colors */
}
</style>
