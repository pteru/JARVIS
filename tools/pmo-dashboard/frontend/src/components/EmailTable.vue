<template>
  <div>
    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem;"></i>
    </div>

    <DataTable
      v-else
      v-model:expandedRows="expandedRows"
      :value="emails"
      :rows="perPage"
      :paginator="totalRecords > perPage"
      :totalRecords="totalRecords"
      :lazy="true"
      @page="onPage"
      stripedRows
      :rowHover="true"
      dataKey="hash"
      size="small"
    >
      <template #empty>
        <div class="empty-state">
          <i class="pi pi-envelope"></i>
          <p>No emails found</p>
        </div>
      </template>

      <Column expander style="width: 3rem" />

      <Column field="date" header="Date" sortable style="min-width: 120px">
        <template #body="{ data }">
          <span class="email-date">{{ formatDate(data.date) }}</span>
        </template>
      </Column>

      <Column field="sender_name" header="From" sortable style="min-width: 180px">
        <template #body="{ data }">
          <span class="email-from">{{ data.sender_name || data.sender_email }}</span>
        </template>
      </Column>

      <Column field="recipients" header="To" style="min-width: 180px">
        <template #body="{ data }">
          <span class="email-to">{{ formatRecipients(data.recipients) }}</span>
        </template>
      </Column>

      <Column field="subject" header="Subject" style="min-width: 300px">
        <template #body="{ data }">
          <span class="email-subject">{{ data.subject }}</span>
        </template>
      </Column>

      <Column field="category" header="Category" style="min-width: 120px">
        <template #body="{ data }">
          <Tag
            v-if="data.category"
            :value="data.category"
            :class="getCategoryClass(data.category)"
          />
          <span v-else class="text-muted">--</span>
        </template>
      </Column>

      <Column header="Attach." style="width: 80px">
        <template #body="{ data }">
          <span v-if="data.attachment_count > 0" class="attachment-count">
            <i class="pi pi-paperclip"></i> {{ data.attachment_count }}
          </span>
          <span v-else class="text-muted">--</span>
        </template>
      </Column>

      <template #expansion="{ data }">
        <div class="email-expansion">
          <div class="email-detail-header">
            <div><strong>From:</strong> {{ data.sender_name }} &lt;{{ data.sender_email }}&gt;</div>
            <div v-if="data.recipients && data.recipients.length"><strong>To:</strong> {{ data.recipients.join(', ').replace(/"/g, '') }}</div>
            <div><strong>Date:</strong> {{ data.date }}</div>
            <div><strong>Subject:</strong> {{ data.subject }}</div>
          </div>
          <div v-if="emailBodies[data.hash]" class="email-body">
            <pre>{{ emailBodies[data.hash] }}</pre>
          </div>
          <div v-else-if="loadingBody === data.hash" class="loading-container">
            <i class="pi pi-spin pi-spinner"></i>
          </div>
          <div v-else class="email-body-placeholder">
            <Button label="Load email body" size="small" text @click="loadEmailBody(data.hash)" />
          </div>
          <div v-if="data.attachments && data.attachments.length > 0" class="email-attachments">
            <strong>Attachments:</strong>
            <div class="attachment-list">
              <span v-for="att in data.attachments" :key="att" class="attachment-item">
                <i class="pi pi-paperclip"></i> {{ att }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </DataTable>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import { getProjectEmails, getEmailDetail } from '../api.js'

const props = defineProps({
  projectCode: { type: String, required: true },
  filters: { type: Object, default: () => ({}) },
  fullPage: { type: Boolean, default: false }
})

const emails = ref([])
const loading = ref(true)
const expandedRows = ref([])
const emailBodies = ref({})
const loadingBody = ref(null)
const page = ref(1)
const perPage = ref(25)
const totalRecords = ref(0)

function getCategoryClass(category) {
  const map = {
    technical: 'badge-technical',
    status: 'badge-status',
    discussion: 'badge-discussion',
    administrative: 'badge-administrative'
  }
  return map[category] || ''
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatRecipients(recipients) {
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) return '--'
  // Join and clean up any quoted name formatting
  const cleaned = recipients.join(', ').replace(/"/g, '')
  return cleaned.length > 60 ? cleaned.substring(0, 57) + '...' : cleaned
}

async function loadEmails() {
  loading.value = true
  try {
    const params = {
      page: page.value,
      per_page: perPage.value,
      ...props.filters
    }
    const data = await getProjectEmails(props.projectCode, params)
    if (Array.isArray(data)) {
      emails.value = data
      totalRecords.value = data.length
    } else {
      emails.value = data.items || data.emails || []
      totalRecords.value = data.total || emails.value.length
    }
  } catch (err) {
    console.error('Failed to load emails:', err)
    emails.value = []
  } finally {
    loading.value = false
  }
}

async function loadEmailBody(hash) {
  loadingBody.value = hash
  try {
    const detail = await getEmailDetail(props.projectCode, hash)
    emailBodies.value[hash] = detail.body || detail.text || '(No body content)'
  } catch (err) {
    console.error('Failed to load email detail:', err)
    emailBodies.value[hash] = '(Failed to load email body)'
  } finally {
    loadingBody.value = null
  }
}

function onPage(event) {
  page.value = event.page + 1
  loadEmails()
}

watch(() => props.filters, () => {
  page.value = 1
  loadEmails()
}, { deep: true })

onMounted(() => {
  loadEmails()
})
</script>

<style scoped>
.text-muted {
  color: var(--color-text-secondary);
}

.email-date {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.email-from {
  font-weight: 500;
}

.email-to {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.email-subject {
  color: var(--color-text-primary);
}

.attachment-count {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

/* Expansion row */
.email-expansion {
  padding: 1rem 1.5rem;
  background-color: var(--color-bg-secondary);
  border-radius: 6px;
  margin: 0.5rem 0;
}

.email-detail-header {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.email-detail-header strong {
  color: var(--color-text-primary);
}

.email-body {
  margin-top: 0.75rem;
}

.email-body pre {
  background-color: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 1rem;
  font-size: 0.85rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 400px;
  overflow-y: auto;
  color: var(--color-text-primary);
}

.email-body-placeholder {
  padding: 0.5rem 0;
}

.email-attachments {
  margin-top: 1rem;
  font-size: 0.85rem;
}

.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.attachment-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.5rem;
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}
</style>
