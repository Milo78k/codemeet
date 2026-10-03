import type * as TypeScript from 'typescript';

import type { ProgrammingLanguage } from '../../../shared/api/generated/graphql';

export type ExecutableSource =
  { ok: true; code: string; format: 'script' | 'commonjs' } | { ok: false; error: string };

type ExecutableLanguage = Extract<ProgrammingLanguage, 'JAVASCRIPT' | 'TYPESCRIPT'>;

/**
 * Keeps ordinary JavaScript byte-for-byte unchanged. TypeScript and JavaScript
 * starter snippets containing ESM exports are lowered to worker-local CommonJS
 * form so the eventual `new Function` body remains a classic script.
 */
export async function transformExecutableSource(
  language: ExecutableLanguage,
  source: string,
): Promise<ExecutableSource> {
  if (language === 'JAVASCRIPT' && !/\b(?:export|import)\b/.test(source)) {
    return { ok: true, code: source, format: 'script' };
  }

  const compilerModule = (await import('typescript')) as typeof TypeScript & {
    default?: typeof TypeScript;
  };
  const ts = compilerModule.default ?? compilerModule;
  const fileName = language === 'TYPESCRIPT' ? 'main.ts' : 'main.js';
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    language === 'TYPESCRIPT' ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );

  if (
    sourceFile.statements.some(
      (statement) => ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement),
    )
  ) {
    return {
      ok: false,
      error: 'ES module imports and external packages are not supported by Code Runner.',
    };
  }

  const hasExports = sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement)) return true;
    return (
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    );
  });
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleDetection: ts.ModuleDetectionKind.Legacy,
      jsx: ts.JsxEmit.Preserve,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    ({ category }) => category === ts.DiagnosticCategory.Error,
  );
  if (errors.length) {
    const messages = errors
      .slice(0, 5)
      .map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        return `TS${diagnostic.code}: ${message}`;
      })
      .join('\n');
    return { ok: false, error: messages };
  }
  return {
    ok: true,
    code: result.outputText,
    format: hasExports ? 'commonjs' : 'script',
  };
}
