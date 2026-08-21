import { DOMParser as XmldomDOMParser } from "@xmldom/xmldom";

interface ValidatorContext {
  validate?: (xml: string) => Promise<unknown>;
}

interface DOMParserLike {
  parseFromString: (xml: string, mimeType?: string) => Document;
}

interface DOMParserContext {
  dom?: DOMParserLike;
}

interface FileIOContext {
  readFile?: (path: string) => string | Uint8Array;
  writeFile?: (path: string, content: string) => void;
}

interface Context extends ValidatorContext, DOMParserContext, FileIOContext {}

/** A DOMParser constructor — the platform global or xmldom's, normalized to a `Document`-returning shape. */
interface DomParserCtor {
  new (options?: Record<string, unknown>): {
    parseFromString(xml: string, mimeType?: string): Document;
  };
}

/**
 * Resolve a DOMParser constructor: the platform global if present, else xmldom's.
 * xmldom implements the standard DOM interfaces but its declared types don't unify
 * with the global ones, so its constructor is bridged to {@link DomParserCtor}
 * through the single typed assertion at that cross-package boundary.
 */
function loadDomParserCtor(): DomParserCtor {
  const globalParser = globalThis.DOMParser;
  if (typeof globalParser === "function") {
    return globalParser;
  }
  if (typeof XmldomDOMParser === "function") {
    // SAFETY: xmldom implements the DOMParser contract, but its DOM types are
    // from a separate package universe.
    return XmldomDOMParser as unknown as DomParserCtor;
  }
  throw new Error("ERR_DOM_PARSER_NOT_AVAILABLE");
}

const DOCTYPE_OR_ENTITY = /<!\s*(DOCTYPE|ENTITY)\b/i;

function rejectDoctypeOrEntity(xml: string): void {
  if (DOCTYPE_OR_ENTITY.test(xml)) {
    throw new Error("ERR_XML_DOCTYPE_OR_ENTITY_FORBIDDEN");
  }
}

function createDOMParser(options: Record<string, unknown> = {}): DOMParserLike {
  const DOMParserCtor = loadDomParserCtor();
  const parser = new DOMParserCtor(options);
  return {
    parseFromString: (xml: string, mimeType = "text/xml") => {
      rejectDoctypeOrEntity(xml);
      return parser.parseFromString(xml, mimeType);
    },
  };
}

const context: Context = {
  validate: undefined,
  dom: undefined,
  readFile: undefined,
  writeFile: undefined,
};

/** Return the shared module context, lazily initializing a safe DOM parser. */
export function getContext() {
  if (context.dom === undefined) {
    context.dom = createDOMParser();
  }
  return context;
}

/**
 * Parse XML through the configured DOMParser, with DOCTYPE/ENTITY rejection.
 * Use this for any XML coming from a network peer (IdP responses, signed
 * payloads, encrypted assertions) instead of constructing a `DOMParser`
 * directly — direct construction bypasses the doctype/entity guard.
 */
export function safeParseXml(xml: string, mimeType: string = "text/xml"): Document {
  const { dom } = getContext();
  return dom!.parseFromString(xml, mimeType);
}

/** Register the XML schema validation callback used by {@link safeParseXml} consumers. */
export function setSchemaValidator(params: ValidatorContext) {
  if (typeof params.validate !== "function") {
    throw new Error("validate must be a callback function having one argument as xml input");
  }

  context.validate = params.validate;
}

/**
 * Check if the xml string is valid and bounded.
 *
 * Security: a validator must be registered (see {@link setSchemaValidator}).
 * A user may supply a validate function that always resolves to deliberately
 * skip validation, but then takes responsibility for the resulting exposure;
 * when no validator is registered this rejects rather than passing untrusted
 * XML through unchecked.
 */
export async function isValidXml(input: string) {
  const { validate } = getContext();

  if (!validate) {
    return Promise.reject(
      "XML validation was requested but no validator is registered; refusing to process untrusted XML without validation. Register a schema validator before validating XML.",
    );
  }

  return await validate(input);
}
