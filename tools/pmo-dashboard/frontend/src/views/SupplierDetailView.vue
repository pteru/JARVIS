<template>
  <div class="page-container">
    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
    </div>

    <template v-else-if="supplier">
      <!-- Header -->
      <div class="page-header">
        <div class="flex-row">
          <router-link to="/suppliers" class="back-link">
            <i class="pi pi-arrow-left"></i>
          </router-link>
          <div class="header-info">
            <div class="flex-between">
              <h1>{{ supplier.company }}</h1>
              <div class="flex-row gap-1">
                <Button
                  icon="pi pi-pencil"
                  severity="secondary"
                  outlined
                  size="small"
                  @click="showEditDialog = true"
                />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  @click="handleDeleteSupplier"
                />
              </div>
            </div>
            <div class="supplier-meta">
              <Tag v-if="supplier.category" :value="supplier.category" severity="info" />
              <span v-if="supplier.country"><i class="pi pi-map-marker"></i> {{ supplier.country }}</span>
              <a v-if="supplier.website" :href="supplier.website" target="_blank" rel="noopener">
                <i class="pi pi-external-link"></i> {{ supplier.website }}
              </a>
              <span v-if="supplier.domain" class="domain-tag">
                <i class="pi pi-at"></i> {{ supplier.domain }}
              </span>
            </div>
            <p v-if="supplier.notes" class="supplier-notes">{{ supplier.notes }}</p>
          </div>
        </div>
      </div>

      <!-- Contacts Section -->
      <section class="detail-section">
        <div class="section-header flex-between">
          <h2><i class="pi pi-users"></i> Contacts ({{ supplier.contacts?.length || 0 }})</h2>
          <Button
            label="Add Contact"
            icon="pi pi-plus"
            size="small"
            @click="openContactDialog(null)"
          />
        </div>

        <DataTable :value="supplier.contacts || []" stripedRows size="small">
          <template #empty>
            <div class="empty-state"><p>No contacts yet</p></div>
          </template>
          <Column field="name" header="Name" style="min-width: 150px">
            <template #body="{ data }">
              <span class="contact-name">{{ data.name }}</span>
              <Tag v-if="data.is_primary" value="Primary" severity="success" class="ml-small" />
            </template>
          </Column>
          <Column field="email" header="Email" style="min-width: 200px">
            <template #body="{ data }">
              <a v-if="data.email" :href="`mailto:${data.email}`">{{ data.email }}</a>
              <span v-else class="text-muted">--</span>
            </template>
          </Column>
          <Column field="phone" header="Phone" style="min-width: 140px">
            <template #body="{ data }">{{ data.phone || '--' }}</template>
          </Column>
          <Column field="role" header="Role" style="min-width: 120px">
            <template #body="{ data }">{{ data.role || '--' }}</template>
          </Column>
          <Column header="Actions" style="width: 100px">
            <template #body="{ data }">
              <div class="flex-row gap-1">
                <Button icon="pi pi-pencil" text size="small" @click="openContactDialog(data)" />
                <Button icon="pi pi-trash" text severity="danger" size="small" @click="handleDeleteContact(data.id)" />
              </div>
            </template>
          </Column>
        </DataTable>
      </section>

      <!-- Projects Section -->
      <section class="detail-section">
        <div class="section-header flex-between">
          <h2><i class="pi pi-briefcase"></i> Projects ({{ supplier.projects?.length || 0 }})</h2>
          <Button
            label="Link Project"
            icon="pi pi-plus"
            size="small"
            @click="showProjectDialog = true"
          />
        </div>

        <DataTable :value="supplier.projects || []" stripedRows size="small">
          <template #empty>
            <div class="empty-state"><p>No projects linked</p></div>
          </template>
          <Column field="project_code" header="Project Code" style="min-width: 130px">
            <template #body="{ data }">
              <router-link :to="`/projects/${data.project_code}`">{{ data.project_code }}</router-link>
            </template>
          </Column>
          <Column field="role" header="Role" style="min-width: 200px">
            <template #body="{ data }">{{ data.role || '--' }}</template>
          </Column>
          <Column field="status" header="Status" style="min-width: 120px">
            <template #body="{ data }">
              <Tag :value="data.status || 'active'" :class="`status-${data.status || 'active'}`" />
            </template>
          </Column>
        </DataTable>
      </section>

      <!-- Quotes Section -->
      <section class="detail-section">
        <div class="section-header flex-between">
          <h2><i class="pi pi-dollar"></i> Quotes ({{ supplier.quotes?.length || 0 }})</h2>
        </div>
        <QuoteTable :supplier-id="supplier.id" :initial-quotes="supplier.quotes" @updated="loadSupplier" />
      </section>

      <!-- Catalogs Section -->
      <section class="detail-section">
        <div class="section-header flex-between">
          <h2><i class="pi pi-book"></i> Catalogs ({{ supplier.catalogs?.length || 0 }})</h2>
          <Button
            label="Add Catalog"
            icon="pi pi-plus"
            size="small"
            @click="showCatalogDialog = true"
          />
        </div>

        <div v-if="!supplier.catalogs || supplier.catalogs.length === 0" class="empty-state">
          <p>No catalogs uploaded</p>
        </div>
        <div v-else class="catalog-grid">
          <div v-for="cat in supplier.catalogs" :key="cat.id" class="catalog-item pmo-card">
            <div class="catalog-header">
              <i class="pi pi-file-pdf" style="font-size: 1.25rem;"></i>
              <div class="catalog-info">
                <div class="catalog-title">{{ cat.title }}</div>
                <div v-if="cat.doc_type" class="catalog-type">{{ cat.doc_type }}</div>
              </div>
              <Button icon="pi pi-trash" text severity="danger" size="small" @click="handleDeleteCatalog(cat.id)" />
            </div>
            <p v-if="cat.description" class="catalog-desc">{{ cat.description }}</p>
            <a v-if="cat.file_url" :href="cat.file_url" target="_blank" class="catalog-link">
              <i class="pi pi-external-link"></i> Open
            </a>
            <span v-if="cat.file_path" class="catalog-path">{{ cat.file_path }}</span>
          </div>
        </div>
      </section>

      <!-- Edit Supplier Dialog -->
      <SupplierForm
        :visible="showEditDialog"
        :supplier="supplier"
        @update:visible="showEditDialog = $event"
        @save="onSupplierUpdated"
      />

      <!-- Contact Dialog -->
      <Dialog
        v-model:visible="showContactDialog"
        :header="editingContact ? 'Edit Contact' : 'Add Contact'"
        modal
        :style="{ width: '480px' }"
      >
        <div class="form-grid">
          <div class="form-field">
            <label>Name *</label>
            <InputText v-model="contactForm.name" class="w-full" />
          </div>
          <div class="form-field">
            <label>Email</label>
            <InputText v-model="contactForm.email" class="w-full" />
          </div>
          <div class="form-field">
            <label>Phone</label>
            <InputText v-model="contactForm.phone" class="w-full" />
          </div>
          <div class="form-field">
            <label>Role</label>
            <Select
              v-model="contactForm.role"
              :options="roleOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Select role"
              class="w-full"
            />
          </div>
          <div class="form-field checkbox-field">
            <label>
              <input type="checkbox" v-model="contactForm.is_primary" />
              Primary Contact
            </label>
          </div>
        </div>
        <template #footer>
          <Button label="Cancel" severity="secondary" text @click="showContactDialog = false" />
          <Button :label="editingContact ? 'Update' : 'Add'" @click="saveContact" />
        </template>
      </Dialog>

      <!-- Project Link Dialog -->
      <Dialog
        v-model:visible="showProjectDialog"
        header="Link Project"
        modal
        :style="{ width: '420px' }"
      >
        <div class="form-grid">
          <div class="form-field">
            <label>Project Code *</label>
            <InputText v-model="projectForm.project_code" placeholder="e.g. 01001" class="w-full" />
          </div>
          <div class="form-field">
            <label>Role</label>
            <InputText v-model="projectForm.role" placeholder="e.g. Component supplier" class="w-full" />
          </div>
          <div class="form-field">
            <label>Status</label>
            <Select
              v-model="projectForm.status"
              :options="projectStatusOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Select status"
              class="w-full"
            />
          </div>
        </div>
        <template #footer>
          <Button label="Cancel" severity="secondary" text @click="showProjectDialog = false" />
          <Button label="Link" @click="saveProject" />
        </template>
      </Dialog>

      <!-- Catalog Dialog -->
      <Dialog
        v-model:visible="showCatalogDialog"
        header="Add Catalog"
        modal
        :style="{ width: '480px' }"
      >
        <div class="form-grid">
          <div class="form-field">
            <label>Title *</label>
            <InputText v-model="catalogForm.title" class="w-full" />
          </div>
          <div class="form-field">
            <label>Type</label>
            <Select
              v-model="catalogForm.doc_type"
              :options="catalogTypeOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Select type"
              class="w-full"
            />
          </div>
          <div class="form-field">
            <label>Description</label>
            <Textarea v-model="catalogForm.description" rows="3" class="w-full" />
          </div>
          <div class="form-field">
            <label>File Path</label>
            <InputText v-model="catalogForm.file_path" placeholder="Relative or absolute path" class="w-full" />
          </div>
          <div class="form-field">
            <label>File URL</label>
            <InputText v-model="catalogForm.file_url" placeholder="https://..." class="w-full" />
          </div>
        </div>
        <template #footer>
          <Button label="Cancel" severity="secondary" text @click="showCatalogDialog = false" />
          <Button label="Add" @click="saveCatalog" />
        </template>
      </Dialog>
    </template>

    <div v-else class="empty-state">
      <i class="pi pi-exclamation-circle"></i>
      <p>Supplier not found</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import {
  getSupplier, deleteSupplier as apiDeleteSupplier,
  addContact, updateContact, deleteContact,
  addSupplierProject,
  addCatalog, deleteCatalog
} from '../api.js'
import SupplierForm from '../components/SupplierForm.vue'
import QuoteTable from '../components/QuoteTable.vue'

