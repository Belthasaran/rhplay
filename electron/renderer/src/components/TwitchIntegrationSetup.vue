<template>
  <div v-if="visible" class="modal-backdrop" @click="handleOverlayClick">
    <div class="twitch-integration-modal" @click.stop>
      <header class="modal-header">
        <h3>Twitch Predictions Configuration</h3>
        <button class="close" @click="handleClose">✕</button>
      </header>
      
      <div class="modal-body">
        <!-- Profile Guard Check -->
        <div v-if="!profileGuardEnabled" class="warning-section">
          <p class="warning-text">
            ⚠️ Profile Guard must be configured before setting up Twitch integration.
            Your Twitch tokens must be encrypted with your profile guard key for security.
          </p>
          <button @click="handleClose" class="btn-primary">Close</button>
        </div>
        
        <!-- Main Setup Content -->
        <div v-else>
          <!-- Twitch Connection Status (Compact) -->
          <div class="connection-status-bar">
            <div class="connection-info">
              <span v-if="integrationStatus" class="status-indicator connected">●</span>
              <span v-else class="status-indicator disconnected">●</span>
              <span class="status-text">
                <span v-if="integrationStatus">
                  Connected as {{ integrationStatus.twitch_username || 'Unknown' }}
                </span>
                <span v-else>
                  Not connected to Twitch
                </span>
              </span>
            </div>
            <div class="connection-actions">
              <button 
                v-if="!integrationStatus"
                @click="startOAuthFlow" 
                class="btn-connect"
                :disabled="oauthInProgress"
              >
                {{ oauthInProgress ? 'Connecting...' : 'Connect to Twitch' }}
              </button>
              <button 
                v-else
                @click="revokeTokens" 
                class="btn-disconnect"
              >
                Disconnect
              </button>
            </div>
          </div>

          <!-- Prediction Templates Configuration (Main Content) -->
          <div class="templates-section">
            <h4>Prediction Templates</h4>
            <p class="section-description">
              Configure how predictions are created during challenge runs. Only one template type can be active at a time.
            </p>

            <!-- Prediction Type Selection -->
            <div class="prediction-type-selector">
              <label class="type-option">
                <input 
                  type="radio" 
                  name="predictionType" 
                  value="whole_challenge"
                  v-model="predictionType"
                  :disabled="!integrationStatus"
                />
                <span class="type-label">Whole Challenge</span>
                <span class="type-description">
                  One prediction for the entire run covering all remaining challenges
                </span>
              </label>
              <label class="type-option">
                <input 
                  type="radio" 
                  name="predictionType" 
                  value="individual_item"
                  v-model="predictionType"
                  :disabled="!integrationStatus"
                />
                <span class="type-label">Individual Item</span>
                <span class="type-description">
                  Separate prediction for each challenge item
                </span>
              </label>
            </div>

            <!-- Whole Challenge Template Configuration -->
            <div v-if="predictionType === 'whole_challenge'" class="template-config">
              <h5>Whole Challenge Settings</h5>
              
              <div class="config-field">
                <label>
                  Number of Outcomes:
                  <select 
                    v-model.number="wholeChallengeOutcomeCount"
                    :disabled="!integrationStatus"
                    class="config-select"
                  >
                    <option :value="2">2 (Less/More than half)</option>
                    <option v-for="n in 8" :key="n + 2" :value="n + 2">{{ n + 2 }}</option>
                  </select>
                </label>
                <p class="field-help">
                  Number of outcomes (2-10). Choose 2 for "Less/More than half challenges won" (ties go to RNG).
                </p>
              </div>

              <div class="config-field">
                <label>
                  Prediction Window (seconds):
                  <input 
                    type="number"
                    v-model.number="wholeChallengeWindowSeconds"
                    min="30"
                    max="3600"
                    step="30"
                    :disabled="!integrationStatus"
                    class="config-input"
                  />
                </label>
                <p class="field-help">
                  How long the prediction stays open (default: 600 seconds = 10 minutes). Minimum 30 seconds. Prediction auto-locks when challenge completes.
                </p>
              </div>

              <div class="config-field">
                <label>
                  Custom Title (optional):
                  <input 
                    type="text"
                    v-model="wholeChallengeCustomTitle"
                    :disabled="!integrationStatus"
                    class="config-input"
                    placeholder="How many total challenge items will we win?"
                  />
                </label>
                <p class="field-help">
                  Optional custom title. Use $username to insert your Twitch username. Default: "How many total challenge items will we win?"
                </p>
              </div>
            </div>

            <!-- Individual Item Template Configuration -->
            <div v-if="predictionType === 'individual_item'" class="template-config">
              <h5>Individual Item Settings</h5>
              
              <div class="config-field">
                <label class="prediction-subtype-label">
                  <input 
                    type="radio" 
                    name="individualPredictionType" 
                    value="yes_no"
                    v-model="individualPredictionType"
                    :disabled="!integrationStatus"
                  />
                  <span class="subtype-label">Yes/No (Success/Fail)</span>
                  <span class="subtype-description">
                    Simple prediction: Will we win this challenge? (Done = Yes, Skip = No)
                  </span>
                </label>
              </div>

              <div class="config-field">
                <label class="prediction-subtype-label">
                  <input 
                    type="radio" 
                    name="individualPredictionType" 
                    value="time_range"
                    v-model="individualPredictionType"
                    :disabled="!integrationStatus"
                  />
                  <span class="subtype-label">Time Range</span>
                  <span class="subtype-description">
                    Predict how many minutes will be spent on this challenge
                  </span>
                </label>
              </div>

              <!-- Common Individual Item Settings -->
              <div class="config-field">
                <label>
                  Delay Before Next Prediction (seconds):
                  <input 
                    type="number"
                    v-model.number="predictionCreationDelaySeconds"
                    min="0"
                    max="300"
                    step="5"
                    :disabled="!integrationStatus"
                    class="config-input"
                  />
                </label>
                <p class="field-help">
                  After resolving a prediction, wait this many seconds before creating the next prediction. If you move to the next challenge before the delay expires, no prediction will be created for that challenge. This gives viewers time to see attempts and check the previous resolution. Default: 30 seconds.
                </p>
              </div>

              <!-- Yes/No Specific Settings -->
              <div v-if="individualPredictionType === 'yes_no'" class="yes-no-config">
                <div class="config-field">
                  <label>
                    Prediction Window (seconds):
                    <input 
                      type="number"
                      v-model.number="yesNoWindowSeconds"
                      min="30"
                      max="300"
                      step="5"
                      :disabled="!integrationStatus"
                      class="config-input"
                    />
                  </label>
                  <p class="field-help">
                    How long the prediction stays open (default: 30 seconds). Prediction is cancelled and refunded if Done/Skip is clicked before window expires.
                  </p>
                </div>

                <div class="config-field">
                  <label>
                    Custom Title (optional):
                    <input 
                      type="text"
                      v-model="yesNoCustomTitle"
                      :disabled="!integrationStatus"
                      class="config-input"
                      placeholder="Will we win at the current challenge item?"
                    />
                  </label>
                  <p class="field-help">
                    Optional custom title. Use $username to insert your Twitch username. Default: "Will we win at the current challenge item?"
                  </p>
                </div>

                <div class="config-field">
                  <label>
                    "Yes" Outcome Name:
                    <input 
                      type="text"
                      v-model="yesOutcomeName"
                      :disabled="!integrationStatus"
                      class="config-input"
                      placeholder="Yes"
                    />
                  </label>
                  <p class="field-help">
                    Name for the success outcome (default: "Yes")
                  </p>
                </div>

                <div class="config-field">
                  <label>
                    "No" Outcome Name:
                    <input 
                      type="text"
                      v-model="noOutcomeName"
                      :disabled="!integrationStatus"
                      class="config-input"
                      placeholder="No"
                    />
                  </label>
                  <p class="field-help">
                    Name for the failure outcome (default: "No")
                  </p>
                </div>

                <div class="config-field">
                  <label>
                    Cancel if success within X seconds of prediction start:
                    <input 
                      type="number"
                      v-model.number="yesNoCancelIfSuccessWithinSeconds"
                      min="0"
                      max="300"
                      step="5"
                      :disabled="!integrationStatus"
                      class="config-input"
                      placeholder=""
                    />
                  </label>
                  <p class="field-help">
                    Cancel prediction if challenge completes within this many seconds after the prediction was created on Twitch. If empty, defaults to prediction window + 10 seconds. This is a failsafe for when predictions are created late.
                  </p>
                </div>
              </div>

              <!-- Time Range Specific Settings -->
              <div v-if="individualPredictionType === 'time_range'" class="time-range-config">
                <div class="config-field">
                  <label>
                    Prediction Window (seconds):
                    <input 
                      type="number"
                      v-model.number="timeRangeWindowSeconds"
                      min="30"
                      max="300"
                      step="5"
                      :disabled="!integrationStatus"
                      class="config-input"
                    />
                  </label>
                  <p class="field-help">
                    How long the prediction stays open (default: 45 seconds). Prediction is cancelled and refunded if Done/Skip is clicked before window expires.
                  </p>
                </div>

                <div class="config-field">
                  <label>
                    Custom Title (optional):
                    <input 
                      type="text"
                      v-model="timeRangeCustomTitle"
                      :disabled="!integrationStatus"
                      class="config-input"
                      placeholder="How many minutes do we spend on the current challenge item?"
                    />
                  </label>
                  <p class="field-help">
                    Optional custom title. Use $username to insert your Twitch username. Default: "How many minutes do we spend on the current challenge item?"
                  </p>
                </div>

                <div class="config-field">
                  <label>
                    Number of Time Outcomes:
                    <select 
                      v-model.number="timeRangeOutcomeCount"
                      :disabled="!integrationStatus"
                      class="config-select"
                    >
                      <option v-for="n in 5" :key="n + 2" :value="n + 2">{{ n + 2 }}</option>
                    </select>
                  </label>
                  <p class="field-help">
                    How many time ranges to offer (3-7). Ranges are automatically calculated based on challenge time limits.
                  </p>
                </div>

                <div class="config-field">
                  <label>
                    Maximum Time (minutes):
                    <input 
                      type="number"
                      v-model.number="timeRangeMaxMinutes"
                      min="5"
                      max="120"
                      :disabled="!integrationStatus"
                      class="config-input"
                    />
                  </label>
                  <p class="field-help">
                    Maximum time range to offer. If win rules are active and "Use template maximum" is unchecked, this will be overridden by the challenge time limit + rollover + grace (rounded up).
                  </p>
                </div>

                <div class="config-field">
                  <label class="checkbox-label">
                    <input 
                      type="checkbox"
                      v-model="timeRangeLowTimeRangesOnlyOnSuccess"
                      :disabled="!integrationStatus"
                      class="config-checkbox"
                    />
                    <span>Low time ranges only eligible on success</span>
                  </label>
                  <p class="field-help">
                    If checked (default), when a challenge fails or is skipped, only outcomes at or above the time limit are eligible. This prevents low time ranges from winning on failures.
                  </p>
                </div>

                <div class="config-field">
                  <label class="checkbox-label">
                    <input 
                      type="checkbox"
                      v-model="timeRangeUseTemplateMax"
                      :disabled="!integrationStatus"
                      class="config-checkbox"
                    />
                    <span>Use template maximum even if win rules allow less</span>
                  </label>
                  <p class="field-help">
                    If checked, always use the template maximum time, even if the challenge's win rule allows less time. If unchecked (default), win rules take priority when they allow more time than the template maximum.
                  </p>
                </div>

                <div class="config-field">
                  <label class="checkbox-label">
                    <input 
                      type="checkbox"
                      v-model="timeRangeExcludePredictionWindow"
                      :disabled="!integrationStatus"
                      class="config-checkbox"
                    />
                    <span>Exclude the prediction time window</span>
                  </label>
                  <p class="field-help">
                    If checked (default), the first time range starts after the prediction window closes. If a challenge completes before the prediction window closes in "current item" mode, the prediction will be cancelled for fairness (since viewers could have seen the outcome before placing bets).
                  </p>
                </div>

                <div class="config-field">
                  <label>
                    Cancel if success within X seconds of prediction start:
                    <input 
                      type="number"
                      v-model.number="timeRangeCancelIfSuccessWithinSeconds"
                      min="0"
                      max="300"
                      step="5"
                      :disabled="!integrationStatus"
                      class="config-input"
                      placeholder=""
                    />
                  </label>
                  <p class="field-help">
                    Cancel prediction if challenge completes within this many seconds after the prediction was created on Twitch. If empty, defaults to prediction window + 10 seconds. This is a failsafe for when predictions are created late.
                  </p>
                </div>
              </div>
            </div>

            <!-- Save and Close Buttons -->
            <div class="template-actions">
              <button 
                @click="saveTemplate"
                class="btn-save"
                :disabled="!integrationStatus || !predictionType"
              >
                Save Configuration
              </button>
              <button 
                @click="handleClose"
                class="btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { showAlert, showConfirm } from '../utils/dialogs';

