import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function FAQ() {
  const { t } = useTranslation();
  const items = t("faq.items", { returnObjects: true }) as Array<{ q: string; a: string }>;

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="bg-gray-900 text-white pt-20 pb-20">
        <div className="container mx-auto px-4 lg:px-8 max-w-3xl text-center">
          <h1 className="text-4xl lg:text-5xl font-bold text-white mb-4">{t("faq.heroTitle")}</h1>
          <div className="w-10 h-0.5 bg-primary mx-auto mb-5" />
          <p className="text-gray-400">{t("faq.heroDesc")}</p>
        </div>
      </section>

      <div className="py-16 bg-white">
        <div className="container mx-auto px-4 lg:px-8 max-w-3xl">
          <Accordion type="single" collapsible className="w-full space-y-3">
            {items.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="border border-gray-200 rounded-lg px-6 bg-white data-[state=open]:border-primary/40 data-[state=open]:shadow-sm transition-all"
              >
                <AccordionTrigger className="text-left text-base font-semibold text-gray-900 hover:no-underline py-5 hover:text-primary">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 leading-relaxed pb-5">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="mt-14 border border-gray-200 p-8 rounded-xl text-center">
            <h3 className="text-xl font-bold text-gray-900 mb-3">{t("faq.notFound")}</h3>
            <p className="text-gray-500 mb-7 text-sm">{t("faq.notFoundDesc")}</p>
            <Link href="/arzt-finden">
              <span className="inline-flex items-center gap-2 h-11 px-7 text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition-colors rounded cursor-pointer">
                {t("faq.contactDoctor")} <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
