<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { sidebar } from '$lib/config/sidebar';
	import { slide } from 'svelte/transition';

	let toggledGroups = $state<Record<string, boolean>>({});
	const currentPath = $derived((page.url.pathname.slice(base.length) || '/').replace(/\/$/, ''));
	const activeGroupLabels = $derived(
		new Set(
			sidebar
				.filter((group) => group.items.some((item) => currentPath === item.slug))
				.map((group) => group.label)
		)
	);

	function isGroupOpen(label: string): boolean {
		return toggledGroups[label] ?? activeGroupLabels.has(label);
	}

	function toggleGroup(label: string) {
		toggledGroups[label] = !isGroupOpen(label);
	}

	function isActive(slug: string): boolean {
		return currentPath === slug;
	}

	function hrefFor(slug: string): string {
		return `${base}${slug}/`;
	}
</script>

<aside class="sidebar">
	<nav aria-label="Documentation">
		{#each sidebar as group (group.label)}
			{@const groupId = `sidebar-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
			<div class="group">
				<button
					class="group-label"
					onclick={() => toggleGroup(group.label)}
					aria-expanded={isGroupOpen(group.label)}
					aria-controls={groupId}
				>
					<span>{group.label}</span>
					<svg
						class={['chevron', isGroupOpen(group.label) && 'open']}
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path d="M17 9.17a1 1 0 0 0-1.41 0L12 12.71 8.46 9.17a1 1 0 1 0-1.41 1.42l4.24 4.24a1.002 1.002 0 0 0 1.42 0L17 10.59a1.002 1.002 0 0 0 0-1.42Z" />
					</svg>
				</button>

				{#if isGroupOpen(group.label)}
					<ul id={groupId} transition:slide={{ duration: 140 }}>
						{#each group.items as item (item.slug)}
							<li>
								<a
									href={hrefFor(item.slug)}
									class={isActive(item.slug) ? 'active' : undefined}
									aria-current={isActive(item.slug) ? 'page' : undefined}
								>
									{item.title}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
	</nav>
</aside>

<style>
	.sidebar {
		width: 100%;
		height: 100%;
		overflow-y: auto;
		scrollbar-width: none;
		padding: 1.5rem 0 3rem;
	}

	.sidebar::-webkit-scrollbar {
		display: none;
	}

	.group {
		margin-bottom: 0.3rem;
	}

	.group-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.5rem 1.25rem;
		font-family: var(--font-label);
		font-size: 0.61rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.13em;
		color: var(--muted);
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.group-label:hover {
		color: var(--ink);
	}

	.chevron {
		color: var(--faint);
		transition: transform 140ms ease;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li a {
		position: relative;
		display: block;
		padding: 0.36rem 1.25rem;
		color: var(--muted);
		font-size: 0.82rem;
		line-height: 1.4;
		text-decoration: none;
		transition:
			color 130ms ease,
			background-color 130ms ease;
	}

	li a:hover {
		background: rgba(231, 226, 214, 0.025);
		color: var(--ink-2);
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