const props = defineProps<{
  visible: boolean;
  profileGuardEnabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update'): void;
}>();

const oauthInProgress = ref(false);
const integrationStatus = ref<any>(null);

// Prediction template state
const predictionType = ref<string>('whole_challenge'); // 'whole_challenge' | 'individual_item'
const wholeChallengeOutcomeCount = ref<number>(5);
const wholeChallengeWindowSeconds = ref<number>(600); // Default 10 minutes = 600 seconds
const wholeChallengeCustomTitle = ref<string>(''); // Optional custom title
const individualPredictionType = ref<string>('yes_no'); // 'yes_no' | 'time_range'
const predictionCreationDelaySeconds = ref<number>(30); // Default 30 seconds delay before creating next prediction
const yesNoWindowSeconds = ref<number>(30); // Default 30 seconds
const yesNoCustomTitle = ref<string>(''); // Optional custom title
const yesOutcomeName = ref<string>('Yes'); // Default "Yes"
const noOutcomeName = ref<string>('No'); // Default "No"
const yesNoCancelIfSuccessWithinSeconds = ref<number | null>(null); // Null means use default (window + 10)
const timeRangeWindowSeconds = ref<number>(45); // Default 45 seconds
const timeRangeCustomTitle = ref<string>(''); // Optional custom title
const timeRangeOutcomeCount = ref<number>(5);
const timeRangeMaxMinutes = ref<number>(60);
const timeRangeLowTimeRangesOnlyOnSuccess = ref<boolean>(true); // Default true
const timeRangeUseTemplateMax = ref<boolean>(false); // Default false
const timeRangeExcludePredictionWindow = ref<boolean>(true); // Default true
const timeRangeCancelIfSuccessWithinSeconds = ref<number | null>(null); // Null means use default (window + 10)

