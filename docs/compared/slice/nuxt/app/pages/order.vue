<script setup>
const { data } = await useFetch('/api/bag', { key: 'bag' });
useHead({ title: `Your order · ${data.value.shop}` });
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const time = computed(() => data.value.times.find((one) => one.slot === data.value.chosen));
</script>

<template>
  <SliceNotice />
  <h1>Your order</h1>
  <section class="panel">
    <h2>In your bag</h2>
    <template v-if="data.cart.lines.length">
      <ul class="lines">
        <li v-for="line in data.cart.lines" :key="line.item" class="line">
          <div>
            <h3>{{ line.name }}</h3>
            <p class="meta">{{ money(line.cents) }} each · {{ money(line.total) }}</p>
          </div>
          <div class="qty">
            <form method="post" action="/change"><input type="hidden" name="item" :value="line.item" /><button name="qty" :value="line.qty - 1">−</button></form>
            <span>{{ line.qty }}</span>
            <form method="post" action="/change"><input type="hidden" name="item" :value="line.item" /><button name="qty" :value="line.qty + 1">+</button></form>
            <form method="post" action="/change"><input type="hidden" name="item" :value="line.item" /><button name="qty" value="0">Remove</button></form>
          </div>
        </li>
      </ul>
      <p class="total">Total {{ money(data.cart.cents) }}</p>
    </template>
    <p v-else>Your bag is empty.</p>
  </section>
  <section class="panel">
    <h2>Pickup time</h2>
    <form method="post" action="/time">
      <label for="slot">When you’ll come by</label>
      <select id="slot" name="slot">
        <option value="">Choose…</option>
        <option v-for="one in data.times" :key="one.slot" :value="one.slot" :disabled="one.full" :selected="one.slot === data.chosen">{{ one.day }} {{ one.label }}{{ one.full ? ' (full)' : '' }}</option>
      </select>
      <button>Set the time</button>
    </form>
    <p v-if="time">Pickup: {{ time.day }} at {{ time.label }}</p>
  </section>
  <a v-if="data.cart.lines.length && time" class="button" href="/checkout">Check out</a>
</template>
