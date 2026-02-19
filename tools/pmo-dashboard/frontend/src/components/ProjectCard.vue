<template>
  <router-link :to="`/projects/${project.code}`" class="project-card pmo-card">
    <div class="card-header">
      <span class="project-code">{{ project.code }}</span>
      <span class="product-badge" :class="badgeClass">{{ project.product_line }}</span>
    </div>
    <h3 class="project-name">{{ project.name }}</h3>
    <div v-if="project.phase" class="project-phase">{{ project.phase }}</div>
    <div class="card-stats">
      <div class="stat">
        <i class="pi pi-envelope"></i>
        <span>{{ project.email_count }} emails</span>
      </div>
      <div class="stat">
        <i class="pi pi-folder"></i>
        <span>{{ project.document_count }} docs</span>
      </div>
    </div>
    <div v-if="project.latest_email_date" class="card-footer">
      <i class="pi pi-clock"></i>
      <span>Latest: {{ formatDate(project.latest_email_date) }}</span>
    </div>
  </router-link>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  project: { type: Object, required: true }
})

const badgeClass = computed(() => {
  const line = props.project.product_line
  if (line === 'VisionKing') return 'badge-visionking'
  if (line === 'DieMaster') return 'badge-diemaster'
  return 'badge-spotfusion'
})

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}
</script>

<style scoped>
.project-card {
  display: flex;
  flex-direction: column;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.project-code {
  font-family: monospace;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.product-badge {
  padding: 0.15rem 0.5rem;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
}

.project-name {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
  line-height: 1.3;
}

.project-phase {
  font-size: 0.8rem;
  color: var(--color-accent);
  margin-bottom: 0.75rem;
}

.card-stats {
  display: flex;
  gap: 1rem;
  margin-top: auto;
  padding-top: 0.75rem;
}

.stat {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.stat i {
  font-size: 0.85rem;
}

.card-footer {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border);
}
</style>
