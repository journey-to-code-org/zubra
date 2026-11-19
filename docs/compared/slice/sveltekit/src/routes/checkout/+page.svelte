<script>
  import { enhance } from '$app/forms';
  import Notice from '../Notice.svelte';

  let { data } = $props();
  const money = (cents) => `$${(cents / 100).toFixed(2)}`;
</script>

<svelte:head><title>Check out · {data.shop}</title></svelte:head>

<Notice said={data.said} />
<h1>Check out</h1>
<p class="summary">{data.cart.count} item{data.cart.count === 1 ? '' : 's'} · {money(data.cart.cents)} · pickup {data.time.day} at {data.time.label}</p>
<form method="post" class="panel" use:enhance>
  <input type="hidden" name="checkout" value={data.checkout} />
  <label for="name">Name</label>
  <input id="name" name="name" autocomplete="name" />
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" />
  <label for="card">Card number</label>
  <input id="card" name="card" inputmode="numeric" autocomplete="cc-number" />
  <button>Place order · {money(data.cart.cents)}</button>
</form>
<p class="meta">Test mode: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined.</p>