// Check profile guard requirement
const profileGuardEnabled = computed(() => props.profileGuardEnabled === true);

// Note: Profile UUID is now handled by OnlineProfileManager in the backend
// No need to pass it as a prop or watch it

// Load integration status and template configuration
const loadData = async () => {
  if (!profileGuardEnabled.value) {
    integrationStatus.value = null;
    return;
  }
  
  try {
    // Load integration status (uses OnlineProfileManager internally)
    const status = await (window as any).electronAPI.getTwitchIntegrationStatus();
    integrationStatus.value = status;
    
    // Load prediction template configuration (uses OnlineProfileManager internally)
    const template = await (window as any).electronAPI.getPredictionsTemplate();
    if (template) {
      predictionType.value = template.type || 'whole_challenge';
      if (template.wholeChallenge) {
        wholeChallengeOutcomeCount.value = template.wholeChallenge.outcomeCount || 5;
        wholeChallengeWindowSeconds.value = template.wholeChallenge.predictionWindowSeconds || 600;
        wholeChallengeCustomTitle.value = template.wholeChallenge.customTitle || '';
      }
      if (template.individualItem) {
        individualPredictionType.value = template.individualItem.predictionType || 'yes_no';
        predictionCreationDelaySeconds.value = template.individualItem.predictionCreationDelaySeconds || 30;
        if (template.individualItem.yesNo) {
          yesNoWindowSeconds.value = template.individualItem.yesNo.windowSeconds || 30;
          yesNoCustomTitle.value = template.individualItem.yesNo.customTitle || '';
          yesOutcomeName.value = template.individualItem.yesNo.yesOutcomeName || 'Yes';
          noOutcomeName.value = template.individualItem.yesNo.noOutcomeName || 'No';
          yesNoCancelIfSuccessWithinSeconds.value = template.individualItem.yesNo.cancelIfSuccessWithinSeconds ?? null;
        }
        if (template.individualItem.timeRange) {
          timeRangeWindowSeconds.value = template.individualItem.timeRange.windowSeconds || 45;
          timeRangeCustomTitle.value = template.individualItem.timeRange.customTitle || '';
          timeRangeOutcomeCount.value = template.individualItem.timeRange.outcomeCount || 5;
          timeRangeMaxMinutes.value = template.individualItem.timeRange.maxTimeMinutes || 60;
          timeRangeLowTimeRangesOnlyOnSuccess.value = template.individualItem.timeRange.lowTimeRangesOnlyOnSuccess !== false; // Default true
          timeRangeUseTemplateMax.value = template.individualItem.timeRange.useTemplateMaxEvenIfWinRulesAllowLess || false; // Default false
          timeRangeExcludePredictionWindow.value = template.individualItem.timeRange.excludePredictionWindow !== false; // Default true
          timeRangeCancelIfSuccessWithinSeconds.value = template.individualItem.timeRange.cancelIfSuccessWithinSeconds ?? null;
        }
      }
    }
  } catch (error) {
    console.error('[TwitchIntegrationSetup] Error loading data:', error);
    integrationStatus.value = null;
  }
};

