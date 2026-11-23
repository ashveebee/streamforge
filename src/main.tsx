import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { AuthProvider } from '@/hooks/useAuth';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      retry: (count, err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 404 || err.status === 403)) return false;
        return count < 2;
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
