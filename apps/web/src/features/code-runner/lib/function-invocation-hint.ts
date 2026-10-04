const declarationPatterns = [
  /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
];

function stripCommentsAndStrings(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, ' ')
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, ' ');
}

export function shouldShowFunctionInvocationHint(source: string) {
  const code = stripCommentsAndStrings(source);
  const declarations: { name: string; signatureIsCall: boolean }[] = [];

  for (const pattern of declarationPatterns) {
    pattern.lastIndex = 0;
    for (const match of code.matchAll(pattern)) {
      const name = match[1];
      if (name) declarations.push({ name, signatureIsCall: pattern === declarationPatterns[0] });
    }
  }

  if (declarations.length === 0) return false;

  return declarations.some(({ name, signatureIsCall }) => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const calls = code.match(new RegExp(`\\b${escapedName}\\s*\\(`, 'g')) ?? [];
    const declarationCallCount = signatureIsCall ? 1 : 0;
    return calls.length <= declarationCallCount;
  });
}