// Start OAuth flow
const startOAuthFlow = async () => {
  // Profile UUID is handled by OnlineProfileManager in the backend
  // No need to check here
  
  oauthInProgress.value = true;
  
  try {
    // Get client ID and redirect URI
    const clientId = await (window as any).electronAPI.getTwitchClientId();
    if (!clientId) {
      await showAlert('Twitch client ID not configured. Please check your build configuration.', 'Configuration Error');
      return;
    }
    
    const redirectUri = 'https://localhost';
    const scopes = 'channel:read:predictions channel:manage:predictions channel:read:vips moderator:read:moderators user:read:chat moderator:read:chat_messages moderator:read:chatters moderator:read:followers moderator:read:shoutouts channel:bot';
    const state = crypto.randomUUID();
    
    const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=token&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`;
    
    // Open OAuth window and handle callback (uses OnlineProfileManager internally)
    const result = await (window as any).electronAPI.openTwitchOAuthWindow({
      url: authUrl,
      redirectUri: redirectUri,
      state: state
    });
    
    if (result && result.success) {
      await loadData();
      emit('update');
    } else {
      await showAlert('Failed to complete OAuth flow. Please try again.', 'OAuth Error');
    }
  } catch (error: any) {
    console.error('[TwitchIntegrationSetup] OAuth error:', error);
    await showAlert(`Failed to complete OAuth flow: ${error.message || 'Unknown error'}`, 'OAuth Error');
  } finally {
    oauthInProgress.value = false;
  }
};

// Revoke tokens
const revokeTokens = async () => {
  const confirmed = await showConfirm(
    'Are you sure you want to disconnect from Twitch? This will delete all stored tokens.',
    'Disconnect from Twitch'
  );
  if (!confirmed) {
    return;
  }
  
  try {
    // Revoke integration (uses OnlineProfileManager internally)
    const result = await (window as any).electronAPI.revokeTwitchIntegration();
    
    if (result && result.success) {
      integrationStatus.value = null;
      emit('update');
    } else {
      // Check if revocation failed but token was valid
      if (result && result.tokenWasValid && result.revokeError) {
        // Token was valid but revocation failed - ask user if they want to disconnect anyway
        const disconnectAnyway = await showConfirm(
          `Token revocation failed: ${result.revokeError}\n\n` +
          `The token may still be valid on Twitch. Do you want to disconnect anyway? ` +
          `(The token will be deleted locally but may remain valid on Twitch's servers)`,
          'Revocation Failed',
          'Disconnect Anyway',
          'Cancel'
        );
        
        if (disconnectAnyway) {
          // User wants to disconnect anyway - force delete from database
          // We'll need to call a force disconnect handler
          const forceResult = await (window as any).electronAPI.revokeTwitchIntegration({ force: true });
          if (forceResult && forceResult.success) {
            integrationStatus.value = null;
            emit('update');
          } else {
            await showAlert(`Failed to disconnect: ${forceResult?.error || 'Unknown error'}`, 'Disconnect Error');
          }
        }
        // If user cancels, do nothing - integration remains
      } else {
        await showAlert(`Failed to disconnect: ${result?.error || 'Unknown error'}`, 'Disconnect Error');
      }
    }
  } catch (error: any) {
    console.error('[TwitchIntegrationSetup] Revoke error:', error);
    await showAlert(`Failed to disconnect: ${error.message || 'Unknown error'}`, 'Disconnect Error');
  }
};

