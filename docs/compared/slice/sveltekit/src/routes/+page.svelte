<script>
  import { enhance } from '$app/forms';
  import Notice from './Notice.svelte';

  let { data } = $props();
  const money = (cents) => `$${(cents / 100).toFixed(2)}`;
  const words = (left) => (left == null ? '' : left > 0 ? `${left} left` : 'Sold out');

  // What's left, kept live: the server pushes it, and each row follows.
  let pushed = $state(null);
  const left = $derived(pushed ?? Object.fromEntries(data.sections.flatMap(({ items }) => items.map((item) => [item.key, item.left]))));
  $effect(() => {
    const live = new EventSource('/live');
    live.onmessage = (event) => (pushed = Object.fromEntries(JSON.parse(event.data)));
    return () => live.close();
  });
</script>

<svelte:head><title>Menu · {data.shop}</title></svelte:head>

<Notice said={data.said} />
<h1>Order ahead</h1>
{#each data.sections as { section, items } (section)}
  <section>
    <h2>{section}</h2>
    <ul class="items">
      {#each items as item (item.key)}
        {@const out = left[item.key] != null && left[item.key] <= 0}
        <li class={['item', out && 'out']}>
          <h3>{item.name}</h3>
          <p class="meta">
            {money(item.cents)} · {item.unit}{#if words(left[item.key])} · <span class="left">{words(left[item.key])}</span>{/if}
          </p>
          <form method="post" action="?/add" use:enhance>
            <input type="hidden" name="item" value={item.key} />
            <input type="number" name="qty" value="1" min="1" max="24" aria-label="How many {item.name}" disabled={out} />
            <button type="submit" disabled={out}>Add</button>
          </form>
        </li>
      {/each}
    </ul>
  </section>
{/each}
