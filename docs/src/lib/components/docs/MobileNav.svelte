<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { sidebar } from '$lib/config/sidebar';
	import { fade, fly } from 'svelte/transition';

	let { open = $bindable(false) }: { open: boolean } = $props();
	const currentPath = $derived((page.url.pathname.slice(base.length) || '/').replace(/\/$/, ''));

	function isActive(slug: string): boolean {
		return currentPath === slug;
	}

	function hrefFor(slug: string): string {
		return `${base}${slug}/`;
	}

	function navigate() {
		open = false;
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			open = false;
		}
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
	<div class="nav-layer">
		<button
			class="scrim"
			transition:fade={{ duration: 100 }}
			onclick={() => (open = false)}
			aria-label="Close documentation menu"
		></button>
		<dialog
			open
			class="sheet"
			transition:fly={{ x: -300, duration: 180 }}
			aria-modal="true"
			aria-label="Documentation navigation"
		>
			<div class="sheet-header">
				<span class="sheet-title">Documentation</span>
				<button class="close-btn" onclick={() => (open = false)} aria-label="Close menu">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="m13.41 12 6.3-6.29a1 1 0 1 0-1.42-1.42L12 10.59l-6.29-6.3a1 1 0 0 0-1.42 1.42l6.3 6.29-6.3 6.29a1 1 0 0 0 1.42 1.42l6.29-6.3 6.29 6.3a1 1 0 0 0 1.42-1.42L13.41 12Z" />
					</svg>
				</button>
			</div>

			<div class="sheet-content">
				{#each sidebar as group (group.label)}
					<div class="group">
						<p class="group-label">{group.label}</p>
						<ul>
							{#each group.items as item (item.slug)}
								<li>
									<a
										href={hrefFor(item.slug)}
										class={isActive(item.slug) ? 'active' : undefined}
										aria-current={isActive(item.slug) ? 'page' : undefined}
										onclick={navigate}
									>
										{item.title}
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</dialog>
	</div>
{/if}

<style>
	.nav-layer {
		position: fixed;
		inset: 0;
		z-index: 40;
	}

	.scrim {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: rgba(3, 4, 3, 0.7);
		cursor: default;
		backdrop-filter: blur(3px);
	}

	.sheet {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		width: 100%;
		max-width: min(var(--brand-copy-width), calc(100vw - var(--brand-edge-mobile)));
		margin: 0;
		padding: 0;
		border-right: 1px solid var(--line-strong);
		background:
			linear-gradient(rgba(231, 226, 214, 0.025) 1px, transparent 1px),
			linear-gradient(90deg, rgba(231, 226, 214, 0.025) 1px, transparent 1px),
			var(--bg);
		background-size: var(--grid-size) var(--grid-size);
		color: var(--ink-2);
		overflow-y: auto;
		scrollbar-width: none;
	}

	.sheet::-webkit-scrollbar {
		display: none;
	}

	.sheet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--shell-header-height);
		padding: 0 var(--brand-edge-mobile);
		border-bottom: 1px solid var(--line);
	}

	.sheet-title {
		color: var(--ink);
		font-size: 0.875rem;
		font-weight: 500;
	}

	.close-btn {
		display: grid;
		width: 2rem;
		height: 2rem;
		padding: 0;
		place-items: center;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}

	.close-btn:hover {
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.sheet-content {
		padding: var(--brand-edge-mobile) 0 3rem;
	}

	.group {
		margin-bottom: 1.15rem;
	}

	.group-label {
		font-family: var(--font-mono);
		font-size: 0.61rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.13em;
		color: var(--muted);
		padding: 0.35rem var(--brand-edge-mobile);
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li a {
		position: relative;
		display: block;
		padding: 0.48rem var(--brand-edge-mobile);
		color: var(--ink-2);
		font-size: var(--brand-meta-size);
		text-decoration: none;
	}

	li a:hover {
		background: rgba(231, 226, 214, 0.025);
		color: var(--ink);
	}

	li a.active {
		background: var(--accent-soft);
		color: var(--ink);
	}

	li a.active::before {
		content: '';
		position: absolute;
		top: 0.45rem;
		bottom: 0.45rem;
		left: 0;
		width: 2px;
		background: var(--accent);
	}
</style>
