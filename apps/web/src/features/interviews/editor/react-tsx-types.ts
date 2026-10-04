/** Minimal semantic types for TSX snippets in the client-only editor. */
export const reactTsxTypeDeclarations = `
declare module 'react' {
  export type SetStateAction<S> = S | ((previousState: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
}

declare module 'react/jsx-runtime' {
  export namespace JSX {
    interface Element {}
    interface IntrinsicElements { [elementName: string]: any; }
  }
  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): JSX.Element;
  export function jsxs(type: any, props: any, key?: any): JSX.Element;
}

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [elementName: string]: any; }
}
`;