const props = defineProps({
  id: { type: [String, Number], required: true }
})

const router = useRouter()
const supplier = ref(null)
const loading = ref(true)

// Dialogs
const showEditDialog = ref(false)
const showContactDialog = ref(false)
const showProjectDialog = ref(false)
const showCatalogDialog = ref(false)

// Contact form
const editingContact = ref(null)
const contactForm = ref({ name: '', email: '', phone: '', role: null, is_primary: false })

const roleOptions = [
  { label: 'Sales', value: 'sales' },
  { label: 'Engineering', value: 'engineering' },
  { label: 'Management', value: 'management' },
  { label: 'Logistics', value: 'logistics' }
]

// Project form
const projectForm = ref({ project_code: '', role: '', status: 'active' })
const projectStatusOptions = [
  { label: 'Quoting', value: 'quoting' },
  { label: 'Awarded', value: 'awarded' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Active', value: 'active' },
  { label: 'Completed', value: 'completed' }
]

// Catalog form
const catalogForm = ref({ title: '', doc_type: null, description: '', file_path: '', file_url: '' })
const catalogTypeOptions = [
  { label: 'Catalog', value: 'catalog' },
  { label: 'Datasheet', value: 'datasheet' },
  { label: 'Manual', value: 'manual' },
  { label: 'Certificate', value: 'certificate' },
  { label: 'Drawing', value: 'drawing' }
]

async function loadSupplier() {
  loading.value = true
  try {
    supplier.value = await getSupplier(props.id)
  } catch (err) {
    console.error('Failed to load supplier:', err)
  } finally {
    loading.value = false
  }
}

async function handleDeleteSupplier() {
  if (!confirm(`Delete supplier "${supplier.value.company}"?`)) return
  try {
    await apiDeleteSupplier(props.id)
    router.push('/suppliers')
  } catch (err) {
    console.error('Failed to delete supplier:', err)
  }
}

function onSupplierUpdated() {
  showEditDialog.value = false
  loadSupplier()
}

// Contacts
function openContactDialog(contact) {
  editingContact.value = contact
  if (contact) {
    contactForm.value = { ...contact }
  } else {
    contactForm.value = { name: '', email: '', phone: '', role: null, is_primary: false }
  }
  showContactDialog.value = true
}

async function saveContact() {
  try {
    if (editingContact.value) {
      await updateContact(props.id, editingContact.value.id, contactForm.value)
    } else {
      await addContact(props.id, contactForm.value)
    }
    showContactDialog.value = false
    await loadSupplier()
  } catch (err) {
    console.error('Failed to save contact:', err)
  }
}

async function handleDeleteContact(contactId) {
  if (!confirm('Delete this contact?')) return
  try {
    await deleteContact(props.id, contactId)
    await loadSupplier()
  } catch (err) {
    console.error('Failed to delete contact:', err)
  }
}

// Projects
async function saveProject() {
  try {
    await addSupplierProject(props.id, projectForm.value)
    showProjectDialog.value = false
    projectForm.value = { project_code: '', role: '', status: 'active' }
    await loadSupplier()
  } catch (err) {
    console.error('Failed to link project:', err)
  }
}

// Catalogs
async function saveCatalog() {
  try {
    await addCatalog(props.id, catalogForm.value)
    showCatalogDialog.value = false
    catalogForm.value = { title: '', doc_type: null, description: '', file_path: '', file_url: '' }
    await loadSupplier()
  } catch (err) {
    console.error('Failed to add catalog:', err)
  }
}

async function handleDeleteCatalog(catalogId) {
  if (!confirm('Delete this catalog?')) return
  try {
    await deleteCatalog(props.id, catalogId)
    await loadSupplier()
  } catch (err) {
    console.error('Failed to delete catalog:', err)
  }
}

onMounted(() => {
  loadSupplier()
})
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
  flex-shrink: 0;
}

