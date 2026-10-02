import { jest } from '@jest/globals';

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  refresh: jest.fn(),
  prefetch: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
};

let searchParams = new URLSearchParams();

export function setSearchParams(value: string) {
  searchParams = new URLSearchParams(value);
}

export function resetNavigation() {
  for (const method of Object.values(router)) method.mockClear();
  searchParams = new URLSearchParams();
}

// Only Next's navigation boundary is replaced. Apollo, its HTTP transport,
// generated documents, form validation and rendered components remain real.
jest.unstable_mockModule('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
  useSearchParams: () => searchParams,
  useParams: () => ({ id: 'interview-ready' }),
}));
