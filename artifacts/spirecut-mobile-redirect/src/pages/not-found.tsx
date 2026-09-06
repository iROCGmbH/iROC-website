import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="min-h-[70vh] flex items-center justify-center bg-white px-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-4xl font-bold text-primary mb-4">{t("notFound.title")}</h1>
        <p className="text-primary/70 text-lg mb-8">{t("notFound.desc")}</p>
        <Button asChild className="rounded-button bg-primary hover:bg-primary/90 text-white font-semibold px-8 h-12">
          <Link href="/">{t("notFound.back")}</Link>
        </Button>
      </div>
    </div>
  );
}