.back-link:hover {
  background-color: var(--color-bg-card);
  color: var(--color-text-primary);
}

.header-info {
  flex: 1;
}

.supplier-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.domain-tag {
  color: var(--color-text-secondary);
}

.supplier-notes {
  margin-top: 0.75rem;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  padding: 0.75rem;
  background-color: var(--color-bg-secondary);
  border-radius: 6px;
  border: 1px solid var(--color-border);
}

.detail-section {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--color-border);
}

.section-header {
  margin-bottom: 1rem;
}

.section-header h2 {
  font-size: 1.15rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.contact-name {
  font-weight: 500;
}

.ml-small {
  margin-left: 0.4rem;
}

.text-muted {
  color: var(--color-text-secondary);
}

.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 0.75rem;
}

.catalog-item {
  padding: 1rem;
}

.catalog-header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.catalog-info {
  flex: 1;
}

.catalog-title {
  font-weight: 600;
  font-size: 0.95rem;
}

.catalog-type {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-transform: capitalize;
}

.catalog-desc {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-top: 0.5rem;
}

.catalog-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

.catalog-path {
  display: block;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-top: 0.5rem;
  font-family: monospace;
}

/* Form styles */
.form-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-field label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.35rem;
  color: var(--color-text-secondary);
}

.checkbox-field label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.w-full {
  width: 100%;
}
</style>
