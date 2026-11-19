<script>
  import { enhance } from '$app/forms';
  import Notice from '../Notice.svelte';

  let { data } = $props();
  const money = (cents) => `$${(cents / 100).toFixed(2)}`;
  const time = $derived(data.times.find((one) => one.slot === data.chosen));
</script>

<svelte:head><title>Your order · {data.shop}</title></svelte:head>

{#snippet qty(line, to, words)}
  <form method="post" action="?/change" use:enhance>
    <input type="hidden" name="item" value={line.item} />
    <button name="qty" value={to}>{words}</button>
  </form>
{/snippet}

<Notice said={data.said} />
<h1>Your order</h1>
<section class="panel">
  <h2>In your bag</h2>
  {#if data.cart.lines.length}
    <ul class="lines">
      {#each data.cart.lines as line (line.item)}
        <li class="line">
          <div>
            <h3>{line.name}</h3>
            <p class="meta">{money(line.cents)} each · {money(line.total)}</p>
          </div>
          <div class="qty">
            {@render qty(line, line.qty - 1, '−')}
            <span>{line.qty}</span>
            {@render qty(line, line.qty + 1, '+')}
            {@render qty(line, 0, 'Remove')}
          </div>
        </li>
      {/each}
    </ul>
    <p class="total">Total {money(data.cart.cents)}</p>
  {:else}
    <p>Your bag is empty.</p>
  {/if}
</section>
<section class="panel">
  <h2>Pickup time</h2>
  <form method="post" action="?/choose" use:enhance>
    <label for="slot">When you’ll come by</label>
    <select id="slot" name="slot" value={data.chosen}>
      <option value="">Choose…</option>
      {#each data.times as one (one.slot)}
        <option value={one.slot} disabled={one.full}>{one.day} {one.label}{one.full ? ' (full)' : ''}</option>
      {/each}
    </select>
    <button>Set the time</button>
  </form>
  {#if time}<p>Pickup: {time.day} at {time.label}</p>{/if}
</section>
{#if data.cart.lines.length && time}<a class="button" href="/checkout">Check out</a>{/if}
