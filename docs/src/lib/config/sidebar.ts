export interface SidebarItem {
  title: string;
  slug: string;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export const sidebar: SidebarGroup[] = [
  {
    label: "Getting started",
    items: [
      { title: "Installation", slug: "/getting-started/installation" },
      { title: "Providers", slug: "/getting-started/providers" },
      { title: "Environment", slug: "/getting-started/environment" },
    ],
  },
  {
    label: "Frameworks",
    items: [
      { title: "React", slug: "/client/react" },
      { title: "Svelte", slug: "/client/svelte" },
      { title: "Native apps", slug: "/guides/native-apps" },
    ],
  },
  {
    label: "Guides",
    items: [
      { title: "Authorization", slug: "/guides/authorization" },
      { title: "Multi-access", slug: "/guides/multi-access" },
      { title: "Device flow", slug: "/guides/device-flow" },
      { title: "Production", slug: "/guides/production" },
    ],
  },
  {
    label: "Integrations",
    items: [
      { title: "Context enrichment", slug: "/integration/context" },
      { title: "Fluent Convex", slug: "/integration/fluent-convex" },
      { title: "MCP server", slug: "/guides/mcp-server" },
    ],
  },
  {
    label: "Enterprise",
    items: [
      { title: "Overview", slug: "/connection/overview" },
      { title: "Connections", slug: "/connection/connection" },
      { title: "Policies", slug: "/connection/policy" },
      { title: "OIDC", slug: "/connection/oidc" },
      { title: "SAML", slug: "/connection/saml" },
      { title: "SCIM", slug: "/connection/scim" },
      { title: "Audit log", slug: "/connection/audit" },
      { title: "Webhooks", slug: "/connection/webhook" },
      { title: "Client RPC", slug: "/connection/rpc" },
    ],
  },
  {
    label: "Server Rendering",
    items: [
      { title: "Overview", slug: "/ssr/overview" },
      { title: "SvelteKit", slug: "/ssr/sveltekit" },
      { title: "TanStack Start", slug: "/ssr/tanstack" },
      { title: "Next.js", slug: "/ssr/nextjs" },
    ],
  },
  {
    label: "API reference",
    items: [
      { title: "Users", slug: "/api/user" },
      { title: "Sessions", slug: "/api/session" },
      { title: "Accounts", slug: "/api/account" },
      { title: "Groups", slug: "/api/group" },
      { title: "Members", slug: "/api/member" },
      { title: "Invites", slug: "/api/invite" },
      { title: "Keys", slug: "/api/key" },
    ],
  },
  {
    label: "Reference",
    items: [
      { title: "Configuration", slug: "/reference/config" },
      { title: "Typed returns", slug: "/reference/typed-returns" },
      { title: "Error codes", slug: "/reference/errors" },
      { title: "CLI", slug: "/reference/cli" },
      { title: "Data migrations", slug: "/reference/migrations" },
      { title: "Architecture", slug: "/reference/architecture" },
      { title: ".well-known", slug: "/reference/well-known" },
    ],
  },
];
