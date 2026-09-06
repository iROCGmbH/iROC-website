import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';

async function fetchPortalSettings(token: string): Promise<Record<string, string>> {
  const res = await fetch('/api/portal/app-settings', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return {};
  return res.json();
}

export function usePortalSettings() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ['portal-app-settings'],
    queryFn: () => fetchPortalSettings(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,   // 5 min — settings rarely change
    gcTime: 10 * 60 * 1000,
  });
}
