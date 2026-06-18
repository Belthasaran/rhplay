<template>
  <div ref="rootRef" class="launch-method-dropdown" @click.stop>
    <button type="button" class="launch-method-trigger" @click="toggleOpen">
      <span>{{ triggerLabel }}</span>
      <span class="dropdown-arrow">{{ open ? '▲' : '▼' }}</span>
    </button>
    <div v-if="open" class="launch-method-panel">
      <LaunchMethodTiles
        :active-method="activeMethod"
        :usb2snes-enabled="usb2snesEnabled"
        @select="onSelect"
        @edit-usb="onEditUsb"
        @edit-emulator="onEditEmulator"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import LaunchMethodTiles, { type LaunchMethod } from './LaunchMethodTiles.vue';

const props = defineProps<{
  activeMethod: LaunchMethod;
  usb2snesEnabled: string;
}>();

const emit = defineEmits<{
  select: [method: LaunchMethod];
  'edit-usb': [];
  'edit-emulator': [];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const triggerLabel = computed(() => {
  switch (props.activeMethod) {
    case 'program':
      return 'Launch with: Emulator';
    case 'usb2snes':
      return 'Launch with: USB2SNES';
    default:
      return 'Launch with: Manual';
  }
});

function toggleOpen() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function onSelect(method: LaunchMethod) {
  emit('select', method);
  close();
}

function onEditUsb() {
  emit('edit-usb');
  close();
}

function onEditEmulator() {
  emit('edit-emulator');
  close();
}

function onDocumentClick(event: MouseEvent) {
  if (!open.value) return;
  const root = rootRef.value;
  if (root && !root.contains(event.target as Node)) {
    close();
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
});
</script>

<style scoped>
.launch-method-dropdown {
  position: relative;
  display: inline-block;
}

.launch-method-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.launch-method-trigger:hover {
  background: var(--bg-secondary);
}

.dropdown-arrow {
  font-size: 10px;
  opacity: 0.7;
}

.launch-method-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 1000;
  min-width: 320px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.launch-method-panel :deep(.launch-method-tiles) {
  border-bottom: none;
}
</style>
