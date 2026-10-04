import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { print } from 'graphql';

import { RunOutput } from '@/features/code-runner/ui/RunOutput';
import { GetCodeRunsDocument, GetInterviewResultsDocument } from '@/shared/api/generated/graphql';

describe('shared run output presentation', () => {
  test('renders stdout under Output and omits empty Errors', () => {
    render(<RunOutput stdout="42" stderr="" />);

    expect(screen.getByRole('region', { name: 'Output' })).toHaveTextContent('42');
    expect(screen.queryByRole('region', { name: 'Errors' })).not.toBeInTheDocument();
    expect(screen.queryByText('No stderr.')).not.toBeInTheDocument();
  });

  test('renders stderr under Errors and omits empty Output', () => {
    render(<RunOutput stdout="" stderr="ReferenceError: boom" />);

    expect(screen.getByRole('region', { name: 'Errors' })).toHaveTextContent(
      'ReferenceError: boom',
    );
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();
    expect(screen.queryByText('No stdout.')).not.toBeInTheDocument();
  });

  test('shows one compact empty state when stdout and stderr are empty', () => {
    render(<RunOutput stdout="" stderr="" />);

    expect(screen.getByText('No output.')).toBeInTheDocument();
    expect(screen.getAllByText('No output.')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Errors' })).not.toBeInTheDocument();
  });

  test('keeps the existing GraphQL data field names for stored run output', () => {
    expect(print(GetCodeRunsDocument)).toContain('stdout');
    expect(print(GetCodeRunsDocument)).toContain('stderr');
    expect(print(GetInterviewResultsDocument)).toContain('stdout');
    expect(print(GetInterviewResultsDocument)).toContain('stderr');
  });
});
