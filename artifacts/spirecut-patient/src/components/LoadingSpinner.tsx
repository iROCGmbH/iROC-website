import { useTranslation } from "react-i18next";

export function LoadingSpinner() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-center min-h-[40vh] w-full">
      <div
        className="h-10 w-10 rounded-full border-4 border-muted border-t-primary animate-spin"
        role="status"
        aria-label={t("loading.page")}
      />
    </div>
  );
}
