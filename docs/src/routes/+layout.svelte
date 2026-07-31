<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import '../app.css';
	import Header from '$lib/components/docs/Header.svelte';
	import Sidebar from '$lib/components/docs/Sidebar.svelte';
	import MobileNav from '$lib/components/docs/MobileNav.svelte';
	import { tableOverflow } from '$lib/utils/tableOverflow';

	let { children } = $props();
	let mobileNavOpen = $state(false);

	const routePath = $derived(page.url.pathname.slice(base.length) || '/');
	const isLanding = $derived(routePath === '/');
</script>

<svelte:head>
	<title>convex-auth</title>
	<meta
		name="description"
		content="Authentication infrastructure for Convex applications, from first sign-in to enterprise identity."
	/>
</svelte:head>

<a class="skip-link" href="#main-content">Skip to documentation</a>
<Header onMenuToggle={() => (mobileNavOpen = !mobileNavOpen)} />
<MobileNav bind:open={mobileNavOpen} />

{#if isLanding}
	<main id="main-content" class="landing" data-pagefind-body>
		{#key page.url.pathname}
			{@render children()}
		{/key}
	</main>
{:else}
	<div class="docs-layout">
		<div class="sidebar-container" aria-label="Documentation navigation">
			<Sidebar />
		</div>
		<main id="main-content" class="docs-main">
			<div class="doc-content" data-pagefind-body {@attach tableOverflow} tabindex="-1">
				{#key page.url.pathname}
					{@render children()}
				{/key}
			</div>
		</main>
	</div>
{/if}

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		width: 100%;
		overflow-x: hidden;
	}

	:global(body) {
		padding-top: var(--shell-header-height);
	}

	.skip-link {
		position: fixed;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 100;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--accent);
		background: var(--surface-raised);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: 0.68rem;
		letter-spacing: 0.04em;
		transform: translateY(-200%);
		transition: transform 140ms ease;
	}

	.skip-link:focus {
		transform: translateY(0);
	}

	.docs-layout {
		min-height: calc(100dvh - var(--shell-header-height));
		background: var(--bg);
	}

	.sidebar-container {
		display: none;
	}

	.docs-main {
		width: 100%;
		min-width: 0;
		padding: var(--brand-edge) var(--brand-edge) 5rem;
	}

	.doc-content {
		width: min(100%, 48rem);
		margin: 0;
	}

	@media (min-width: 56rem) {
		.sidebar-container {
			display: block;
			position: fixed;
			top: var(--shell-header-height);
			bottom: 0;
			left: 0;
			width: var(--shell-sidebar-width);
			border-right: 1px solid var(--line);
			background: var(--surface);
			z-index: 10;
		}

		.docs-main {
			margin-left: var(--shell-sidebar-width);
			padding: var(--brand-edge) var(--brand-edge) 7rem;
		}
	}

	.landing {
		display: flex;
		width: 100%;
		height: calc(100dvh - var(--shell-header-height));
		align-items: flex-end;
		margin: 0;
		padding: var(--brand-edge);
		overflow: hidden;
	}

	@media (max-width: 47.999rem) {
		.landing {
			padding-bottom: 6rem;
		}
	}
</style>
