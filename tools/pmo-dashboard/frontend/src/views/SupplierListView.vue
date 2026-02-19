<template>
  <div class="page-container">
    <div class="page-header flex-between">
      <div>
        <h1>Suppliers</h1>
        <p v-if="!loading">{{ suppliers.length }} suppliers registered</p>
      </div>
      <div class="flex-row gap-2">
        <Button
          label="Sync to Sheet"
          icon="pi pi-upload"
          severity="secondary"
          outlined
          size="small"
          :loading="syncing === 'to'"
          @click="handleSyncToSheet"
        />
        <Button
          label="Sync from Sheet"
          icon="pi pi-download"
          severity="secondary"
          outlined
          size="small"
          :loading="syncing === 'from'"
          @click="handleSyncFromSheet"
        />
        <Button
          label="Add Supplier"
          icon="pi pi-plus"
          @click="showCreateDialog = true"
        />
      </div>
    </div>

    <div class="search-bar mb-2">
      <InputText
        v-model="searchQuery"
        placeholder="Search suppliers..."
        class="search-input"
      >
      </InputText>
    </div>

    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
    </div>

    <DataTable
      v-else
      :value="filteredSuppliers"
      :rows="20"
      :paginator="filteredSuppliers.length > 20"
      stripedRows
      sortMode="multiple"
      :rowHover="true"
      @row-click="onRowClick"
      class="supplier-table"
    >
      <template #empty>
        <div class="empty-state">
          <i class="pi pi-building"></i>
          <p>No suppliers found</p>
        </div>
      </template>

      <Column field="company" header="Company" sortable style="min-width: 200px">
        <template #body="{ data }">
          <span class="company-name">{{ data.company }}</span>
        </template>
      </Column>

      <Column field="category" header="Category" sortable style="min-width: 140px">
        <template #body="{ data }">
          <Tag v-if="data.category" :value="data.category" severity="info" />
          <span v-else class="text-muted">--</span>
        </template>
      </Column>

      <Column field="country" header="Country" sortable style="min-width: 120px">
        <template #body="{ data }">
          {{ data.country || '--' }}
        </template>
      </Column>

      <Column header="Projects" style="min-width: 120px">
        <template #body="{ data }">
          <div class="project-codes">
            <Tag
              v-for="code in data.project_codes"
              :key="code"
              :value="code"
              severity="secondary"
              class="project-tag"
            />
            <span v-if="!data.project_codes || data.project_codes.length === 0" class="text-muted">--</span>
          </div>
        </template>
      </Column>

      <Column field="contact_count" header="Contacts" sortable style="width: 100px" />
      <Column field="quote_count" header="Quotes" sortable style="width: 100px" />
      <Column field="catalog_count" header="Catalogs" sortable style="width: 100px" />
    </DataTable>

    <SupplierForm
      :visible="showCreateDialog"
      @update:visible="showCreateDialog = $event"
      @save="onSupplierCreated"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import { getSuppliers, syncToSheet, syncFromSheet } from '../api.js'
import SupplierForm from '../components/SupplierForm.vue'

const router = useRouter()
const suppliers = ref([])
const loading = ref(true)
const searchQuery = ref('')
const showCreateDialog = ref(false)
const syncing = ref(null)

const filteredSuppliers = computed(() => {
  if (!searchQuery.value) return suppliers.value
  const q = searchQuery.value.toLowerCase()
  return suppliers.value.filter(s =>
    s.company.toLowerCase().includes(q) ||
    (s.category && s.category.toLowerCase().includes(q)) ||
    (s.country && s.country.toLowerCase().includes(q))
  )
})

function onRowClick(event) {
  router.push(`/suppliers/${event.data.id}`)
}

async function loadSuppliers() {
  loading.value = true
  try {
    suppliers.value = await getSuppliers()
  } catch (err) {
    console.error('Failed to load suppliers:', err)
  } finally {
    loading.value = false
  }
}

async function onSupplierCreated() {
  showCreateDialog.value = false
  await loadSuppliers()
}

async function handleSyncToSheet() {
  syncing.value = 'to'
  try {
    const result = await syncToSheet()
    console.log('Sync to sheet:', result)
  } catch (err) {
    console.error('Sync to sheet failed:', err)
  } finally {
    syncing.value = null
  }
}

async function handleSyncFromSheet() {
  syncing.value = 'from'
  try {
    const result = await syncFromSheet()
    console.log('Sync from sheet:', result)
    await loadSuppliers()
  } catch (err) {
    console.error('Sync from sheet failed:', err)
  } finally {
    syncing.value = null
  }
}

onMounted(() => {
  loadSuppliers()
})
</script>

<style scoped>
.search-bar {
  max-width: 400px;
}

.search-input {
  width: 100%;
}

.supplier-table {
  cursor: pointer;
}

.company-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.text-muted {
  color: var(--color-text-secondary);
}

.project-codes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.project-tag {
  font-size: 0.75rem;
}
</style>
