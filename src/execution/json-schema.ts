/**
 * Minimal JSON Schema validator.
 *
 * Supports the subset of JSON Schema needed for action output validation:
 * - type (string, number, integer, boolean, object, array, null)
 * - required
 * - properties
 * - items
 * - enum
 * - minLength, maxLength, minimum, maximum
 * - additionalProperties (boolean only)
 *
 * Returns structured errors describing where validation failed.
 * For complete JSON Schema support, swap in ajv or similar.
 */

export interface SchemaValidationError {
  path: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
}

export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];
  validateNode(value, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

function validateNode(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  errors: SchemaValidationError[],
): void {
  if (!schema || typeof schema !== 'object') return;

  // type
  const type = schema['type'];
  if (typeof type === 'string') {
    if (!checkType(value, type)) {
      errors.push({
        path: path || '$',
        message: `Expected type '${type}', got '${actualType(value)}'`,
      });
      return; // Don't continue validating wrong types
    }
  } else if (Array.isArray(type)) {
    if (!type.some((t) => checkType(value, String(t)))) {
      errors.push({
        path: path || '$',
        message: `Expected one of [${type.join(', ')}], got '${actualType(value)}'`,
      });
      return;
    }
  }

  // enum
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues)) {
    if (!enumValues.some((v) => deepEqual(v, value))) {
      errors.push({
        path: path || '$',
        message: `Value not in allowed enum: ${JSON.stringify(enumValues)}`,
      });
    }
  }

  // String constraints
  if (typeof value === 'string') {
    const minLength = schema['minLength'];
    const maxLength = schema['maxLength'];
    if (typeof minLength === 'number' && value.length < minLength) {
      errors.push({ path: path || '$', message: `String shorter than minLength ${minLength}` });
    }
    if (typeof maxLength === 'number' && value.length > maxLength) {
      errors.push({ path: path || '$', message: `String longer than maxLength ${maxLength}` });
    }
  }

  // Number constraints
  if (typeof value === 'number') {
    const minimum = schema['minimum'];
    const maximum = schema['maximum'];
    if (typeof minimum === 'number' && value < minimum) {
      errors.push({ path: path || '$', message: `Number less than minimum ${minimum}` });
    }
    if (typeof maximum === 'number' && value > maximum) {
      errors.push({ path: path || '$', message: `Number greater than maximum ${maximum}` });
    }
  }

  // Object validation
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // required
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !(key in obj)) {
          errors.push({ path: path || '$', message: `Missing required property '${key}'` });
        }
      }
    }

    // properties
    const properties = schema['properties'];
    if (properties && typeof properties === 'object') {
      const propsRecord = properties as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(propsRecord)) {
        if (key in obj) {
          validateNode(obj[key], propSchema, `${path}.${key}`, errors);
        }
      }
    }

    // additionalProperties (boolean false rejects unknown properties)
    const additionalProps = schema['additionalProperties'];
    if (additionalProps === false && properties && typeof properties === 'object') {
      const allowedKeys = new Set(Object.keys(properties));
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          errors.push({
            path: `${path}.${key}`,
            message: `Unexpected property '${key}' (additionalProperties: false)`,
          });
        }
      }
    }
  }

  // Array validation
  if (Array.isArray(value)) {
    const items = schema['items'];
    if (items && typeof items === 'object') {
      const itemSchema = items as Record<string, unknown>;
      value.forEach((item, idx) => {
        validateNode(item, itemSchema, `${path}[${idx}]`, errors);
      });
    }
  }
}

function checkType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'null': return value === null;
    default: return true;
  }
}

function actualType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}
