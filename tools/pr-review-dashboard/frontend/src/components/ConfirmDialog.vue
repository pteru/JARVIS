<template>
  <Teleport to="body">
    <div v-if="visible" class="confirm-overlay" @click.self="onCancel">
      <div class="confirm-dialog">
        <div class="confirm-header">
          <i :class="iconClass"></i>
          <h3>{{ title }}</h3>
        </div>
        <div class="confirm-body">
          <p>{{ message }}</p>
        </div>
        <div class="confirm-footer">
          <button class="btn btn-secondary" @click="onCancel">Cancel</button>
          <button class="btn btn-danger" @click="onConfirm">{{ confirmLabel }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: 'Confirm Action' },
  message: { type: String, default: 'Are you sure you want to proceed?' },
  confirmLabel: { type: String, default: 'Confirm' },
  severity: { type: String, default: 'danger' },
});

const emit = defineEmits(['confirm', 'cancel']);

const iconClass = computed(() => {
  if (props.severity === 'danger') return 'pi pi-exclamation-triangle icon-danger';
  if (props.severity === 'warning') return 'pi pi-exclamation-circle icon-warning';
  return 'pi pi-info-circle icon-info';
});

function onConfirm() {
  emit('confirm');
}

function onCancel() {
  emit('cancel');
}
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.confirm-dialog {
  background-color: var(--surface-card);
  border: 1px solid #444;
  border-radius: 10px;
  width: 440px;
  max-width: 90vw;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1.25rem 1.5rem 0.75rem;
}

.confirm-header h3 {
  margin: 0;
  font-size: 1.05rem;
}

.confirm-header i {
  font-size: 1.4rem;
}

.icon-danger { color: #ef4444; }
.icon-warning { color: #eab308; }
.icon-info { color: #60a5fa; }

.confirm-body {
  padding: 0 1.5rem 1rem;
}

.confirm-body p {
  margin: 0;
  color: var(--text-color-secondary);
  line-height: 1.5;
}

.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.75rem 1.5rem 1.25rem;
}

.btn {
  padding: 0.5rem 1.25rem;
  border-radius: 6px;
  border: none;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary {
  background-color: var(--surface-overlay);
  color: var(--text-color);
  border: 1px solid #555;
}

.btn-secondary:hover {
  background-color: #3a3a3a;
}

.btn-danger {
  background-color: #ef4444;
  color: white;
}

.btn-danger:hover {
  background-color: #dc2626;
}
</style>
