import { describe, expect, test } from '@jest/globals';

import { shouldShowFunctionInvocationHint } from '@/features/code-runner/lib/function-invocation-hint';

describe('function invocation hint', () => {
  test('shows a hint when a named function is declared without a call', () => {
    expect(
      shouldShowFunctionInvocationHint("export function twoSum() { console.log('gngn'); }"),
    ).toBe(true);
  });

  test('hides the hint when the function is invoked', () => {
    expect(shouldShowFunctionInvocationHint('function solve() {}\nsolve();')).toBe(false);
    expect(shouldShowFunctionInvocationHint('const solve = () => 42;\nsolve();')).toBe(false);
  });

  test('does not treat a function name in a comment or string as an invocation', () => {
    expect(shouldShowFunctionInvocationHint('function solve() {}\n// solve()')).toBe(true);
    expect(shouldShowFunctionInvocationHint("function solve() {}\nconsole.log('solve()')")).toBe(
      true,
    );
  });
});
