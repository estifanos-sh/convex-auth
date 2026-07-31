<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';

	const message = $derived(
		page.status === 404
			? 'This page has wandered off.'
			: page.error?.message || 'Something went wrong.'
	);
</script>

<svelte:head>
	<title>{page.status} — convex-auth</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="error-page">
	<p class="message">
		{message}
		<a href={`${base}/`}>Return to docs.</a>
	</p>
</main>

<style>
	.error-page {
		position: fixed;
		inset: 0;
		top: var(--shell-header-height);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background-color: var(--bg);
		z-index: 10;
	}

	.message {
		font-size: 1.125rem;
		color: var(--ink);
		text-align: center;
	}

	.message a {
		color: var(--accent);
		text-decoration: none;
		text-underline-offset: 0.15em;
		transition: text-decoration 0.15s ease;
	}

	.message a:hover {
		text-decoration: underline;
	}
</style>
