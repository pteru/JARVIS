<template>
  <span class="verdict-badge" :class="badgeClass">{{ displayText }}</span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  verdict: { type: String, default: null },
});

const badgeClass = computed(() => {
  if (!props.verdict) return 'verdict-none';
  const v = props.verdict.toUpperCase();
  if (v === 'APPROVE') return 'verdict-approve';
  if (v === 'APPROVE WITH COMMENTS' || v === 'APPROVE_WITH_COMMENTS')
    return 'verdict-approve-comments';
  if (v === 'CHANGES REQUESTED' || v === 'CHANGES_REQUESTED')
    return 'verdict-changes';
  return 'verdict-none';
});

const displayText = computed(() => {
  if (!props.verdict) return 'No Review';
  return props.verdict.replace(/_/g, ' ');
});
</script>

<style scoped>
.verdict-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  white-space: nowrap;
}

.verdict-approve {
  background-color: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.verdict-approve-comments {
  background-color: rgba(180, 180, 30, 0.15);
  color: #c5b822;
}

.verdict-changes {
  background-color: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.verdict-none {
  background-color: rgba(160, 160, 160, 0.15);
  color: #a0a0a0;
}
</style>
