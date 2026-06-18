<template>
  <div class="launch-method-tiles">
    <div class="launch-method-tile-wrap">
      <button
        type="button"
        class="launch-method-tile"
        :class="{ active: activeMethod === 'usb2snes', disabled: usb2snesEnabled !== 'yes' }"
        :disabled="usb2snesEnabled !== 'yes'"
        @click="emit('select', 'usb2snes')"
      >
        USB2SNES
      </button>
      <button type="button" class="launch-method-edit-link" @click.stop="emit('edit-usb')">Edit</button>
    </div>
    <div class="launch-method-tile-wrap">
      <button
        type="button"
        class="launch-method-tile"
        :class="{ active: activeMethod === 'program' }"
        @click="emit('select', 'program')"
      >
        Emulator / Program
      </button>
      <button type="button" class="launch-method-edit-link" @click.stop="emit('edit-emulator')">Edit</button>
    </div>
    <button
      type="button"
      class="launch-method-tile"
      :class="{ active: activeMethod === 'manual' }"
      @click="emit('select', 'manual')"
    >
      Manual
    </button>
  </div>
</template>

<script setup lang="ts">
export type LaunchMethod = 'manual' | 'program' | 'usb2snes';

defineProps<{
  activeMethod: LaunchMethod;
  usb2snesEnabled: string;
}>();

const emit = defineEmits<{
  select: [method: LaunchMethod];
  'edit-usb': [];
  'edit-emulator': [];
}>();
</script>

<style scoped>
.launch-method-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
  background-color: var(--bg-secondary);
}

.launch-method-tile-wrap {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.launch-method-tile {
  padding: 10px 8px;
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.launch-method-tile.active {
  border-color: #0b57d0;
  background: rgba(11, 87, 208, 0.12);
  box-shadow: inset 0 0 0 1px #0b57d0;
}

.launch-method-tile.disabled,
.launch-method-tile:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.launch-method-edit-link {
  background: none;
  border: none;
  color: var(--link-color, #0b57d0);
  font-size: 20px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  align-self: center;
}
</style>
