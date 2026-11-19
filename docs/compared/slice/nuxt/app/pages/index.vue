<script setup>
const { data } = await useFetch('/api/menu');
useHead({ title: `Menu · ${data.value.shop}` });
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const words = (left) => (left == null ? '' : left > 0 ? `${left} left` : 'Sold out');

// What's left, kept live: the server pushes it, and each row follows.
const left = ref(Object.fromEntries(data.value.sections.flatMap(({ items }) => items.map((item) => [item.key, item.left]))));
const out = (key) => left.value[key] != null && left.value[key] <= 0;
onMounted(() => {
  const live = new EventSource('/live');
  live.onmessage = (event) => (left.value = Object.fromEntries(JSON.parse(event.data)));
  onBeforeUnmount(() => live.close());
});
</script>

<template>
  <SliceNotice />
  <h1>Order ahead</h1>
  <section v-for="{ section, items } in data.sections" :key="section">
    <h2>{{ section }}</h2>
    <ul class="items">
      <li v-for="item in items" :key="item.key" :class="['item', { out: out(item.key) }]">
        <h3>{{ item.name }}</h3>
        <p class="meta">
          {{ money(item.cents) }} · {{ item.unit }}<template v-if="words(left[item.key])"> · <span class="left">{{ words(left[item.key]) }}</span></template>
        </p>
        <form method="post" action="/add">
          <input type="hidden" name="item" :value="item.key" />
          <input type="number" name="qty" value="1" min="1" max="24" :aria-label="`How many ${item.name}`" :disabled="out(item.key)" />
          <button type="submit" :disabled="out(item.key)">Add</button>
        </form>
      </li>
    </ul>
  </section>
</template>
