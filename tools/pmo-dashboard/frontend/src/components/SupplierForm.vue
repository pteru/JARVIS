<template>
  <Dialog
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    :header="supplier ? 'Edit Supplier' : 'Add Supplier'"
    modal
    :style="{ width: '520px' }"
  >
    <div class="form-grid">
      <div class="form-field">
        <label>Company Name *</label>
        <InputText v-model="form.company" class="w-full" placeholder="Company name" />
      </div>

      <div class="form-field">
        <label>Domain</label>
        <InputText v-model="form.domain" class="w-full" placeholder="e.g. company.com" />
      </div>

      <div class="form-field">
        <label>Category</label>
        <Select
          v-model="form.category"
          :options="categoryOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Select category"
          showClear
          class="w-full"
        />
      </div>

      <div class="form-field">
        <label>Country</label>
        <InputText v-model="form.country" class="w-full" placeholder="Country" />
      </div>

      <div class="form-field">
        <label>Website</label>
        <InputText v-model="form.website" class="w-full" placeholder="https://..." />
      </div>

      <div class="form-field">
        <label>Notes</label>
        <Textarea v-model="form.notes" rows="3" class="w-full" placeholder="Additional notes..." />
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="$emit('update:visible', false)" />
      <Button :label="supplier ? 'Update' : 'Create'" @click="handleSave" :disabled="!form.company" />
    </template>
  </Dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { createSupplier, updateSupplier } from '../api.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  supplier: { type: Object, default: null }
})

const emit = defineEmits(['update:visible', 'save'])

const categoryOptions = [
  { label: 'Integrator', value: 'integrator' },
  { label: 'Component Vendor', value: 'component_vendor' },
  { label: 'Subcontractor', value: 'subcontractor' },
  { label: 'Service Provider', value: 'service_provider' }
]

const form = ref({
  company: '',
  domain: '',
  category: null,
  country: '',
  website: '',
  notes: ''
})

watch(() => props.visible, (val) => {
  if (val) {
    if (props.supplier) {
      form.value = {
        company: props.supplier.company || '',
        domain: props.supplier.domain || '',
        category: props.supplier.category || null,
        country: props.supplier.country || '',
        website: props.supplier.website || '',
        notes: props.supplier.notes || ''
      }
    } else {
      form.value = {
        company: '',
        domain: '',
        category: null,
        country: '',
        website: '',
        notes: ''
      }
    }
  }
})

async function handleSave() {
  try {
    if (props.supplier) {
      await updateSupplier(props.supplier.id, form.value)
    } else {
      await createSupplier(form.value)
    }
    emit('save')
  } catch (err) {
    console.error('Failed to save supplier:', err)
  }
}
</script>

<style scoped>
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

.w-full {
  width: 100%;
}
</style>
