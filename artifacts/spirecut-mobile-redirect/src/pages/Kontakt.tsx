import { useState } from "react";
import { Phone, Mail, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSpirecutSettings } from "@/hooks/useSpirecutSettings";

export default function Kontakt() {
  const { t, i18n } = useTranslation();
  const sp = useSpirecutSettings();
  const isEnglish = i18n.language === "en";
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          subject: "Patientenanfrage über spirecut.de",
          message: form.message + (form.phone ? `\n\nTelefon: ${form.phone}` : ""),
          privacyConsent: true,
        }),
      });
      if (res.ok) {
        setStatus("sent");
        setForm({ name: "", email: "", phone: "", message: "" });
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="flex flex-col w-full bg-white">
      <div className="container mx-auto px-4 lg:px-8 py-16 max-w-5xl">
        <div className="grid lg:grid-cols-2 gap-16">
          {/* Left: contact info */}
          <div className="bg-gray-50 rounded-2xl p-10 border border-gray-100">
            <p className="text-sm text-gray-500 uppercase tracking-wider font-medium mb-2">{t("kontakt.eyebrow")}</p>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{t("kontakt.title")}</h1>
            <div className="w-10 h-0.5 bg-primary mb-8" />

            <p className="text-primary font-bold text-lg mb-1">iROC GmbH</p>
            <div className="flex items-start gap-3 mb-5 text-gray-600 text-sm">
              <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span>St.-Emmeram-Str. 26<br />85609 Aschheim<br />{isEnglish ? "Germany" : "Deutschland"}</span>
            </div>

            <div className="space-y-3 mb-8">
              <a href="tel:+4989462599370" className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary transition-colors">
                <div className="h-9 w-9 bg-white rounded-full flex items-center justify-center border border-gray-200 shadow-sm shrink-0">
                  <Phone className="h-4 w-4 text-primary" />
                </div>
                +49 89 4625993 70
              </a>
              <a href={`mailto:${sp.sp_contact_email_de}`} className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary transition-colors">
                <div className="h-9 w-9 bg-white rounded-full flex items-center justify-center border border-gray-200 shadow-sm shrink-0">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                {sp.sp_contact_email_de}
              </a>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <p className="text-sm font-semibold text-gray-700 mb-1">{t("kontakt.manufacturer")}</p>
              <p className="text-sm text-gray-500">Spirecut AG · Hofackerstrasse 40B · CH-4132 Muttenz</p>
              <a href={`mailto:${sp.sp_contact_email_com}`} className="text-sm text-primary hover:underline">{sp.sp_contact_email_com}</a>
            </div>
          </div>

          {/* Right: contact form */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-6">{t("kontakt.formTitle")}</h2>
            {status === "sent" ? (
              <div className="p-6 bg-green-50 border border-green-200 rounded-xl text-center">
                <p className="text-green-800 font-semibold">{t("kontakt.successTitle")}</p>
                <p className="text-green-700 text-sm mt-1">{t("kontakt.successMsg")}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("kontakt.name")} *</label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("kontakt.email")} *</label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("kontakt.phone")}</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t("kontakt.message")} *</label>
                  <textarea
                    rows={6}
                    required
                    minLength={10}
                    value={form.message}
                    onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-primary resize-none"
                    placeholder={t("kontakt.messagePlaceholder")}
                  />
                  <p className="text-right text-xs text-gray-400 mt-1">{form.message.length} / 180</p>
                </div>
                {status === "error" && (
                  <p className="text-red-600 text-sm">{t("kontakt.submitError")}</p>
                )}
                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="h-11 px-8 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded"
                >
                  {status === "sending" ? t("kontakt.sending") : t("kontakt.submit")}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
