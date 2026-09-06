import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { type NavConfig, DEFAULT_NAV_CONFIG, reconcileNavConfig } from "@/lib/nav-config";

export const NAV_CONFIG_QUERY_KEY = ["iroc-nav-config"] as const;

export function useNavConfig() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const { data: config = DEFAULT_NAV_CONFIG, isLoading } = useQuery<NavConfig>({
    queryKey: NAV_CONFIG_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/iroc/nav-config", {
        signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return DEFAULT_NAV_CONFIG;
      const data = await res.json() as NavConfig | null;
      return data ? reconcileNavConfig(data) : DEFAULT_NAV_CONFIG;
    },
    enabled: !!token,
    staleTime: 10 * 60 * 1000, // 10 minutes — nav config rarely changes
    placeholderData: DEFAULT_NAV_CONFIG, // sidebar renders immediately with defaults
  });

  const saveConfig = async (newConfig: NavConfig): Promise<void> => {
    const res = await fetch("/api/iroc/nav-config", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newConfig),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
      throw new Error(err.error ?? "Save failed");
    }
    // Immediately update the cached value so the sidebar reflects the change
    queryClient.setQueryData(NAV_CONFIG_QUERY_KEY, newConfig);
    queryClient.invalidateQueries({ queryKey: NAV_CONFIG_QUERY_KEY });
  };

  return { config, isLoading, saveConfig };
}
