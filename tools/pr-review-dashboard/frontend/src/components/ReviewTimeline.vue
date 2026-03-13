<template>
  <div class="review-timeline">
    <div
      v-for="v in versions"
      :key="v.version"
      class="timeline-item"
      :class="{ active: v.version === currentVersion }"
      @click="$emit('select', v.version)"
    >
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-header">
          <span class="version-label">v{{ v.version }}</span>
          <VerdictBadge v-if="v.verdict" :verdict="v.verdict" />
        </div>
        <div class="timeline-meta">
          <span>{{ formatDate(v.reviewed_at) }}</span>
          <span v-if="v.head_sha" class="sha">{{ v.head_sha.slice(0, 7) }}</span>
        </div>
      </div>
    </div>
    <div v-if="!versions.length" class="no-versions">
      No version history available.
    </div>
  </div>
</template>

<script setup>
import VerdictBadge from './VerdictBadge.vue';

defineProps({
  versions: { type: Array, default: () => [] },
  currentVersion: { type: Number, default: 1 },
});

defineEmits(['select']);

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}
</script>

<style scoped>
.review-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.timeline-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.15s;
  position: relative;
}

.timeline-item:hover {
  background-color: var(--surface-overlay);
}

.timeline-item.active {
  background-color: var(--surface-overlay);
}

.timeline-item.active .timeline-dot {
  background-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.25);
}

.timeline-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #555;
  margin-top: 0.35rem;
  flex-shrink: 0;
}

/* vertical connector line */
.timeline-item:not(:last-child)::after {
  content: '';
  position: absolute;
  left: calc(0.75rem + 4px);
  top: calc(0.625rem + 14px);
  width: 2px;
  bottom: -1px;
  background-color: #333;
}

.timeline-content {
  flex: 1;
  min-width: 0;
}

.timeline-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.version-label {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--text-color);
}

.timeline-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

.sha {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  background-color: var(--surface-ground);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
}

.no-versions {
  color: var(--text-color-secondary);
  font-size: 0.85rem;
  padding: 0.5rem;
}
</style>
