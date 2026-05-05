function matches(matcher, email, ctx) {
  const { from, to, subject } = email;
  if (matcher.from_pattern === 'me') {
    if (!ctx.selfFromAddresses?.some(addr => from.toLowerCase().includes(addr.toLowerCase()))) return false;
  } else if (matcher.from_pattern) {
    if (!new RegExp(matcher.from_pattern, 'i').test(from)) return false;
  }
  if (matcher.from_domain && !from.toLowerCase().endsWith('@' + matcher.from_domain.toLowerCase())) return false;
  if (matcher.to_pattern && !new RegExp(matcher.to_pattern, 'i').test(to)) return false;
  if (matcher.subject_pattern && !new RegExp(matcher.subject_pattern, 'i').test(subject)) return false;
  return true;
}

export function classifyEmail(email, rules, ctx = {}) {
  for (const c of rules.classifiers) {
    if (c.fallback) continue;
    if (c.match && matches(c.match, email, ctx)) {
      return { type: c.type, classifier: c };
    }
  }
  const fallback = rules.classifiers.find(c => c.fallback);
  return { type: fallback?.type ?? 'outro_sg3', classifier: fallback };
}
