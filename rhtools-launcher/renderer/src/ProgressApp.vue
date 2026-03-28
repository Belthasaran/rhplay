<template>
  <div class="progress-root">
    <h1 class="title">{{ titleLine }}</h1>
    <div class="progress-bar-wrap">
      <div class="progress-bar" :style="{ width: progressPercent + '%' }" />
    </div>
    <p class="status-line">{{ statusMessage }}</p>
    <p v-if="filenameLine" class="filename-line">{{ filenameLine }}</p>
    <div ref="logScroll" class="log-scroll">
      <div v-for="(line, idx) in logLines" :key="idx" class="log-line">{{ line }}</div>
    </div>
    <div class="footer-actions">
      <button type="button" class="btn-close" @click="close">Close</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';

const api = window.launcherAPI;

const titleLine = ref('Progress');
const statusMessage = ref('…');
const filenameLine = ref('');
const lastProgress = ref(null);
const logLines = ref([]);
const logScroll = ref(null);

let progressHandler = null;

const progressPercent = computed(() => {
  const p = lastProgress.value;
  if (!p) return 0;
  if (p.percent !== undefined && p.percent !== null) {
    return Math.max(0, Math.min(100, p.percent));
  }
  if (p.total && p.total > 0 && p.current !== undefined) {
    return Math.round((p.current / p.total) * 100);
  }
  return 0;
});

function pushLog(text) {
  if (!text) return;
  logLines.value.push(text);
  if (logLines.value.length > 2000) {
    logLines.value.splice(0, logLines.value.length - 2000);
  }
  nextTick(() => {
    const el = logScroll.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  });
}

function applyPayload(payload) {
  if (payload.title) {
    titleLine.value = payload.title;
  }
  if (payload.message && !payload.kind) {
    statusMessage.value = payload.message;
  }
  if (payload.kind === 'download') {
    if (payload.message) {
      statusMessage.value = payload.message;
      pushLog(payload.message);
    }
    lastProgress.value = {
      percent: payload.percent != null ? payload.percent : lastProgress.value?.percent,
      current: payload.current,
      total: payload.total,
      message: payload.message
    };
    return;
  }

  if (payload.message) {
    statusMessage.value = payload.message;
  }
  if (payload.filename !== undefined) {
    filenameLine.value = payload.filename || '';
  }
  if (payload.percent !== undefined || payload.current !== undefined) {
    lastProgress.value = payload;
  }

  const raw = payload.rawLine || (payload.kind === 'log' ? payload.message : null);
  if (raw) {
    pushLog(raw);
  }
  if (payload.logEntries && payload.logEntries.length) {
    payload.logEntries.forEach((l) => pushLog(l));
  }
}

function close() {
  api.closeProgressWindow?.();
}

onMounted(() => {
  progressHandler = (payload) => applyPayload(payload);
  api.onOperationProgress(progressHandler);
});

onUnmounted(() => {
  if (progressHandler && window.electronAPI?.removeListener) {
    /* optional */
  }
});
</script>

<style scoped>
.progress-root {
  padding: 16px;
  font-family: system-ui, sans-serif;
  background: #1a1d23;
  color: #e8e8e8;
  min-height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.title {
  margin: 0 0 12px;
  font-size: 1.1rem;
  font-weight: 600;
}
.progress-bar-wrap {
  width: 100%;
  height: 18px;
  background: #2a2f38;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
}
.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #3d8bfd, #5cb3ff);
  transition: width 0.15s ease;
}
.status-line {
  margin: 0 0 6px;
  font-weight: 600;
  min-height: 1.2em;
}
.filename-line {
  margin: 0 0 10px;
  font-size: 0.85rem;
  color: #9aa;
  word-break: break-all;
}
.log-scroll {
  flex: 1;
  min-height: 220px;
  max-height: 360px;
  overflow: auto;
  background: #0f1114;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.log-line {
  border-bottom: 1px solid #222;
  padding: 2px 0;
}
.footer-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.btn-close {
  padding: 6px 14px;
  cursor: pointer;
  background: #2a3140;
  color: #e8e8e8;
  border: 1px solid #444;
  border-radius: 4px;
}
.btn-close:hover {
  background: #343d50;
}
</style>
