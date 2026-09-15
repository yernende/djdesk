<script setup lang="ts">
import { ref } from "vue";
import { locale, t } from "./locale.ts";
import { guide } from "./guide.ts";

const dialog = ref<HTMLDialogElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
function open(): void {
  dialog.value?.showModal();
}
function close(): void {
  dialog.value?.close();
}
</script>

<template>
  <button ref="trigger" class="help-trigger" type="button" @click="open">
    {{ t("How to use") }}
  </button>
  <dialog ref="dialog" class="help-dialog" aria-labelledby="help-title" @close="trigger?.focus()">
    <div class="help-heading">
      <h2 id="help-title">{{ t("How to use") }}</h2>
      <button type="button" autofocus @click="close">{{ t("Close") }}</button>
    </div>
    <section v-for="(section, index) in guide[locale]" :key="index">
      <h3>{{ section.title }}</h3>
      <p>{{ section.body }}</p>
    </section>
  </dialog>
</template>
