'use client';

import { Component, type ReactNode } from 'react';

export class EditorErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
