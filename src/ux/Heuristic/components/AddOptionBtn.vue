<template>
  <div>
    <v-dialog
      :model-value="dialog"
      width="500"
      persistent
      @update:model-value="$emit('update:dialog', $event)"
    >
      <v-card class="dataCard">
        <p class="subtitleView ma-3 pt-3 mb-0 pa-2">
          {{ $t('HeuristicsTable.titles.addOption') }}
        </p>
        <v-divider />
        <v-row justify="center" class="ma-0">
          <v-col cols="11">
            <v-form ref="form">
              <v-row justify="center" align="center">
                <v-col cols="6">
                  <v-text-field
                    v-model="localOption.text"
                    maxlength="100"
                    counter="100"
                    :label="$t('common.text')"
                    variant="outlined"
                    :rules="textRequired"
                  />
                </v-col>

                <v-col cols="6">
                  <v-text-field
                    v-model.number="localOption.value"
                    :label="$t('common.value')"
<<<<<<< HEAD
                    :disabled="!localHasValue || localWarning"
=======
                    :disabled="!localHasValue"
>>>>>>> upstream/develop
                    type="number"
                    placeholder="Ex. 0.5"
                    :rules="valueRequired"
                    variant="outlined"
                    step="0.5"
                  />
                </v-col>
              </v-row>

              <v-row justify="center" align="center">
                <v-col cols="12">
                  <v-text-field
                    v-model="localOption.description"
                    variant="outlined"
                    maxlength="250"
                    counter="250"
                    :label="
                      $t('HeuristicsTable.placeholders.optionDescription')
                    "
                    :error="
                      localOption.description &&
                      localOption.description.length >= 250
                    "
                    :error-messages="
                      localOption.description &&
                      localOption.description.length >= 250
                        ? ['Maximum 250 characters reached']
                        : []
                    "
                  />
                </v-col>
              </v-row>

              <v-row justify="center">
<<<<<<< HEAD
                <v-col cols="12" class="d-flex align-center">
                  <v-checkbox
                    v-model="localHasValue"
                    :label="$t('HeuristicsTable.titles.hasValue')"
                    hide-details
                    class="me-15"
                  />
                  <v-checkbox
                    v-model="localWarning"
                    label="warning"
                    hide-details
                  />
                </v-col>
=======
                <v-checkbox
                  v-model="localHasValue"
                  :label="$t('HeuristicsTable.titles.hasValue')"
                />
>>>>>>> upstream/develop
              </v-row>
            </v-form>
          </v-col>
        </v-row>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            color="red-lighten-1"
            @click="cancel"
          >
            {{ $t('HeuristicsTable.titles.cancel') }}
          </v-btn>

          <v-btn size="small" class="text-white bg-orange" @click="validate">
            {{ $t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
<<<<<<< HEAD
=======
import { useStore } from 'vuex'
>>>>>>> upstream/develop
import { useI18n } from 'vue-i18n'

const props = defineProps({
  option: { type: Object, required: true },
  dialog: { type: Boolean, default: false },
  hasValue: { type: Boolean, required: true, default: true },
<<<<<<< HEAD
  warning: { type: Boolean, required: true, default: false },
=======
>>>>>>> upstream/develop
})

const emit = defineEmits([
  'update:dialog',
<<<<<<< HEAD
  'changeOptionFlags',
=======
  'changeHasValue',
>>>>>>> upstream/develop
  'addOption',
  'change',
])

const { t } = useI18n()
<<<<<<< HEAD
=======
const store = useStore()
>>>>>>> upstream/develop
const form = ref(null)

const textRequired = [
  (v) => !!v || t('HeuristicsTable.validation.textRequired'),
]
const localOption = ref({ text: '', value: null, description: '' })
const localHasValue = ref(true)
<<<<<<< HEAD
const localWarning = ref(false)

const valueRequired = computed(() => {
  if (!localHasValue.value || localWarning.value) return []
=======

const valueRequired = computed(() => {
  if (!localHasValue.value) return []
>>>>>>> upstream/develop
  return [
    (v) =>
      (v !== null && v !== '' && v >= 0) ||
      t('HeuristicsTable.validation.textRequired'),
  ]
})

watch(
  () => props.option,
  (newOption) => {
    localOption.value = { ...newOption }
  },
  { deep: true, immediate: true },
)

watch(
  () => props.hasValue,
  (newValue) => {
    localHasValue.value = newValue
  },
  { immediate: true },
)

<<<<<<< HEAD
watch(
  () => props.warning,
  (newValue) => {
    localWarning.value = newValue
  },
  { immediate: true },
)

const emitOptionFlags = () => {
  emit('changeOptionFlags', {
    hasValue: localHasValue.value,
    warning: localWarning.value,
  })
}

watch(localHasValue, (newValue) => {
  if (!newValue) localOption.value.value = null
  emitOptionFlags()
})

watch(localWarning, () => {
  if (localWarning.value) localOption.value.value = null
  emitOptionFlags()
=======
watch(localHasValue, (newValue) => {
  if (!newValue) localOption.value.value = null
  emit('changeHasValue', newValue)
>>>>>>> upstream/develop
})

const validate = async () => {
  const { valid } = await form.value.validate()
  if (valid) {
    const optionToSave = { ...localOption.value }
<<<<<<< HEAD
    if (!localHasValue.value || localWarning.value) optionToSave.value = null
    optionToSave.hasValue = localHasValue.value
    optionToSave.warning = localWarning.value
=======
    if (!localHasValue.value) optionToSave.value = null
>>>>>>> upstream/develop
    emit('addOption', optionToSave)
    emit('change')
    emit('update:dialog', false)
    resetVal()
  }
}

const cancel = () => {
  emit('update:dialog', false)
  resetVal()
}

const resetVal = () => {
  localOption.value = { text: '', value: null, description: '' }
  localHasValue.value = true
<<<<<<< HEAD
  localWarning.value = false
=======
>>>>>>> upstream/develop
  form.value.resetValidation()
}
</script>

<style scoped>
.disabledBtn {
  color: rgba(134, 125, 125, 0.438) !important;
}
.disabledBtnBackground {
  background-color: rgba(185, 185, 185, 0.308);
}
.subtitleView {
  font-style: normal;
  font-weight: 200;
  font-size: 18.1818px;
  align-items: flex-end;
  color: #000000;
  margin-bottom: 4px;
  padding-bottom: 2px;
}

.dataCard {
  background: #f5f7ff;
  box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);
  border-radius: 4px;
}
</style>
