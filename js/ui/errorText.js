// Turns GameErrors and warnings into friendly Armenian text (game names shown in Armenian).
export function describeError(err, i18n, game) {
  const p = { ...(err.params || {}) };
  const { research, api } = game;
  let key = err.code;
  switch (err.code) {
    case 'lockedSyntax':
      p.featureName = i18n.feature(p.feature);
      p.nodeName = i18n.nodeName(research.nodeForSyntax(p.feature));
      break;
    case 'lockedFunction': {
      const canon = p.canonical || api.canonicalName(p.name);
      const gate = research.nodeForFunction(canon);
      p.nodeName = i18n.nodeName(gate);
      p.name = api.displayName(canon);
      if (game.isRanch && game.shopItem(gate)) key = 'lockedFunctionRanch'; // sold in the ranch's shop
      else if (game.village.building(gate)) key = 'lockedFunctionVillage'; // unlocked by repairing a village building
      break;
    }
    case 'notFunction':
    case 'noMember':
    case 'notIterable':
      p.typeName = i18n.typeName(p.type);
      break;
    case 'badArg':
      p.expectedName = i18n.expected(p.expected);
      p.fn = api.displayName(p.fn);
      break;
    case 'missingArg':
      p.fn = api.displayName(p.fn);
      break;
    default:
      break;
  }
  const message = i18n.t(`errors.${key}`, p);
  const extra = [];
  if (p.python) extra.push(i18n.t('ui.pythonHint', { js: p.python }));
  if (p.enumHint && p.enumHint.length) extra.push(i18n.t('ui.enumHint', { names: p.enumHint.join(', ') }));
  else if (p.suggestions && p.suggestions.length) extra.push(i18n.t('ui.didYouMean', { names: p.suggestions.join(', ') }));
  return { message, suggestion: extra.join(' · '), where: whereText(err, i18n) };
}

export function whereText(err, i18n) {
  if (!err.loc) return '';
  return `«${err.module || 'main'}» · ${i18n.t('ui.atLine', { line: err.loc.line })}`;
}

export function describeWarning(w, i18n, game) {
  const p = { ...(w.params || {}) };
  if (p.entity) p.entityName = i18n.entity(p.entity);
  if (p.cost) p.costText = i18n.costText(p.cost);
  if (p.item) p.itemName = i18n.item(p.item);
  if (p.hat) p.hatName = i18n.hat(p.hat);
  if (p.machine) p.machineName = i18n.t(`machines.${p.machine}`);
  if (w.code === 'plant_entityLocked') p.nodeName = i18n.nodeName(game.research.nodeForEntity(p.entity));
  return i18n.t(`warnings.${w.code}`, p);
}
