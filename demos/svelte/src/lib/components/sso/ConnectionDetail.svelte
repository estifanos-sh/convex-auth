<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { useQuery } from "convex-svelte";
  import { base } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { errorText } from "$lib/errors";
  import { api } from "$convex/_generated/api.js";
  import Copy from "svelte-radix/Copy.svelte";
  import Check from "svelte-radix/Check.svelte";
  import ExclamationTriangle from "svelte-radix/ExclamationTriangle.svelte";
  import ScimSection from "./ScimSection.svelte";

  let { client, connectionId, groupId, siteUrl } = $props<{
    client: ConvexClient;
    connectionId: string;
    groupId: string;
    siteUrl: string | null;
  }>();

  type ValidationResult = {
    ok: boolean;
    checks: Array<{ name: string; ok: boolean; message?: string }>;
  };
  type DomainRecord = {
    domain: string;
    isPrimary?: boolean;
    verifiedAt?: number;
  };
  type OidcConfigDraft = {
    discoveryUrl?: string;
    issuer?: string;
    clientId?: string;
    hasClientSecret?: boolean;
  };
  type SamlStoredConfig = {
    idp?: { metadataXml?: string; metadataUrl?: string };
    request?: { signAuthnRequests?: boolean };
    profile?: {
      mapping?: {
        subject?: string;
        email?: string;
        name?: string;
        firstName?: string;
        lastName?: string;
      };
    };
    attributeMapping?: {
      subject?: string;
      email?: string;
      name?: string;
      firstName?: string;
      lastName?: string;
    };
  };
  type ConfigValue = string | number | boolean | null | ConfigValue[] | ConfigRecord;
  type ConfigRecord = { [key: string]: ConfigValue | undefined };

  function isConfigValue(value: unknown): value is ConfigValue {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return true;
    }
    if (Array.isArray(value)) return value.every(isConfigValue);
    return (
      typeof value === "object" &&
      Object.values(value).every(isConfigValue)
    );
  }

  function configRecord(value: unknown): ConfigRecord | null {
    return isConfigValue(value) && !Array.isArray(value) && value !== null
      ? value as ConfigRecord
      : null;
  }

  type Tab = "config" | "domains" | "scim";
  let activeTab = $state<Tab>("config");

  let isSaving = $state(false);
  let isDeleting = $state(false);
  let newDomain = $state("");
  let verificationChallenge = $state<{ domain: string; recordName: string; token: string } | null>(null);
  let validationResult = $state<ValidationResult | null>(null);
  let copiedField = $state<string | null>(null);

  let oidcDiscoveryUrlDraft = $state<string | undefined>(undefined);
  let oidcClientIdDraft = $state<string | undefined>(undefined);
  let oidcClientSecretDraft = $state("");
  let samlMetadataUrlDraft = $state<string | undefined>(undefined);
  let samlMetadataXmlDraft = $state<string | undefined>(undefined);
  let samlSignAuthnRequestsDraft = $state<boolean | undefined>(undefined);
  let samlSubjectAttrDraft = $state<string | undefined>(undefined);
  let samlEmailAttrDraft = $state<string | undefined>(undefined);
  let samlNameAttrDraft = $state<string | undefined>(undefined);
  let samlFirstNameAttrDraft = $state<string | undefined>(undefined);
  let samlLastNameAttrDraft = $state<string | undefined>(undefined);

  const connectionQuery = useQuery(api.auth.group.getConnection, () => ({ id: connectionId }));
  const domainsQuery = useQuery(api.auth.group.listDomains, () => ({ connectionId }));
  const statusQuery = useQuery(api.auth.group.getConnectionStatus, () => ({ id: connectionId }));
  const oidcConfigQuery = useQuery(
    api.auth.group.getOidc,
    () =>
      (connectionQuery.data?.protocol ?? "oidc") === "oidc"
        ? { connectionId }
        : "skip",
  );

  const connection = $derived(connectionQuery.data);
  const oidcConfig = $derived(readOidcConfig(oidcConfigQuery.data));
  const protocol = $derived(connection?.protocol ?? "oidc");
  const domains = $derived.by(() => (domainsQuery.data ?? []) as DomainRecord[]);
  const primaryDomain = $derived(domains.find((domain) => domain.isPrimary) ?? domains[0] ?? null);
  const samlStoredConfig = $derived(readSamlStoredConfig(connection?.config));
  const connectionName = $derived(
    connection && "name" in connection && typeof connection.name === "string"
      ? connection.name
      : "Untitled connection",
  );
  const oidcDiscoveryUrl = $derived(
    oidcDiscoveryUrlDraft ?? oidcConfig?.discoveryUrl ?? oidcConfig?.issuer ?? "",
  );
  const oidcClientId = $derived(oidcClientIdDraft ?? oidcConfig?.clientId ?? "");
  const samlMetadataUrl = $derived(samlMetadataUrlDraft ?? samlStoredConfig?.idp?.metadataUrl ?? "");
  const samlMetadataXml = $derived(samlMetadataXmlDraft ?? samlStoredConfig?.idp?.metadataXml ?? "");
  const samlSignAuthnRequests = $derived(
    samlSignAuthnRequestsDraft ?? samlStoredConfig?.request?.signAuthnRequests ?? false,
  );
  const samlSubjectAttr = $derived(
    samlSubjectAttrDraft ?? samlStoredConfig?.profile?.mapping?.subject ?? "",
  );
  const samlEmailAttr = $derived(
    samlEmailAttrDraft ?? samlStoredConfig?.profile?.mapping?.email ?? "",
  );
  const samlNameAttr = $derived(
    samlNameAttrDraft ?? samlStoredConfig?.profile?.mapping?.name ?? "",
  );
  const samlFirstNameAttr = $derived(
    samlFirstNameAttrDraft ?? samlStoredConfig?.profile?.mapping?.firstName ?? "",
  );
  const samlLastNameAttr = $derived(
    samlLastNameAttrDraft ?? samlStoredConfig?.profile?.mapping?.lastName ?? "",
  );
  const samlSetup = $derived(
    siteUrl
      ? {
          entityId: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/saml/metadata`,
          acsUrl: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/saml/acs`,
          sloUrl: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/saml/slo`,
        }
      : null,
  );
  const isActive = $derived(connection?.status === "active");

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "config", label: "Configuration" },
    { id: "domains", label: "Domains" },
    { id: "scim", label: "SCIM" },
  ];

  function setMessage(kind: "success" | "error", message: string | null) {
    if (!message) return;
    if (kind === "success") { toast.success(message); }
    else { toast.error(message); }
  }

  function resetConfigDrafts() {
    oidcDiscoveryUrlDraft = undefined;
    oidcClientIdDraft = undefined;
    oidcClientSecretDraft = "";
    samlMetadataUrlDraft = undefined;
    samlMetadataXmlDraft = undefined;
    samlSignAuthnRequestsDraft = undefined;
    samlSubjectAttrDraft = undefined;
    samlEmailAttrDraft = undefined;
    samlNameAttrDraft = undefined;
    samlFirstNameAttrDraft = undefined;
    samlLastNameAttrDraft = undefined;
  }

  function readSamlStoredConfig(config: unknown): SamlStoredConfig | null {
    const root = configRecord(config);
    const protocols = configRecord(root?.protocols);
    const record = configRecord(protocols?.saml);
    if (!record) return null;
    const idp = configRecord(record.idp);
    const profile = configRecord(record.profile);
    const attributeMapping = configRecord(profile?.mapping);
    const request = configRecord(record.request);
    return {
      idp:
        idp !== undefined
          ? {
              metadataUrl:
                typeof idp.metadataUrl === "string" ? idp.metadataUrl : undefined,
              metadataXml:
                typeof idp.metadataXml === "string" ? idp.metadataXml : undefined,
            }
          : undefined,
      request:
        request !== null
          ? {
              signAuthnRequests:
                typeof request.signAuthnRequests === "boolean"
                  ? request.signAuthnRequests
                  : undefined,
            }
          : undefined,
      profile:
        attributeMapping !== undefined
          ? {
              mapping: {
                subject:
                  typeof attributeMapping.subject === "string"
                    ? attributeMapping.subject
                    : undefined,
                email:
                  typeof attributeMapping.email === "string"
                    ? attributeMapping.email
                    : undefined,
                name:
                  typeof attributeMapping.name === "string"
                    ? attributeMapping.name
                    : undefined,
                firstName:
                  typeof attributeMapping.firstName === "string"
                    ? attributeMapping.firstName
                    : undefined,
                lastName:
                  typeof attributeMapping.lastName === "string"
                    ? attributeMapping.lastName
                    : undefined,
              },
            }
          : undefined,
    };
  }

  function readOidcConfig(config: unknown): OidcConfigDraft | null {
    const record = configRecord(config);
    if (!record) return null;
    const discovery = configRecord(record.discovery);
    const client = configRecord(record.client);
    return {
      discoveryUrl:
        typeof discovery?.discoveryUrl === "string"
          ? discovery.discoveryUrl
          : undefined,
      issuer: typeof discovery?.issuer === "string" ? discovery.issuer : undefined,
      clientId: typeof client?.id === "string" ? client.id : undefined,
      hasClientSecret:
        typeof record.hasClientSecret === "boolean"
          ? record.hasClientSecret
          : undefined,
    };
  }

  function copyValue(value: string, field: string) {
    navigator.clipboard.writeText(value);
    copiedField = field;
    setTimeout(() => { copiedField = null; }, 2000);
  }

  async function handleValidate() {
    try {
      validationResult =
        protocol === "oidc"
          ? await client.action(api.auth.group.validateOidc, { connectionId })
          : await client.query(api.auth.group.validateSaml, { connectionId });
    } catch (error) {
      setMessage("error", errorText(error, "Validation failed."));
    }
  }

  async function handleSave() {
    isSaving = true;
    try {
      if (protocol === "oidc") {
        await client.mutation(api.auth.group.setOidc, {
          connectionId,
          discovery: {
            discoveryUrl: oidcDiscoveryUrl.trim() || undefined,
          },
          client: {
            id: oidcClientId.trim(),
            secret: oidcClientSecretDraft.trim() || undefined,
          },
        });
      } else {
        await client.action(api.auth.group.setSaml, {
          connectionId,
          metadata: {
            url: samlMetadataUrl.trim() || undefined,
            xml: samlMetadataXml.trim() || undefined,
          },
          request: {
            signAuthnRequests: samlSignAuthnRequests,
          },
          profile: {
            mapping: {
              subject: samlSubjectAttr.trim() || undefined,
              email: samlEmailAttr.trim() || undefined,
              name: samlNameAttr.trim() || undefined,
              firstName: samlFirstNameAttr.trim() || undefined,
              lastName: samlLastNameAttr.trim() || undefined,
            },
          },
        });
      }
      setMessage("success", "Configuration saved.");
      resetConfigDrafts();
      await handleValidate();
    } catch (error) {
      setMessage("error", errorText(error, "Save failed."));
    } finally {
      isSaving = false;
    }
  }

  async function handleDelete() {
    isDeleting = true;
    try {
      await client.mutation(api.auth.group.removeConnection, { id: connectionId });
      window.location.href = `${base}/${groupId}/connection`;
    } catch (error) {
      setMessage("error", errorText(error, "Delete failed."));
      isDeleting = false;
    }
  }

  async function handleAddDomain() {
    if (!newDomain.trim()) return;
    try {
      await client.mutation(api.auth.group.setDomains, {
        connectionId,
        domains: [
          ...domains.map((domain) => ({ domain: domain.domain, isPrimary: domain.isPrimary ?? false })),
          { domain: newDomain.trim(), isPrimary: domains.length === 0 },
        ],
      });
      newDomain = "";
      setMessage("success", "Domain added.");
    } catch (error) {
      setMessage("error", errorText(error, "Failed to add domain."));
    }
  }

  async function handleRequestVerification(domain: string) {
    try {
      const result = await client.mutation(api.auth.group.requestDomainVerification, { connectionId, domain });
      verificationChallenge = { domain, recordName: result.challenge.recordName, token: result.challenge.recordValue };
    } catch (error) {
      setMessage("error", errorText(error, "Verification failed."));
    }
  }

  async function handleConfirmVerification(domain: string) {
    try {
      await client.action(api.auth.group.confirmDomainVerification, { connectionId, domain });
      verificationChallenge = null;
      setMessage("success", `Verified ${domain}.`);
    } catch (error) {
      setMessage("error", errorText(error, "Verification failed."));
    }
  }
</script>

{#if !connection}
  <p class="muted">Loading connection…</p>
{:else}
  <div class="col-span-full max-w-5xl mx-auto w-full px-8 py-10 flex flex-col gap-0 max-md:px-4 max-md:py-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4 flex-wrap mb-8">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 font-label text-[0.75rem] text-content-tertiary">
          <a class="text-brand-red hover:text-brand-red no-underline font-semibold" href={`${base}/${groupId}/connection`}>Connections</a>
          <span>/</span>
          <span class="text-content-primary">{connectionName}</span>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
          <h1 class="heading text-2xl m-0">{connectionName}</h1>
          <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-2.5 py-1 border border-indigo-500/20 text-indigo-600 bg-indigo-50">{protocol}</span>
          <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-2.5 py-1 border {isActive ? 'text-green-800 bg-green-50 border-green-300' : 'text-content-secondary bg-background-tertiary border-border-transparent'}">{connection.status ?? 'draft'}</span>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button class="button button--secondary button--compact" type="button" onclick={handleValidate}>Validate</button>
        <button class="font-label text-[0.75rem] font-semibold text-content-error hover:text-content-primary bg-transparent border-0 cursor-pointer p-0" type="button" disabled={isDeleting} onclick={handleDelete}>{isDeleting ? 'Deleting…' : 'Delete connection'}</button>
      </div>
    </div>

    <!-- Tab bar -->
    <div class="segmented self-start mb-6">
      {#each tabs as tab (tab.id)}
        <button type="button" data-active={activeTab === tab.id} onclick={() => { activeTab = tab.id; }}>
          {tab.label}
        </button>
      {/each}
    </div>

    <!-- Tab content -->
    {#if activeTab === "config"}
      <div class="flex flex-col gap-6">
        <!-- SP URLs callout -->
        <div class="relative border border-border-transparent bg-background-tertiary p-5">
          <p class="m-0 mb-4 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-content-secondary">
            Service Provider Values
            <span class="ml-2 font-normal normal-case tracking-normal text-content-tertiary">— copy these into your Identity Provider</span>
          </p>
          <div class="flex flex-col gap-3">
            {#if protocol === 'saml' && samlSetup}
              {#each [
                ['Entity ID', samlSetup.entityId],
                ['ACS URL', samlSetup.acsUrl],
                ['SLO URL', samlSetup.sloUrl],
              ] as [label, value] (label)}
                <div class="flex items-center gap-3 min-w-0 max-md:flex-col max-md:items-start max-md:gap-1">
                  <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-content-tertiary w-20 shrink-0">{label}</span>
                  <code class="flex-1 font-mono text-[0.72rem] text-content-primary break-all min-w-0">{value}</code>
                  <button class="button button--secondary button--compact shrink-0" type="button" onclick={() => copyValue(value, label)}>
                    {#if copiedField === label}
                      <Check size="14" class="text-green-600" />
                    {:else}
                      <Copy size="14" />
                    {/if}
                  </button>
                </div>
              {/each}
            {:else if protocol === 'oidc' && siteUrl}
              {@const redirectUri = `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/oidc/callback`}
              <div class="flex items-center gap-3 min-w-0 max-md:flex-col max-md:items-start max-md:gap-1">
                <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-content-tertiary w-24 shrink-0">Redirect URI</span>
                <code class="flex-1 font-mono text-[0.72rem] text-content-primary break-all min-w-0">{redirectUri}</code>
                <button class="button button--secondary button--compact shrink-0" type="button" onclick={() => copyValue(redirectUri, 'redirect')}>
                  {#if copiedField === 'redirect'}
                    <Check size="14" class="text-green-600" />
                  {:else}
                    <Copy size="14" />
                  {/if}
                </button>
              </div>
            {/if}
          </div>
          <!-- Geometric accent -->
          <div class="absolute top-2 right-2 w-4 h-4 border border-border-transparent/50"></div>
          <div class="absolute top-4 right-4 w-4 h-4 border border-border-transparent/30"></div>
        </div>

        <!-- IdP Configuration form -->
        <div class="border border-border-transparent bg-background-secondary p-6 flex flex-col gap-5">
          <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-content-secondary">Identity Provider Configuration</p>

          {#if protocol === 'oidc'}
            <label class="flex flex-col gap-1.5">
              <span class="font-label text-xs font-semibold text-content-primary">Discovery URL</span>
              <input value={oidcDiscoveryUrl} oninput={(e) => { oidcDiscoveryUrlDraft = e.currentTarget.value; }} class="input" type="url" placeholder="https://idp.example.com/.well-known/openid-configuration" />
            </label>
            <div class="grid gap-5 md:grid-cols-2">
              <label class="flex flex-col gap-1.5">
                <span class="font-label text-xs font-semibold text-content-primary">Client ID</span>
                <input value={oidcClientId} oninput={(e) => { oidcClientIdDraft = e.currentTarget.value; }} class="input" type="text" placeholder="Client ID" />
              </label>
              <label class="flex flex-col gap-1.5">
                <span class="font-label text-xs font-semibold text-content-primary">Client Secret</span>
                <input bind:value={oidcClientSecretDraft} class="input" type="password" placeholder="Leave blank to keep current" />
              </label>
            </div>
          {:else}
            <div class="grid gap-5 md:grid-cols-2">
              <label class="flex flex-col gap-1.5 md:col-span-2">
                <span class="font-label text-xs font-semibold text-content-primary">Metadata URL</span>
                <input value={samlMetadataUrl} oninput={(e) => { samlMetadataUrlDraft = e.currentTarget.value; }} class="input" type="url" placeholder="https://idp.example.com/.../metadata" />
              </label>
              <label class="flex flex-col gap-1.5 md:col-span-2">
                <span class="font-label text-xs font-semibold text-content-primary">Metadata XML</span>
                <textarea value={samlMetadataXml} oninput={(e) => { samlMetadataXmlDraft = e.currentTarget.value; }} class="input resize-y min-h-28 font-mono text-[0.72rem] py-2" rows="5"></textarea>
              </label>
            </div>

            <div class="border-t border-border-transparent pt-5">
              <p class="m-0 mb-4 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-content-secondary">Attribute Mapping</p>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="flex flex-col gap-1.5">
                  <span class="font-label text-xs font-semibold text-content-primary">Subject</span>
                  <input value={samlSubjectAttr} oninput={(e) => { samlSubjectAttrDraft = e.currentTarget.value; }} class="input" type="text" placeholder="NameID fallback" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-label text-xs font-semibold text-content-primary">Email</span>
                  <input value={samlEmailAttr} oninput={(e) => { samlEmailAttrDraft = e.currentTarget.value; }} class="input" type="text" placeholder="email or claim URI" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-label text-xs font-semibold text-content-primary">Display Name</span>
                  <input value={samlNameAttr} oninput={(e) => { samlNameAttrDraft = e.currentTarget.value; }} class="input" type="text" placeholder="displayName" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-label text-xs font-semibold text-content-primary">First Name</span>
                  <input value={samlFirstNameAttr} oninput={(e) => { samlFirstNameAttrDraft = e.currentTarget.value; }} class="input" type="text" placeholder="givenName" />
                </label>
                <label class="flex flex-col gap-1.5 md:col-span-2">
                  <span class="font-label text-xs font-semibold text-content-primary">Last Name</span>
                  <input value={samlLastNameAttr} oninput={(e) => { samlLastNameAttrDraft = e.currentTarget.value; }} class="input" type="text" placeholder="surname" />
                </label>
              </div>
            </div>

            <label class="flex items-center gap-2.5 pt-1">
              <input checked={samlSignAuthnRequests} onchange={(e) => { samlSignAuthnRequestsDraft = e.currentTarget.checked; }} type="checkbox" class="w-4 h-4 accent-brand-red" />
              <span class="font-label text-[0.8125rem] text-content-primary">Sign AuthnRequests</span>
            </label>
          {/if}

          <div class="flex items-center gap-3 pt-2 border-t border-border-transparent">
            <button class="button button--accent" type="button" disabled={isSaving} onclick={handleSave}>{isSaving ? 'Saving…' : 'Save configuration'}</button>
          </div>
        </div>

        <!-- Validation results -->
        {#if validationResult}
          <div class="border border-border-transparent bg-background-secondary p-5 flex flex-col gap-0">
            <p class="m-0 mb-3 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] {validationResult.ok ? 'text-green-700' : 'text-brand-red'}">
              Validation {validationResult.ok ? 'Passed' : 'Issues Found'}
            </p>
            {#each validationResult.checks as check (check.name)}
              <div class="flex items-start justify-between gap-4 py-3 border-t border-border-transparent">
                <div class="flex items-start gap-3 min-w-0">
                  {#if check.ok}
                    <Check size="16" class="text-green-600 mt-0.5 shrink-0" />
                  {:else}
                    <ExclamationTriangle size="16" class="text-brand-red mt-0.5 shrink-0" />
                  {/if}
                  <div class="min-w-0">
                    <p class="m-0 font-label text-[0.8125rem] font-semibold text-content-primary">{check.name}</p>
                    {#if check.message}<p class="m-0 mt-1 font-label text-[0.75rem] text-content-secondary">{check.message}</p>{/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else if activeTab === "domains"}
      <div class="flex flex-col gap-4">
        <!-- Domain summary -->
        <div class="flex items-center gap-4 mb-2">
          <p class="m-0 font-label text-[0.8125rem] text-content-secondary">
            {domains.length} domain{domains.length !== 1 ? 's' : ''} configured
            {#if domains.length > 0}
              — {domains.filter((d) => Boolean(d.verifiedAt)).length} verified
            {/if}
          </p>
        </div>

        <!-- Domain list -->
        {#if domains.length > 0}
          <div class="border border-border-transparent bg-background-secondary">
            {#each domains as domain, i (domain.domain)}
              <div class="flex items-center justify-between gap-4 px-5 py-4 {i > 0 ? 'border-t border-border-transparent' : ''}">
                <div class="flex items-center gap-3 flex-wrap min-w-0">
                  <span class="font-label text-[0.9375rem] font-semibold text-content-primary">{domain.domain}</span>
                  {#if domain.isPrimary}
                    <span class="font-label text-[0.5625rem] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 border border-slate-400/30 text-slate-600 bg-slate-400/10">Primary</span>
                  {/if}
                  <span class="font-label text-[0.5625rem] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 border {domain.verifiedAt ? 'text-green-800 bg-green-50 border-green-300' : 'text-amber-800 bg-amber-50 border-amber-300'}">
                    {domain.verifiedAt ? 'Verified' : 'Pending'}
                  </span>
                </div>
                {#if !domain.verifiedAt}
                  <button class="button button--secondary button--compact" type="button" onclick={() => handleRequestVerification(domain.domain)}>Verify</button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- Verification challenge -->
        {#if verificationChallenge}
          {@const challenge = verificationChallenge}
          <div class="border border-indigo-500/20 bg-indigo-50/50 p-5 flex flex-col gap-4">
            <p class="m-0 font-label text-[0.75rem] font-semibold text-indigo-700">
              Add this TXT record to verify <span class="text-indigo-900">{challenge.domain}</span>
            </p>
            <div class="flex flex-col gap-3">
              {#each [
                ['TXT Name', challenge.recordName],
                ['TXT Value', challenge.token],
              ] as [label, value] (label)}
                <div class="flex items-center gap-3 min-w-0 max-md:flex-col max-md:items-start max-md:gap-1">
                  <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-indigo-500 w-20 shrink-0">{label}</span>
                  <code class="flex-1 font-mono text-[0.72rem] text-content-primary break-all min-w-0 bg-background-primary/60 px-2 py-1 border border-indigo-500/10">{value}</code>
                  <button class="button button--secondary button--compact shrink-0" type="button" onclick={() => copyValue(value, label)}>
                    {#if copiedField === label}
                      <Check size="14" class="text-green-600" />
                    {:else}
                      <Copy size="14" />
                    {/if}
                  </button>
                </div>
              {/each}
            </div>
            <button class="button button--accent button--compact self-start" type="button" onclick={() => handleConfirmVerification(challenge.domain)}>Confirm verification</button>
          </div>
        {/if}

        <!-- Add domain -->
        <div class="flex gap-3 items-center">
          <input bind:value={newDomain} class="input flex-1" type="text" placeholder="Add a domain (e.g. acme.com)" />
          <button class="button button--secondary" type="button" disabled={!newDomain.trim()} onclick={handleAddDomain}>Add domain</button>
        </div>
      </div>

    {:else if activeTab === "scim"}
      <ScimSection {client} {connectionId} />
    {/if}
  </div>
{/if}
