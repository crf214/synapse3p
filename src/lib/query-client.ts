import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            30 * 1000,       // 30 s — fresh window before background refetch
      gcTime:               5 * 60 * 1000,   // 5 min — retain in cache after unmount
      retry:                1,
      refetchOnWindowFocus: true,
    },
  },
})
