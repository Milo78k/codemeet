import {
  InMemoryCache,
  type ApolloCache,
  type FieldPolicy,
  type Reference,
  type StoreObject,
} from '@apollo/client';

// These are cache entries (normalized references), not handwritten API response types.
type CachedPage = {
  __typename?: string;
  items: readonly (Reference | StoreObject | undefined)[];
  pageInfo: StoreObject;
};

function offsetPage(keyArgs: string[]): FieldPolicy<CachedPage> {
  return {
    keyArgs,
    merge(existing, incoming, { args }) {
      const offset = typeof args?.offset === 'number' ? args.offset : 0;
      // A fresh first page also replaces previously loaded pages after refetch.
      const items = offset === 0 ? [] : (existing?.items.slice() ?? []);
      incoming.items.forEach((item, index) => {
        items[offset + index] = item;
      });
      const previousOffset = existing?.pageInfo.offset;
      const preserveCursor =
        offset > 0 && typeof previousOffset === 'number' && previousOffset > offset;
      return {
        ...incoming,
        items,
        pageInfo:
          preserveCursor && existing
            ? {
                ...incoming.pageInfo,
                offset: previousOffset,
                limit: existing.pageInfo.limit,
                hasNextPage: existing.pageInfo.hasNextPage,
              }
            : incoming.pageInfo,
      };
    },
    read(existing, { readField }) {
      if (!existing) return undefined;
      const seen = new Set<string>();
      return {
        ...existing,
        // Preserve raw offset slots in storage; deduplicate only the rendered result.
        items: existing.items.filter((item) => {
          if (!item) return false;
          const id = readField<string>('id', item);
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        }),
      };
    },
  };
}

export function createCache() {
  return new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          // Page size keeps dashboard counts/recent lists separate from library pages.
          questions: offsetPage(['search', 'language', 'difficulty', 'limit']),
          interviews: offsetPage(['status', 'limit']),
        },
      },
    },
  });
}

// Membership in filtered/paginated lists cannot be reconstructed from one mutation row.
// Evict only the affected domain field. A subsequent read requests a fresh first page.
export function invalidateQuestionLists(cache: ApolloCache) {
  cache.evict({ id: 'ROOT_QUERY', fieldName: 'questions' });
}

export function invalidateInterviewLists(cache: ApolloCache) {
  cache.evict({ id: 'ROOT_QUERY', fieldName: 'interviews' });
}
