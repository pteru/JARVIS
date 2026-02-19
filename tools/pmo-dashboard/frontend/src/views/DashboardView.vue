<template>
  <div class="page-container">
    <div class="page-header flex-between">
      <div>
        <h1>Projects</h1>
        <p v-if="!loading">{{ projects.length }} projects &middot; {{ totalEmails }} emails indexed</p>
      </div>
    </div>

    <div class="filter-bar">
      <button
        v-for="filter in productFilters"
        :key="filter.value"
        class="filter-chip"
        :class="{ active: activeFilter === filter.value }"
        @click="activeFilter = filter.value"
      >
        <span v-if="filter.badge" class="chip-badge" :class="filter.badge"></span>
        {{ filter.label }}
        <span class="chip-count">{{ getFilterCount(filter.value) }}</span>
      </button>
      <span class="sort-separator"></span>
      <button
        class="filter-chip"
        :class="{ active: sortBy === 'code' }"
        @click="sortBy = 'code'"
      >
        <i class="pi pi-sort-numeric-down" style="font-size: 0.8rem;"></i> By Code
      </button>
      <button
        class="filter-chip"
        :class="{ active: sortBy === 'latest' }"
        @click="sortBy = 'latest'"
      >
        <i class="pi pi-clock" style="font-size: 0.8rem;"></i> Latest Activity
      </button>
    </div>

    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
    </div>

    <div v-else-if="filteredProjects.length === 0" class="empty-state">
      <i class="pi pi-folder-open"></i>
      <p>No projects found</p>
    </div>

    <div v-else class="project-grid">
      <ProjectCard
        v-for="project in filteredProjects"
        :key="project.code"
        :project="project"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getProjects } from '../api.js'
import ProjectCard from '../components/ProjectCard.vue'

const projects = ref([])
const loading = ref(true)
const activeFilter = ref('all')
const sortBy = ref('latest')

const productFilters = [
  { label: 'All', value: 'all', badge: null },
  { label: 'DieMaster', value: 'DieMaster', badge: 'badge-diemaster' },
  { label: 'SpotFusion', value: 'SpotFusion', badge: 'badge-spotfusion' },
  { label: 'VisionKing', value: 'VisionKing', badge: 'badge-visionking' }
]

const totalEmails = computed(() => {
  return projects.value.reduce((sum, p) => sum + (p.email_count || 0), 0)
})

const filteredProjects = computed(() => {
  let result = projects.value
  if (activeFilter.value !== 'all') {
    result = result.filter(p => p.product_line === activeFilter.value)
  }
  if (sortBy.value === 'latest') {
    result = [...result].sort((a, b) => {
      const da = a.latest_email_date || ''
      const db = b.latest_email_date || ''
      if (!da && !db) return 0
      if (!da) return 1
      if (!db) return -1
      return db.localeCompare(da)
    })
  }
  return result
})

function getFilterCount(filterValue) {
  if (filterValue === 'all') return projects.value.length
  return projects.value.filter(p => p.product_line === filterValue).length
}

onMounted(async () => {
  try {
    projects.value = await getProjects()
  } catch (err) {
    console.error('Failed to load projects:', err)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.filter-bar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.filter-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  border-radius: 20px;
  border: 1px solid var(--color-border);
  background-color: var(--color-bg-card);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.15s ease;
}

.filter-chip:hover {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.filter-chip.active {
  background-color: var(--color-accent);
  border-color: var(--color-accent);
  color: #ffffff;
}

.chip-badge {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.chip-badge.badge-diemaster {
  background-color: #f59e0b;
}

.chip-badge.badge-spotfusion {
  background-color: #06b6d4;
}

.chip-badge.badge-visionking {
  background-color: #8b5cf6;
}

.sort-separator {
  width: 1px;
  height: 24px;
  background-color: var(--color-border);
  align-self: center;
  margin: 0 0.25rem;
}

.chip-count {
  font-size: 0.75rem;
  opacity: 0.7;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}
</style>
