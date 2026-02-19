<template>
  <div class="search-wrapper" ref="wrapperRef">
    <span class="p-input-icon-left search-input-wrapper">
      <i class="pi pi-search search-icon"></i>
      <InputText
        v-model="query"
        placeholder="Search projects, emails, suppliers..."
        class="search-input"
        @input="onInput"
        @focus="showResults = results.length > 0"
        @keydown.escape="showResults = false"
      />
    </span>

    <div v-if="showResults && results.length > 0" class="search-results">
      <div
        v-for="(result, idx) in results"
        :key="idx"
        class="search-result-item"
        @click="navigateToResult(result)"
      >
        <i :class="getResultIcon(result.type)"></i>
        <div class="result-info">
          <div class="result-title">{{ result.title }}</div>
          <div class="result-meta">
            <span class="result-type">{{ result.type }}</span>
            <span v-if="result.project_code"> &middot; {{ result.project_code }}</span>
          </div>
          <div v-if="result.snippet" class="result-snippet">{{ result.snippet }}</div>
        </div>
      </div>
    </div>

    <div v-if="showResults && searching" class="search-results">
      <div class="search-loading">
        <i class="pi pi-spin pi-spinner"></i>
        <span>Searching...</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import InputText from 'primevue/inputtext'
import { search } from '../api.js'

const router = useRouter()
const query = ref('')
const results = ref([])
const showResults = ref(false)
const searching = ref(false)
const wrapperRef = ref(null)
let debounceTimer = null

function onInput() {
  clearTimeout(debounceTimer)
  if (!query.value || query.value.length < 2) {
    results.value = []
    showResults.value = false
    return
  }
  debounceTimer = setTimeout(async () => {
    searching.value = true
    try {
      const data = await search({ q: query.value })
      results.value = Array.isArray(data) ? data : (data.results || [])
      showResults.value = results.value.length > 0
    } catch (err) {
      console.error('Search failed:', err)
      results.value = []
    } finally {
      searching.value = false
    }
  }, 300)
}

function getResultIcon(type) {
  const map = {
    project: 'pi pi-briefcase',
    email: 'pi pi-envelope',
    supplier: 'pi pi-building',
    document: 'pi pi-file'
  }
  return map[type] || 'pi pi-search'
}

function navigateToResult(result) {
  showResults.value = false
  query.value = ''
  results.value = []

  if (result.type === 'project') {
    router.push(`/projects/${result.project_code || result.code}`)
  } else if (result.type === 'email') {
    router.push(`/projects/${result.project_code}/emails`)
  } else if (result.type === 'supplier') {
    router.push(`/suppliers/${result.id}`)
  } else if (result.type === 'document') {
    router.push(`/projects/${result.project_code}`)
  }
}

function handleClickOutside(event) {
  if (wrapperRef.value && !wrapperRef.value.contains(event.target)) {
    showResults.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  clearTimeout(debounceTimer)
})
</script>

<style scoped>
.search-wrapper {
  position: relative;
  width: 100%;
}

.search-input-wrapper {
  width: 100%;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  color: var(--color-text-secondary);
  z-index: 1;
  font-size: 0.85rem;
}

.search-input {
  width: 100%;
  padding-left: 2.25rem;
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 0.875rem;
  height: 36px;
}

.search-input:focus {
  border-color: var(--color-accent);
}

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  max-height: 400px;
  overflow-y: auto;
  z-index: 1000;
}

.search-result-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background-color 0.1s ease;
  border-bottom: 1px solid var(--color-border);
}

.search-result-item:last-child {
  border-bottom: none;
}

.search-result-item:hover {
  background-color: var(--color-bg-secondary);
}

.search-result-item > i {
  margin-top: 2px;
  color: var(--color-text-secondary);
}

.result-info {
  flex: 1;
  min-width: 0;
}

.result-title {
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-meta {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: 0.15rem;
}

.result-type {
  text-transform: capitalize;
}

.result-snippet {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-top: 0.2rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}
</style>
