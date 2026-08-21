import { DOMParser as XmldomDOMParser } from "@xmldom/xmldom";

interface ValidatorContext {
  validate?: (xml: string) => Promise<void>;
}

interface DOMParserLike {
  parseFromString: (xml: string, mimeType?: DOMParserSupportedType) => Document;
}

interface DOMParserContext {
  dom?: DOMParserLike;
}

interface FileIOContext {
  readFile?: (path: string) => string | Uint8Array;
  writeFile?: (path: string, content: string) => void;
}

interface Context extends ValidatorContext, DOMParserContext, FileIOContext {}

const DOCTYPE_OR_ENTITY = /<!\s*(DOCTYPE|ENTITY)\b/i;

function rejectDoctypeOrEntity(xml: string): void {
  if (DOCTYPE_OR_ENTITY.test(xml)) {
    throw new Error("ERR_XML_DOCTYPE_OR_ENTITY_FORBIDDEN");
  }
}

function createDOMParser(): DOMParserLike {
  const parser =
    typeof globalThis.DOMParser === "function" ? new globalThis.DOMParser() : new XmldomDOMParser();
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
export function safeParseXml(xml: string, mimeType: DOMParserSupportedType = "text/xml"): Document {
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

  await validate(input);
}
