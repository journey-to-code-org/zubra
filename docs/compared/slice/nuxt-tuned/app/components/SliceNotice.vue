<script setup>
const { data } = useNuxtData('view');
const said = computed(() => data.value?.said ?? {});
</script>

<template>
  <p v-if="said.problem" class="notice problem" role="alert">{{ said.problem }}</p>
  <p v-else-if="said.done" class="notice" role="status">{{ said.done }}</p>
</template>
