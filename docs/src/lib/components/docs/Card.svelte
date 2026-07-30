<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, children }: { title: string; children: Snippet } = $props();
</script>

<article class="card">
	<p class="card-title">{title}</p>
	<div class="card-body">
		{@render children()}
	</div>
</article>

<style>
	.card {
		padding: 1.15rem 1.25rem;
		border: 1px solid var(--line);
		background: rgba(231, 226, 214, 0.018);
	}

	.card-title {
		margin: 0 0 0.4rem;
		color: var(--ink);
		font-size: 0.9rem;
		font-weight: 500;
	}

	.card-body {
		color: var(--muted);
		font-size: 0.86rem;
	}

	.card-body :global(p) {
		margin: 0;
	}
</style>
