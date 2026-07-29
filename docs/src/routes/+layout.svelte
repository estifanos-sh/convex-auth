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
		padding-top: 4rem;
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
		min-height: calc(100dvh - 4rem);
	}

	.sidebar-container {
		display: none;
	}

	.docs-main {
		width: 100%;
		min-width: 0;
		padding: 2.5rem 1.25rem 5rem;
	}

	.doc-content {
		width: min(100%, 50rem);
		margin: 0 auto;
	}

	@media (min-width: 56rem) {
		.sidebar-container {
			display: block;
			position: fixed;
			top: 4rem;
			bottom: 0;
			left: 0;
			width: 16.5rem;
			border-right: 1px solid var(--line);
			background: rgba(15, 16, 12, 0.78);
			backdrop-filter: blur(14px);
			z-index: 10;
		}

		.docs-main {
			margin-left: 16.5rem;
			padding: 4rem clamp(2.5rem, 7vw, 7rem) 7rem;
		}
	}

	.landing {
		width: min(100%, 72rem);
		margin: 0 auto;
		padding: 4rem 1.25rem 6rem;
	}

	@media (min-width: 48rem) {
		.landing {
			padding: 6rem 2rem 8rem;
		}
	}
</style>
