/**
 * 问心卦 · 极简 JSON Schema 校验器
 * ------------------------------------------------------------
 * 为什么自己写：本项目坚持零第三方依赖（十年后还能跑起来）。
 * 支持的是一份**明确的子集**，够用来约束卦录结构，不求覆盖整个规范。
 *
 * 支持的关键字：
 *   type, enum, const, properties, required, additionalProperties,
 *   items, minItems, maxItems, minimum, maximum, minLength, maxLength,
 *   pattern, oneOf, anyOf, description
 * 不支持（遇到即报「不支持」而非静默放过）：
 *   $ref, allOf, not, if/then/else, dependentSchemas, patternProperties
 */

const SUPPORTED = new Set([
  '$schema', '$id', 'title', 'description', 'type', 'enum', 'const',
  'properties', 'required', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'pattern', 'oneOf', 'anyOf', 'default', 'examples', 'format', 'deprecated',
]);

const TYPE_OF = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
};

function typeMatches(value, type) {
  const t = TYPE_OF(value);
  if (type === 'number') return t === 'number' || t === 'integer';
  if (type === 'integer') return t === 'integer';
  return t === type;
}

/**
 * 校验。
 * @param {*} value 待校验数据
 * @param {object} schema JSON Schema
 * @param {object} [opts] { path, errors, strict }
 * @returns {{valid:boolean, errors:Array<{path:string,message:string,keyword:string}>}}
 */
export function validate(value, schema, opts = {}) {
  const errors = opts.errors || [];
  const path = opts.path || '';
  const strict = opts.strict !== false;

  const err = (keyword, message) => errors.push({ path: path || '(根)', keyword, message });

  if (schema === true || schema === undefined) return { valid: errors.length === 0, errors };
  if (schema === false) {
    err('false', '此处的值被 schema 明确禁止');
    return { valid: false, errors };
  }

  if (strict) {
    for (const k of Object.keys(schema)) {
      if (!SUPPORTED.has(k)) err(k, `schema 使用了本校验器不支持的关建字「${k}」，请改用受支持的写法`);
    }
  }

  // const / enum
  if ('const' in schema && value !== schema.const) {
    err('const', `应为常量 ${JSON.stringify(schema.const)}，实际为 ${JSON.stringify(value)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => Object.is(e, value))) {
    err('enum', `应为 ${schema.enum.map((e) => JSON.stringify(e)).join(' / ')} 之一，实际为 ${JSON.stringify(value)}`);
  }

  // type
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      err('type', `类型应为 ${types.join(' | ')}，实际为 ${TYPE_OF(value)}`);
      return { valid: errors.length === 0, errors };
    }
  }

  // oneOf / anyOf
  if (Array.isArray(schema.oneOf)) {
    const hits = schema.oneOf.filter((s) => validate(value, s, { path, errors: [], strict }).valid);
    if (hits.length !== 1) err('oneOf', `应恰好满足 oneOf 中的一种写法，实际满足 ${hits.length} 种`);
  }
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((s) => validate(value, s, { path, errors: [], strict }).valid);
    if (!ok) err('anyOf', '不满足 anyOf 中的任何一种写法');
  }

  // 数值 / 字符串
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) err('minimum', `不得小于 ${schema.minimum}（实际 ${value}）`);
    if (schema.maximum !== undefined && value > schema.maximum) err('maximum', `不得大于 ${schema.maximum}（实际 ${value}）`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) err('exclusiveMinimum', `须大于 ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) err('exclusiveMaximum', `须小于 ${schema.exclusiveMaximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) err('minLength', `长度不得少于 ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) err('maxLength', `长度不得超过 ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      err('pattern', `不匹配模式 ${schema.pattern}（实际「${value.slice(0, 40)}」）`);
    }
  }

  // 数组
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) err('minItems', `至少 ${schema.minItems} 项（实际 ${value.length}）`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err('maxItems', `至多 ${schema.maxItems} 项（实际 ${value.length}）`);
    if (schema.items) {
      value.forEach((v, i) => validate(v, schema.items, { path: `${path}[${i}]`, errors, strict }));
    }
  }

  // 对象
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value) || value[key] === undefined) err('required', `缺少必填字段「${key}」`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) {
        validate(v, props[k], { path: path ? `${path}.${k}` : k, errors, strict });
      } else if (schema.additionalProperties === false) {
        err('additionalProperties', `不允许出现未声明的字段「${k}」（如为新增字段，请先更新 schema）`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validate(v, schema.additionalProperties, { path: path ? `${path}.${k}` : k, errors, strict });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 只取第一条错误，便于在界面上显示一句人话 */
export function firstError(result) {
  if (result.valid) return '';
  const e = result.errors[0];
  return `${e.path}：${e.message}`;
}
