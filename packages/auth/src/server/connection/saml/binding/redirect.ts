/**
 * Binding-level API for functions using Redirect binding.
 */
import { base64Encode, deflateString } from "../encoding";
import {
  getQueryParamByType,
  replaceTagsByValue,
  defaultLoginRequestTemplate,
  defaultLogoutResponseTemplate,
} from "../template";
import { constructMessageSignature } from "../signature";
import type { BindingContext, SamlEntitySettings, SAMLDocumentTemplate } from "../types";
import type { FlowResult, ExtractedProperties } from "../flow";
import { SamlQueryParam, SAML_STATUS_SUCCESS } from "../constants";
import {
  getBindingField,
  type LoginEntity,
  type LogoutEntity,
  type LogoutResponseSetting,
} from "./shared";

/** Read a request ID from the dynamically assembled SAML extraction record. */
function requestIdFromExtract(extract: ExtractedProperties): string | null {
  const request = extract.request;
  if (
    typeof request !== "object" ||
    request === null ||
    !("id" in request) ||
    typeof request.id !== "string"
  ) {
    return null;
  }
  return request.id;
}

interface BuildRedirectConfig {
  baseUrl: string;
  type: string;
  isSigned?: boolean;
  context: string;
  entitySetting: SamlEntitySettings;
  relayState?: string;
}

function pvPair(param: string, value: string, first?: boolean): string {
  return (first === true ? "?" : "&") + param + "=" + value;
}

function hasNoQuery(baseUrl: string): boolean {
  const queryIndex = baseUrl.indexOf("?");
  if (queryIndex < 0) {
    return true;
  }
  return queryIndex === baseUrl.length - 1;
}

/** Build the redirect-binding URL, optionally appending a query-string signature. */
async function buildRedirectURL(opts: BuildRedirectConfig): Promise<string> {
  const { baseUrl, type, isSigned, context, entitySetting } = opts;
  let { relayState = "" } = opts;
  const noParams = hasNoQuery(baseUrl);
  const queryParam = getQueryParamByType(type);
  const samlRequest = encodeURIComponent(base64Encode(deflateString(context)));
  if (relayState !== "") {
    relayState = pvPair(SamlQueryParam.relayState, encodeURIComponent(relayState));
  }
  if (isSigned) {
    const signingAlgorithm = entitySetting.requestSignatureAlgorithm;
    const signingKey = entitySetting.privateKey;
    if (signingAlgorithm === undefined || signingKey === undefined) {
      throw new Error("ERR_SIGNED_REDIRECT_MISSING_SIGNING_CONFIG");
    }
    const privateKey =
      typeof signingKey === "string" ? signingKey : new TextDecoder().decode(signingKey);
    const sigAlg = pvPair(SamlQueryParam.sigAlg, encodeURIComponent(signingAlgorithm));
    const octetString = samlRequest + relayState + sigAlg;
    const signature = await constructMessageSignature(
      queryParam + "=" + octetString,
      privateKey,
      entitySetting.privateKeyPass,
      undefined,
      signingAlgorithm,
    );
    return (
      baseUrl +
      pvPair(queryParam, octetString, noParams) +
      pvPair(SamlQueryParam.signature, encodeURIComponent(signature.toString()))
    );
  }
  return baseUrl + pvPair(queryParam, samlRequest + relayState, noParams);
}
/** Build the redirect-binding URL for a login request. */
export async function loginRequestRedirectURL(
  entity: LoginEntity,
  customTagReplacement?: (template: SAMLDocumentTemplate) => BindingContext,
): Promise<BindingContext> {
  const metadata = {
    idp: entity.idp.entityMeta,
    sp: entity.sp.entityMeta,
  };
  const spSetting: SamlEntitySettings = entity.sp.entitySetting;
  let id: string = "";

  if (metadata && metadata.idp && metadata.sp) {
    const base = metadata.idp.getSingleSignOnService("redirect") as string;
    let rawSamlRequest: string;
    if (spSetting.loginRequestTemplate && customTagReplacement) {
      const info = customTagReplacement(spSetting.loginRequestTemplate);
      id = getBindingField(info, "id");
      rawSamlRequest = getBindingField(info, "context");
    } else {
      const nameIDFormat = spSetting.nameIDFormat;
      const selectedNameIDFormat = Array.isArray(nameIDFormat) ? nameIDFormat[0] : nameIDFormat;
      id = spSetting.generateID!();
      rawSamlRequest = replaceTagsByValue(defaultLoginRequestTemplate.context, {
        ID: id,
        Destination: base,
        Issuer: metadata.sp.getEntityID(),
        IssueInstant: new Date().toISOString(),
        NameIDFormat: selectedNameIDFormat,
        AssertionConsumerServiceURL: metadata.sp.getAssertionConsumerService("post"),
        EntityID: metadata.sp.getEntityID(),
        AllowCreate: spSetting.allowCreate,
      });
    }
    return {
      id,
      context: await buildRedirectURL({
        context: rawSamlRequest,
        type: "SAMLRequest",
        isSigned: metadata.sp.isAuthnRequestSigned(),
        entitySetting: spSetting,
        baseUrl: base,
        relayState: spSetting.relayState,
      }),
    };
  }
  throw new Error("ERR_GENERATE_REDIRECT_LOGIN_REQUEST_MISSING_METADATA");
}
/** Build the redirect-binding URL for a logout response. */
export async function logoutResponseRedirectURL(
  requestInfo: FlowResult | null,
  entity: LogoutEntity,
  relayState?: string,
  customTagReplacement?: (template: SAMLDocumentTemplate) => BindingContext,
): Promise<BindingContext> {
  const metadata = {
    init: entity.init.entityMeta,
    target: entity.target.entityMeta,
  };
  const initSetting: LogoutResponseSetting = entity.init.entitySetting;
  let id: string = initSetting.generateID!();
  if (metadata && metadata.init && metadata.target) {
    const base = metadata.target.getSingleLogoutService("redirect") as string;
    let rawSamlResponse: string;
    if (initSetting.logoutResponseTemplate && customTagReplacement) {
      const template = customTagReplacement(initSetting.logoutResponseTemplate);
      id = getBindingField(template, "id");
      rawSamlResponse = getBindingField(template, "context");
    } else {
      const tvalue: Record<string, unknown> = {
        ID: id,
        Destination: base,
        Issuer: metadata.init.getEntityID(),
        EntityID: metadata.init.getEntityID(),
        IssueInstant: new Date().toISOString(),
        StatusCode: SAML_STATUS_SUCCESS,
      };
      const requestId = requestInfo?.extract ? requestIdFromExtract(requestInfo.extract) : null;
      if (requestId !== null) {
        tvalue.InResponseTo = requestId;
      }
      rawSamlResponse = replaceTagsByValue(defaultLogoutResponseTemplate.context, tvalue);
    }
    return {
      id,
      context: await buildRedirectURL({
        baseUrl: base,
        type: "LogoutResponse",
        isSigned: entity.target.entitySetting.wantLogoutResponseSigned,
        context: rawSamlResponse,
        entitySetting: initSetting,
        relayState,
      }),
    };
  }
  throw new Error("ERR_GENERATE_REDIRECT_LOGOUT_RESPONSE_MISSING_METADATA");
}
