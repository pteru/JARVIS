<template>
  <div>
    <div class="quote-toolbar mb-1">
      <Button
        label="Add Quote"
        icon="pi pi-plus"
        size="small"
        @click="openQuoteDialog(null)"
      />
    </div>

    <DataTable
      :value="quotes"
      stripedRows
      size="small"
      :rowHover="true"
    >
      <template #empty>
        <div class="empty-state">
          <p>No quotes recorded</p>
        </div>
      </template>

      <Column field="received_at" header="Date" sortable style="min-width: 110px">
        <template #body="{ data }">
          <span class="date-text">{{ data.received_at || '--' }}</span>
        </template>
      </Column>

      <Column field="reference" header="Reference" style="min-width: 130px">
        <template #body="{ data }">{{ data.reference || '--' }}</template>
      </Column>

      <Column field="description" header="Description" style="min-width: 200px" />

      <Column header="Amount" style="min-width: 130px">
        <template #body="{ data }">
          <span v-if="data.amount != null" class="amount-text">
            {{ formatAmount(data.amount) }} {{ data.currency }}
          </span>
          <span v-else class="text-muted">--</span>
        </template>
      </Column>

      <Column field="lead_time_days" header="Lead Time" style="min-width: 100px">
        <template #body="{ data }">
          <span v-if="data.lead_time_days != null">{{ data.lead_time_days }} days</span>
          <span v-else class="text-muted">--</span>
        </template>
      </Column>

      <Column field="valid_until" header="Valid Until" style="min-width: 110px">
        <template #body="{ data }">
          <span :class="{ 'expired-date': isExpired(data.valid_until) }">
            {{ data.valid_until || '--' }}
          </span>
        </template>
      </Column>

      <Column field="status" header="Status" style="min-width: 110px">
        <template #body="{ data }">
          <Tag :value="data.status" :severity="getStatusSeverity(data.status)" />
        </template>
      </Column>

      <Column header="Actions" style="width: 100px">
        <template #body="{ data }">
          <div class="flex-row gap-1">
            <Button icon="pi pi-pencil" text size="small" @click="openQuoteDialog(data)" />
            <Button icon="pi pi-trash" text severity="danger" size="small" @click="handleDelete(data.id)" />
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- Quote Dialog -->
    <Dialog
      v-model:visible="showDialog"
      :header="editingQuote ? 'Edit Quote' : 'Add Quote'"
      modal
      :style="{ width: '560px' }"
    >
      <div class="form-grid">
        <div class="form-field">
          <label>Description *</label>
          <InputText v-model="form.description" class="w-full" />
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>Reference</label>
            <InputText v-model="form.reference" class="w-full" placeholder="Quote / RFQ number" />
          </div>
          <div class="form-field">
            <label>Project Code</label>
            <InputText v-model="form.project_code" class="w-full" placeholder="e.g. 01001" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>Amount</label>
            <InputNumber v-model="form.amount" mode="decimal" :minFractionDigits="2" class="w-full" />
          </div>
          <div class="form-field">
            <label>Currency</label>
            <Select
              v-model="form.currency"
              :options="currencyOptions"
              class="w-full"
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>Lead Time (days)</label>
            <InputNumber v-model="form.lead_time_days" class="w-full" />
          </div>
          <div class="form-field">
            <label>Valid Until</label>
            <DatePicker v-model="form.valid_until" dateFormat="yy-mm-dd" showIcon class="w-full" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>Status</label>
            <Select
              v-model="form.status"
              :options="statusOptions"
              optionLabel="label"
              optionValue="value"
              class="w-full"
            />
          </div>
          <div class="form-field">
            <label>Received Date</label>
            <DatePicker v-model="form.received_at" dateFormat="yy-mm-dd" showIcon class="w-full" />
          </div>
        </div>

        <div class="form-field">
          <label>Notes</label>
          <Textarea v-model="form.notes" rows="2" class="w-full" />
        </div>
      </div>

      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="showDialog = false" />
        <Button :label="editingQuote ? 'Update' : 'Add'" @click="saveQuote" :disabled="!form.description" />
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import { addQuote, updateQuote, deleteQuote } from '../api.js'

const props = defineProps({
  supplierId: { type: [Number, String], required: true },
  initialQuotes: { type: Array, default: () => [] }
})

const emit = defineEmits(['updated'])

const quotes = ref([...props.initialQuotes])
const showDialog = ref(false)
const editingQuote = ref(null)

watch(() => props.initialQuotes, (val) => {
  quotes.value = [...val]
}, { deep: true })

const form = ref({
  description: '',
  reference: '',
  project_code: '',
  amount: null,
  currency: 'USD',
  lead_time_days: null,
  valid_until: null,
  status: 'received',
  received_at: null,
  notes: ''
})

const currencyOptions = ['USD', 'EUR', 'GBP', 'CNY', 'JPY', 'KRW', 'BRL']

const statusOptions = [
  { label: 'Draft', value: 'draft' },
  { label: 'Sent', value: 'sent' },
  { label: 'Received', value: 'received' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Expired', value: 'expired' }
]

function getStatusSeverity(status) {
  const map = {
    draft: 'secondary',
    sent: 'info',
    received: 'info',
    accepted: 'success',
    rejected: 'danger',
    expired: 'warn'
  }
  return map[status] || 'secondary'
}

function formatAmount(amount) {
  if (amount == null) return ''
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

function isExpired(dateStr) {
  if (!dateStr) return false
  return new Date(dateStr) < new Date()
}

function formatDate(d) {
  if (!d) return null
  if (d instanceof Date) return d.toISOString().split('T')[0]
  return d
}

function openQuoteDialog(quote) {
  editingQuote.value = quote
  if (quote) {
    form.value = {
      description: quote.description || '',
      reference: quote.reference || '',
      project_code: quote.project_code || '',
      amount: quote.amount,
      currency: quote.currency || 'USD',
      lead_time_days: quote.lead_time_days,
      valid_until: quote.valid_until ? new Date(quote.valid_until) : null,
      status: quote.status || 'received',
      received_at: quote.received_at ? new Date(quote.received_at) : null,
      notes: quote.notes || ''
    }
  } else {
    form.value = {
      description: '',
      reference: '',
      project_code: '',
      amount: null,
      currency: 'USD',
      lead_time_days: null,
      valid_until: null,
      status: 'received',
      received_at: null,
      notes: ''
    }
  }
  showDialog.value = true
}

async function saveQuote() {
  const payload = {
    ...form.value,
    valid_until: formatDate(form.value.valid_until),
    received_at: formatDate(form.value.received_at)
  }
  try {
    if (editingQuote.value) {
      await updateQuote(props.supplierId, editingQuote.value.id, payload)
    } else {
      await addQuote(props.supplierId, payload)
    }
    showDialog.value = false
    emit('updated')
  } catch (err) {
    console.error('Failed to save quote:', err)
  }
}

async function handleDelete(quoteId) {
  if (!confirm('Delete this quote?')) return
  try {
    await deleteQuote(props.supplierId, quoteId)
    emit('updated')
  } catch (err) {
    console.error('Failed to delete quote:', err)
  }
}
</script>

<style scoped>
.quote-toolbar {
  display: flex;
  justify-content: flex-end;
}

.text-muted {
  color: var(--color-text-secondary);
}

.date-text {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.amount-text {
  font-weight: 600;
  font-family: monospace;
}

.expired-date {
  color: var(--color-danger);
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.form-field label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.35rem;
  color: var(--color-text-secondary);
}

.w-full {
  width: 100%;
}
</style>
