import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { type PostopFormConfig, getDefaultPostopFormConfig } from "@workspace/spirecut-shared";

export const POSTOP_FORM_CONFIG_QUERY_KEY = ["postop-form-config"] as const;

export function usePostopFormConfig() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const { data: config = getDefaultPostopFormConfig(), isLoading } = useQuery<PostopFormConfig>({
    queryKey: POSTOP_FORM_CONFIG_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/iroc/postop-form-config", {
        signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return getDefaultPostopFormConfig();
      const data = await res.json() as PostopFormConfig | null;
      return data ?? getDefaultPostopFormConfig();
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    placeholderData: getDefaultPostopFormConfig(),
  });

  const saveConfig = async (newConfig: PostopFormConfig): Promise<void> => {
    const res = await fetch("/api/iroc/postop-form-config", {
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
    queryClient.setQueryData(POSTOP_FORM_CONFIG_QUERY_KEY, newConfig);
    queryClient.invalidateQueries({ queryKey: POSTOP_FORM_CONFIG_QUERY_KEY });
  };

  return { config, isLoading, saveConfig };
}
