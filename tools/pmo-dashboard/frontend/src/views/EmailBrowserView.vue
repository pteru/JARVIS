<template>
  <div class="page-container">
    <div class="page-header">
      <div class="flex-row">
        <router-link :to="`/projects/${code}`" class="back-link">
          <i class="pi pi-arrow-left"></i>
        </router-link>
        <div>
          <h1>Email Browser</h1>
          <p>Project {{ code }}</p>
        </div>
      </div>
    </div>

    <div class="email-layout">
      <aside class="filter-sidebar">
        <h3>Filters</h3>

        <div class="filter-group">
          <label>Category</label>
          <Select
            v-model="filters.category"
            :options="categoryOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="All categories"
            showClear
            class="w-full"
          />
        </div>

        <div class="filter-group">
          <label>Sender</label>
          <InputText
            v-model="filters.search"
            placeholder="Search sender..."
            class="w-full"
          />
        </div>

        <div class="filter-group">
          <label>Date From</label>
          <DatePicker
            v-model="filters.date_from"
            dateFormat="yy-mm-dd"
            placeholder="Start date"
            showIcon
            class="w-full"
          />
        </div>

        <div class="filter-group">
          <label>Date To</label>
          <DatePicker
            v-model="filters.date_to"
            dateFormat="yy-mm-dd"
            placeholder="End date"
            showIcon
            class="w-full"
          />
        </div>

        <Button
          label="Clear Filters"
          severity="secondary"
          outlined
          size="small"
          @click="clearFilters"
          class="w-full mt-2"
        />
      </aside>

      <div class="email-main">
        <EmailTable :project-code="code" :filters="apiFilters" :full-page="true" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import DatePicker from 'primevue/datepicker'
import Button from 'primevue/button'
import EmailTable from '../components/EmailTable.vue'

const props = defineProps({
  code: { type: String, required: true }
})

const filters = ref({
  category: null,
  search: '',
  date_from: null,
  date_to: null
})

const categoryOptions = [
  { label: 'Technical', value: 'technical' },
  { label: 'Status', value: 'status' },
  { label: 'Discussion', value: 'discussion' },
  { label: 'Administrative', value: 'administrative' }
]

const apiFilters = computed(() => {
  const f = {}
  if (filters.value.category) f.category = filters.value.category
  if (filters.value.search) f.search = filters.value.search
  if (filters.value.date_from) {
    const d = filters.value.date_from
    f.date_from = d instanceof Date ? d.toISOString().split('T')[0] : d
  }
  if (filters.value.date_to) {
    const d = filters.value.date_to
    f.date_to = d instanceof Date ? d.toISOString().split('T')[0] : d
  }
  return f
})

function clearFilters() {
  filters.value = {
    category: null,
    search: '',
    date_from: null,
    date_to: null
  }
}
</script>

<style scoped>
.back-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.back-link:hover {
  background-color: var(--color-bg-card);
  color: var(--color-text-primary);
}

.email-layout {
  display: flex;
  gap: 1.5rem;
}

.filter-sidebar {
  width: 260px;
  flex-shrink: 0;
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.25rem;
  height: fit-content;
  position: sticky;
  top: 72px;
}

.filter-sidebar h3 {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--color-text-primary);
}

.filter-group {
  margin-bottom: 1rem;
}

.filter-group label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-bottom: 0.35rem;
}

.w-full {
  width: 100%;
}

.email-main {
  flex: 1;
  min-width: 0;
}
</style>
