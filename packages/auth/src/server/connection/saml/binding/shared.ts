/**
 * Helpers and entity types shared by the redirect and POST binding builders.
 */
import type { BindingContext, SamlEntitySettings, SAMLDocumentTemplate } from "../types";
import type { IdentityProviderEntity as Idp } from "../identity/provider";
import type { ServiceProviderEntity as Sp } from "../service/provider";

/** Entity pair carried by login-request/response flows. */
export interface LoginEntity {
  idp: Idp;
  sp: Sp;
}

/** Entity pair carried by logout-request/response flows. */
export interface LogoutEntity {
  init: Idp | Sp;
  target: Idp | Sp;
}

/** {@link SamlEntitySettings} plus the logout-response template the binding reads but the base settings omit. */
export interface LogoutResponseSetting extends SamlEntitySettings {
  logoutResponseTemplate?: SAMLDocumentTemplate;
}

export function getBindingField(source: BindingContext, field: "id" | "context"): string {
  return source[field];
}
