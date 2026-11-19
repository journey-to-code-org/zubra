<script setup>
const route = useRoute();
const { data, error } = await useFetch(`/api/orders/${route.params.key}`);
if (error.value) throw createError({ statusCode: 404, statusMessage: 'We can’t find that order.', fatal: true });
useHead({ title: `Your order · ${data.value.shop}` });

// The order's status, kept live: the server pushes it, and the steps follow.
const order = data.value.order;
const status = ref(null);
const reached = computed(() => (status.value ? order.steps.findIndex((one) => one.step === status.value) : order.steps.findLastIndex((one) => one.done)));
onMounted(() => {
  const live = new EventSource(`/live/orders/${order.key}`);
  live.onmessage = (event) => (status.value = JSON.parse(event.data));
  onBeforeUnmount(() => live.close());
});
</script>

<template>
  <h1>Order for {{ order.when }}</h1>
  <p>For {{ order.name }} · {{ order.total }}</p>
  <ol class="steps" aria-label="Where your order is">
    <li v-for="(one, i) in order.steps" :key="one.step" :class="{ done: i <= reached }">{{ one.words }}</li>
  </ol>
  <ul class="lines">
    <li v-for="line in order.lines" :key="line.item">{{ line.qty }} × {{ line.name }}</li>
  </ul>
</template>
