type JsonSchemaProperty = {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  format?: "uuid" | "email" | "date-time" | "uri";
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
};

type JsonObjectSchema = {
  type?: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolInputValidationResult = { valid: true } | { valid: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateFormat(value: string, format: JsonSchemaProperty["format"]) {
  if (!format) return true;
  if (format === "uuid") return UUID_RE.test(value);
  if (format === "email") return value.length <= 254 && EMAIL_RE.test(value);
  if (format === "date-time") return !Number.isNaN(Date.parse(value));
  if (format === "uri") {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch { return false; }
  }
  return true;
}

function matchesType(value: unknown, type: JsonSchemaProperty["type"]) {
  if (!type) return true;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

export function validateToolInput(schema: Record<string, unknown>, input: Record<string, unknown>): ToolInputValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false, error: "Tool input must be an object" };

  const objectSchema = schema as JsonObjectSchema;
  const properties = objectSchema.properties || {};
  const required = Array.isArray(objectSchema.required) ? objectSchema.required : [];

  for (const field of required) {
    if (!(field in input) || input[field] === undefined || input[field] === null || input[field] === "") {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  if (objectSchema.additionalProperties !== true) {
    for (const field of Object.keys(input)) {
      if (!(field in properties)) return { valid: false, error: `Unexpected field: ${field}` };
    }
  }

  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const rule = properties[field];
    if (!rule) continue;
    if (!matchesType(value, rule.type)) return { valid: false, error: `Invalid type for field: ${field}` };
    if (rule.enum && !rule.enum.includes(value)) return { valid: false, error: `Invalid value for field: ${field}` };
    if (typeof value === "string" && !validateFormat(value, rule.format)) return { valid: false, error: `Invalid format for field: ${field}` };
    if (typeof value === "number") {
      if (typeof rule.minimum === "number" && value < rule.minimum) return { valid: false, error: `Field below minimum: ${field}` };
      if (typeof rule.maximum === "number" && value > rule.maximum) return { valid: false, error: `Field above maximum: ${field}` };
    }
  }

  return { valid: true };
}
