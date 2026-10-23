// Text lookup for the Armenian UI (config/texts.json; command docs from config/guide.json).
// t('ui.run') -> "Գործարկել";  t('ui.level', { n: 2, max: 5 }) -> "Մակարդակ՝ 2 / 5"
export function createI18n(texts, research, guide = {}) {
  const get = (path) => {
    let v = texts;
    for (const part of path.split('.')) {
      if (v == null) return undefined;
      v = v[part];
    }
    return v;
  };

  const fill = (template, params = {}) =>
    String(template).replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));

  const t = (path, params) => {
    const v = get(path);
    if (v === undefined) return path;
    return params ? fill(v, params) : v;
  };

  const item = (name) => get(`items.${name}`) || name;
  const entity = (name) => get(`entities.${name}`) || name;
  const ground = (name) => get(`grounds.${name}`) || name;
  const hat = (name) => get(`hats.${name}`) || name;
  const feature = (name) => get(`features.${name}`) || name;
  const typeName = (key) => get(`types.${key}`) || key;
  const expected = (key) => get(`expected.${key}`) || key;
  const fnDoc = (name) => (guide.commands && guide.commands[name]) || null;
  const nodeName = (id) => {
    const n = research && research.find((x) => x.id === id);
    return n ? n.name : id;
  };

  const costText = (cost) =>
    Object.entries(cost || {})
      .map(([k, v]) => `${v} ${item(k)}`)
      .join(', ');

  return { t, fill, get, item, entity, ground, hat, feature, typeName, expected, fnDoc, nodeName, costText };
}
