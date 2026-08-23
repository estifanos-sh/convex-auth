import { ErrorCode } from "../../shared/codes";
import { convexError } from "../errors";
import { LOG_LEVELS, type LogLevel } from "../../shared/log";
import { listAvailableProviders, configDefaults } from "../config";
import type { GetProviderOrThrowFunc } from "../crypto";

type ProviderRegistryService = {
  readonly getProviderOrThrow: GetProviderOrThrowFunc;
};

export const createProviderRegistry = (
  config: ReturnType<typeof configDefaults>,
  logger: { log: (level: LogLevel, ...args: unknown[]) => void },
): ProviderRegistryService => ({
  getProviderOrThrow: (id: string, allowExtraProviders: boolean = false) => {
    const provider =
      config.providers.find((configuredProvider) => configuredProvider.id === id) ??
      (allowExtraProviders
        ? config.extraProviders.find((configuredProvider) => configuredProvider.id === id)
        : undefined);
    if (provider === undefined) {
      const detail =
        `Provider \`${id}\` is not configured, ` +
        `available providers are ${listAvailableProviders(config, allowExtraProviders)}.`;
      logger.log(LOG_LEVELS.ERROR, detail);
      throw convexError(ErrorCode.PROVIDER_NOT_CONFIGURED, detail, { provider: id });
    }
    return provider;
  },
});
