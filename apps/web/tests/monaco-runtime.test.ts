import { describe, expect, jest, test } from '@jest/globals';

import { configureCompilerDefaults } from '@/features/interviews/editor/monaco-runtime';
import { getModelUri, getMonacoLanguage } from '@/features/interviews/editor/language';
import type * as Monaco from 'monaco-editor';

describe('Monaco TypeScript and TSX defaults', () => {
  test('uses the TypeScript worker with a TSX model URI and React JSX parsing', () => {
    expect(getMonacoLanguage('REACT_TSX')).toBe('typescript');
    expect(getModelUri('question-form', 'starter-code', 'REACT_TSX')).toMatch(/\.tsx$/);

    const setTypescriptOptions = jest.fn();
    const setJavascriptOptions = jest.fn();
    const addExtraLib = jest.fn();
    const monaco = {
      typescript: {
        ScriptTarget: { ESNext: 'esnext' },
        ModuleKind: { ESNext: 'esnext' },
        JsxEmit: { ReactJSX: 'react-jsx' },
        typescriptDefaults: {
          setCompilerOptions: setTypescriptOptions,
          addExtraLib,
        },
        javascriptDefaults: { setCompilerOptions: setJavascriptOptions },
      },
    } as unknown as typeof Monaco;

    configureCompilerDefaults(monaco);
    const compilerOptions = setTypescriptOptions.mock.calls[0]?.[0] as
      { jsx?: string; allowNonTsExtensions?: boolean } | undefined;
    expect(compilerOptions).toMatchObject({ jsx: 'react-jsx', allowNonTsExtensions: true });
    expect(addExtraLib).toHaveBeenCalledWith(
      expect.stringContaining("declare module 'react'"),
      'file:///codemeet/react-tsx-types.d.ts',
    );
    expect(addExtraLib.mock.calls[0]?.[0]).toContain("declare module 'react/jsx-runtime'");
  });
});