// Save template configuration
const saveTemplate = async () => {
  if (!predictionType.value) {
    return;
  }
  
  try {
    const template: any = {
      type: predictionType.value
    };
    
    if (predictionType.value === 'whole_challenge') {
      template.wholeChallenge = {
        outcomeCount: wholeChallengeOutcomeCount.value,
        predictionWindowSeconds: wholeChallengeWindowSeconds.value,
        customTitle: wholeChallengeCustomTitle.value || undefined
      };
    } else if (predictionType.value === 'individual_item') {
      template.individualItem = {
        predictionType: individualPredictionType.value,
        predictionCreationDelaySeconds: predictionCreationDelaySeconds.value
      };
      
      if (individualPredictionType.value === 'yes_no') {
        template.individualItem.yesNo = {
          windowSeconds: yesNoWindowSeconds.value,
          customTitle: yesNoCustomTitle.value || undefined,
          yesOutcomeName: yesOutcomeName.value,
          noOutcomeName: noOutcomeName.value,
          cancelIfSuccessWithinSeconds: yesNoCancelIfSuccessWithinSeconds.value ?? undefined
        };
      } else if (individualPredictionType.value === 'time_range') {
        template.individualItem.timeRange = {
          windowSeconds: timeRangeWindowSeconds.value,
          customTitle: timeRangeCustomTitle.value || undefined,
          outcomeCount: timeRangeOutcomeCount.value,
          maxTimeMinutes: timeRangeMaxMinutes.value,
          lowTimeRangesOnlyOnSuccess: timeRangeLowTimeRangesOnlyOnSuccess.value,
          useTemplateMaxEvenIfWinRulesAllowLess: timeRangeUseTemplateMax.value,
          excludePredictionWindow: timeRangeExcludePredictionWindow.value,
          cancelIfSuccessWithinSeconds: timeRangeCancelIfSuccessWithinSeconds.value ?? undefined
        };
      }
    }
    
    // Save template using IPC handler (uses OnlineProfileManager internally)
    await (window as any).electronAPI.savePredictionsTemplate({
      template: JSON.stringify(template)
    });
    
    await showAlert('Template configuration saved successfully!', 'Configuration Saved');
    emit('update');
  } catch (error) {
    console.error('[TwitchIntegrationSetup] Save error:', error);
    await showAlert('Failed to save configuration. Please try again.', 'Save Error');
  }
};

