/**
 * validateSnapshot — checks a candidate snapshot object against the
 * health-monitor snapshot contract (schema version 1).
 *
 * @param {unknown} o - The object to validate.
 * @returns {string[]} Array of problem descriptions; empty means valid.
 */
export function validateSnapshot(o) {
  const p = [];
  if (o?.schema !== 1) p.push('schema must be 1');
  for (const k of ['product', 'deployment', 'collected_at', 'nodes', 'metrics'])
    if (!(k in (o || {}))) p.push(`missing ${k}`);
  for (const [k, v] of Object.entries(o?.metrics ?? {})) {
    if (typeof v !== 'number' || !Number.isFinite(v)) p.push(`metric ${k} not a finite number`);
    if (!/^[a-z0-9_.]+$/.test(k)) p.push(`metric key ${k} malformed`);
  }
  for (const n of o?.nodes ?? [])
    if (n.reachable === false)
      for (const k of Object.keys(o.metrics ?? {}))
        if (k.startsWith(`node.${n.name}.`) && !k.endsWith('.reachable'))
          p.push(`unreachable ${n.name} has ${k}`);
  return p;
}