// Handle overlay click (close modal)
const handleOverlayClick = () => {
  handleClose();
};

// Handle close
const handleClose = () => {
  emit('close');
};

// Watch for visibility changes
watch(() => props.visible, (newVal) => {
  if (newVal) {
    loadData();
  }
});

onMounted(() => {
  if (props.visible) {
    loadData();
  }
});
</script>

<style scoped>
.twitch-integration-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #2a2a2a;
  border: 2px solid #444;
  border-radius: 8px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  z-index: 30001; /* Above Prepare Run (20000) and Online dropdown (1000), but below alert dialogs (70000) */
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  z-index: 30000; /* Above Prepare Run (20000) and Online dropdown (1000), but below alert dialogs (70000) */
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #444;
  flex-shrink: 0;
}

.modal-header h3 {
  margin: 0;
  color: #fff;
}

.modal-header .close {
  background: none;
  border: none;
  color: #fff;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-header .close:hover {
  background: #444;
  border-radius: 4px;
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.warning-section {
  padding: 16px;
  background: #4a2a00;
  border: 1px solid #ff8800;
  border-radius: 4px;
}

.warning-text {
  color: #ffaa44;
  margin: 0 0 16px 0;
}

/* Connection Status Bar (Compact) */
.connection-status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.connection-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-indicator {
  font-size: 12px;
  line-height: 1;
}

.status-indicator.connected {
  color: #10b981;
}

.status-indicator.disconnected {
  color: #ef4444;
}

.status-text {
  color: #ccc;
  font-size: 14px;
}

.connection-actions {
  display: flex;
  gap: 8px;
}

.btn-connect,
.btn-disconnect {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.btn-connect {
  background: #9146ff;
  color: #fff;
}

.btn-connect:hover:not(:disabled) {
  background: #a855f7;
}

.btn-connect:disabled {
  background: #555;
  cursor: not-allowed;
  opacity: 0.5;
}

.btn-disconnect {
  background: #444;
  color: #fff;
  border: 1px solid #666;
}

.btn-disconnect:hover {
  background: #555;
}

/* Templates Section (Main Content) */
.templates-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.templates-section h4 {
  margin: 0 0 8px 0;
  color: #fff;
  font-size: 18px;
}

.section-description {
  color: #aaa;
  font-size: 13px;
  margin: 0 0 20px 0;
  line-height: 1.5;
}

/* Prediction Type Selection */
.prediction-type-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.type-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: #1a1a1a;
  border: 2px solid #444;
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.type-option:hover:not(:has(input:disabled)) {
  border-color: #666;
}

.type-option:has(input:checked) {
  border-color: #9146ff;
  background: #2a1a3a;
}

.type-option:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.type-option input[type="radio"] {
  margin-top: 2px;
  cursor: pointer;
}

.type-label {
  font-weight: 600;
  color: #fff;
  font-size: 15px;
  display: block;
  margin-bottom: 4px;
}

.type-description {
  color: #aaa;
  font-size: 13px;
  display: block;
}

/* Template Configuration */
.template-config {
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 20px;
  margin-bottom: 20px;
}

.template-config h5 {
  margin: 0 0 16px 0;
  color: #fff;
  font-size: 16px;
}

.config-field {
  margin-bottom: 20px;
}

.config-field:last-child {
  margin-bottom: 0;
}

.config-field label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
}

.config-select,
.config-input {
  padding: 6px 10px;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
}

.config-select:disabled,
.config-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.config-select {
  min-width: 80px;
}

.config-input {
  width: 100px;
}

.field-help {
  color: #aaa;
  font-size: 12px;
  margin: 6px 0 0 0;
  line-height: 1.4;
}

.prediction-subtype-label {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px;
  background: #2a2a2a;
  border: 2px solid #444;
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.prediction-subtype-label:hover:not(:has(input:disabled)) {
  border-color: #666;
}

.prediction-subtype-label:has(input:checked) {
  border-color: #9146ff;
  background: #2a1a3a;
}

.prediction-subtype-label:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.prediction-subtype-label input[type="radio"] {
  margin: 0;
}

.subtype-label {
  font-weight: 600;
  color: #fff;
  font-size: 14px;
}

.subtype-description {
  color: #aaa;
  font-size: 13px;
}

.time-range-config {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #444;
}

.template-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #444;
}

.btn-save {
  padding: 10px 24px;
  background: #9146ff;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.btn-save:hover:not(:disabled) {
  background: #a855f7;
}

.btn-save:disabled {
  background: #555;
  cursor: not-allowed;
  opacity: 0.5;
}

.btn-primary {
  padding: 8px 16px;
  background: #9146ff;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary:hover {
  background: #a855f7;
}

.btn-secondary {
  padding: 10px 24px;
  background: #444;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #555;
}
</style>
