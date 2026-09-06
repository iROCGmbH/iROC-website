import { Link } from "wouter";
import { useLanguage } from "@/hooks/use-language";
import { MICROSOFT_MAILBOX_ROLES } from "@/lib/microsoft-mailbox-roles";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowRight,
  BookOpen,
  BotMessageSquare,
  CheckCircle2,
  Globe,
  Info,
  LockKeyhole,
  Mail,
  Receipt,
  Server,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

type EmailAddressCardProps = {
  address: string;
  titleDe: string;
  titleEn: string;
  descriptionDe: string;
  descriptionEn: string;
  badgeDe?: string;
  badgeEn?: string;
};

function EmailAddressCard({
  address,
  titleDe,
  titleEn,
  descriptionDe,
  descriptionEn,
  badgeDe,
  badgeEn,
}: EmailAddressCardProps) {
  const { lang } = useLanguage();
  const de = lang === "de";

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{de ? titleDe : titleEn}</CardTitle>
            <p className="mt-2 break-all font-mono text-sm text-primary">{address}</p>
          </div>
          {(badgeDe || badgeEn) && (
            <Badge variant="outline" className="shrink-0">
              {de ? badgeDe : badgeEn}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 text-sm leading-relaxed text-muted-foreground">
        {de ? descriptionDe : descriptionEn}
      </CardContent>
    </Card>
  );
}

type EmailFlowProps = {
  icon: React.ElementType;
  titleDe: string;
  titleEn: string;
  descriptionDe: string;
  descriptionEn: string;
  settingDe?: string;
  settingEn?: string;
};

function EmailFlow({
  icon: Icon,
  titleDe,
  titleEn,
  descriptionDe,
  descriptionEn,
  settingDe,
  settingEn,
}: EmailFlowProps) {
  const { lang } = useLanguage();
  const de = lang === "de";

  return (
    <div className="flex gap-3 rounded-lg border bg-card p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <h3 className="font-medium">{de ? titleDe : titleEn}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {de ? descriptionDe : descriptionEn}
        </p>
        {(settingDe || settingEn) && (
          <code className="mt-2 inline-block rounded bg-muted px-2 py-1 text-xs">
            {de ? settingDe : settingEn}
          </code>
        )}
      </div>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  titleDe,
  titleEn,
  descriptionDe,
  descriptionEn,
}: {
  icon: React.ElementType;
  titleDe: string;
  titleEn: string;
  descriptionDe: string;
  descriptionEn: string;
}) {
  const { lang } = useLanguage();
  const de = lang === "de";

  return (
    <div className="flex items-start gap-3 border-b pb-3">
      <div className="rounded-lg bg-primary/10 p-2">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{de ? titleDe : titleEn}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {de ? descriptionDe : descriptionEn}
        </p>
      </div>
    </div>
  );
}

export default function EmailHelp() {
  const { lang } = useLanguage();
  const de = lang === "de";

  return (
    <div className="max-w-5xl space-y-8">
      <header className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">
            {de ? "E-Mail-Hilfe" : "Email Help"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {de
              ? "Übersicht aller E-Mail-Adressen, Zuständigkeiten und Einstellungen im iROC Interface App Dashboard."
              : "Overview of all email addresses, responsibilities, and settings in the iROC Interface App Dashboard."}
          </p>
        </div>
      </header>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm leading-relaxed">
              {de
                ? "Diese Seite erklärt die Rollen der Adressen. Die tatsächlich gespeicherten Empfänger und Microsoft-365-Postfächer können Administratoren in der E-Mail-Konfiguration ändern."
                : "This page explains the roles of each address. Administrators can change the actual recipients and Microsoft 365 mailboxes in Email Configuration."}
            </p>
          </div>
          <Link
            href="/email-config"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {de ? "E-Mail-Konfiguration öffnen" : "Open Email Configuration"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <SectionHeading
          icon={Mail}
          titleDe="Zentrale E-Mail-Adressen"
          titleEn="Main email addresses"
          descriptionDe="Diese Adressen sind die wichtigsten festen oder standardmäßigen Kontaktpunkte des Projekts."
          descriptionEn="These are the project’s main fixed or default email contact points."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <EmailAddressCard
            address="info@i-roc.de"
            titleDe="Zentrale iROC-Adresse"
            titleEn="Main iROC address"
            descriptionDe="Standardadresse für iROC-Website, Impressum, Rechnungs-Kontakt, allgemeine Formular- und interne Benachrichtigungen, Sally-Eskalationen sowie SMTP-Fallbacks."
            descriptionEn="Default address for the iROC website, legal notice, invoice contact, general form and internal notifications, Sally escalations, and SMTP fallbacks."
            badgeDe="Standard"
            badgeEn="Default"
          />
          <EmailAddressCard
            address="info@spirecut.de"
            titleDe="Deutsche Spirecut-Adresse"
            titleEn="German Spirecut address"
            descriptionDe="Kontaktadresse der deutschen Spirecut-Patientenwebsite. Sie ist aktuell außerdem als Empfänger des Kontaktformulars in der Entwicklungsumgebung hinterlegt."
            descriptionEn="Contact address for the German Spirecut patient website. It is also currently configured as the contact-form recipient in the development environment."
          />
          <EmailAddressCard
            address="info@spirecut.com"
            titleDe="Internationale Spirecut-Adresse"
            titleEn="International Spirecut address"
            descriptionDe="Kontaktadresse für internationale Spirecut-Anfragen und die internationale Website."
            descriptionEn="Contact address for international Spirecut enquiries and the international website."
          />
          <EmailAddressCard
            address="e.manos@i-roc.de"
            titleDe="SMTP- und Rechnungs-Postfach"
            titleEn="SMTP and invoice mailbox"
            descriptionDe="Derzeit als SMTP-Benutzer und als Microsoft-365-Postfach für den KI-Rechnungseingang registriert. Die Microsoft-Autorisierung muss noch abgeschlossen werden."
            descriptionEn="Currently configured as the SMTP user and registered as the Microsoft 365 mailbox for AI invoice processing. Microsoft authorization is still pending."
            badgeDe="Derzeit registriert"
            badgeEn="Currently registered"
          />
          <EmailAddressCard
            address="sales@i-roc.de"
            titleDe="Sally-Postfach"
            titleEn="Sally mailbox"
            descriptionDe="Microsoft-365-Postfach für Sally-Kommunikation mit Lese- und Schreibzugriff. Die Microsoft-Autorisierung muss noch abgeschlossen werden."
            descriptionEn="Microsoft 365 mailbox for Sally communication with read/write access. Microsoft authorization is still pending."
            badgeDe="Derzeit registriert"
            badgeEn="Currently registered"
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          icon={Server}
          titleDe="E-Mail-Versand und Empfänger"
          titleEn="Email sending and recipients"
          descriptionDe="Diese Rollen bestimmen, wohin automatische Nachrichten gesendet werden."
          descriptionEn="These roles determine where automated messages are sent."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <EmailFlow
            icon={Globe}
            titleDe="Kontaktformular"
            titleEn="Contact form"
            descriptionDe="Neue Kontaktanfragen der iROC-Website werden an den konfigurierten Kontaktformular-Empfänger gesendet. Standard ist info@i-roc.de."
            descriptionEn="New iROC website contact enquiries are sent to the configured contact-form recipient. The default is info@i-roc.de."
            settingDe="email_dest_contact"
            settingEn="email_dest_contact"
          />
          <EmailFlow
            icon={Users}
            titleDe="Neue Kunden und Bestellungen"
            titleEn="New customers and orders"
            descriptionDe="Bestätigungs-E-Mails gehen an die Kundenadresse. Interne Benachrichtigungen für Neukunden und Bestandskunden verwenden getrennte Empfänger."
            descriptionEn="Confirmation emails go to the customer address. Internal notifications for new and existing customers use separate recipients."
            settingDe="email_dest_order_new · email_dest_order_existing"
            settingEn="email_dest_order_new · email_dest_order_existing"
          />
          <EmailFlow
            icon={BookOpen}
            titleDe="Schulungsanmeldungen"
            titleEn="Training registrations"
            descriptionDe="Spirecut- und MiniStem-Anmeldungen werden an jeweils eigene interne Empfänger gesendet."
            descriptionEn="Spirecut and MiniStem registrations are sent to separate internal recipients."
            settingDe="email_dest_training_spirecut · email_dest_training_ministem"
            settingEn="email_dest_training_spirecut · email_dest_training_ministem"
          />
          <EmailFlow
            icon={Receipt}
            titleDe="Rechnungen und DATEV"
            titleEn="Invoices and DATEV"
            descriptionDe="Rechnungen werden an die Kundenadresse gesendet. DATEV-Exporte gehen an die beim Export angegebene Buchhaltungsadresse. Die Adresse im Rechnungs-PDF ist separat konfigurierbar."
            descriptionEn="Invoices are sent to the customer address. DATEV exports go to the bookkeeping address entered during export. The address printed on invoice PDFs is configured separately."
            settingDe="invoice_contact_email · datev_bookkeeper_email"
            settingEn="invoice_contact_email · datev_bookkeeper_email"
          />
          <EmailFlow
            icon={BotMessageSquare}
            titleDe="Sally und Leads"
            titleEn="Sally and leads"
            descriptionDe="Sally antwortet an die jeweilige Kunden- oder Lead-Adresse. Absender und Eskalationsadresse werden in den Sally-Einstellungen verwaltet."
            descriptionEn="Sally replies to the relevant customer or lead address. The sender and escalation address are managed in Sally settings."
            settingDe="sally_from_email · sally_escalation_email"
            settingEn="sally_from_email · sally_escalation_email"
          />
          <EmailFlow
            icon={BotMessageSquare}
            titleDe="Tori und Lieferanten"
            titleEn="Tori and suppliers"
            descriptionDe="Tori erstellt Nachbestellungsentwürfe für die im Produkt oder Auftrag gespeicherte Lieferantenadresse. Eine fehlende Lieferantenadresse darf nicht als echte Firmenadresse behandelt werden."
            descriptionEn="Tori creates reorder drafts for the supplier address stored on the product or order. A missing supplier address must not be treated as a real company address."
            settingDe="Lieferanten-E-Mail aus Produkt-/Auftragsdaten"
            settingEn="Supplier email from product/order data"
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          icon={Settings}
          titleDe="Wo wird was verwaltet?"
          titleEn="Where is each setting managed?"
          descriptionDe="Nutze diese Wege im Dashboard, um die jeweilige E-Mail-Funktion zu öffnen."
          descriptionEn="Use these Dashboard paths to open the relevant email function."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <Link href="/email-config" className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardContent className="flex gap-3 p-4">
                <Server className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <h3 className="font-medium group-hover:text-primary">
                    {de ? "Konfiguration → E-Mail → E-Mail-Konfiguration" : "Configuration → Email → Email Configuration"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {de
                      ? "SMTP, Microsoft-365-/Outlook-Postfächer, Tori-Postfachzweck, Sally-Adressen und Spirecut-Kontaktadressen."
                      : "SMTP, Microsoft 365/Outlook mailboxes, Tori mailbox purpose, Sally addresses, and Spirecut contact addresses."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/iroc-website/email" className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardContent className="flex gap-3 p-4">
                <Globe className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <h3 className="font-medium group-hover:text-primary">
                    {de ? "Konfiguration → Website → iROC Website → E-Mail-Adressen" : "Configuration → Website → iROC Website → Email Addresses"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {de
                      ? "Empfänger für Kontaktformular, Bestellungen sowie Spirecut- und MiniStem-Schulungen."
                      : "Recipients for the contact form, orders, and Spirecut and MiniStem training."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/sally" className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardContent className="flex gap-3 p-4">
                <BotMessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <h3 className="font-medium group-hover:text-primary">
                    {de ? "Agents/Managers → Sally" : "Agents/Managers → Sally"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {de
                      ? "Sally-Absender, Eskalationsadresse, Posteingang und E-Mail-Freigabe."
                      : "Sally sender, escalation address, inbox, and email approval queue."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/tori" className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardContent className="flex gap-3 p-4">
                <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <h3 className="font-medium group-hover:text-primary">
                    {de ? "Agents/Managers → Tori" : "Agents/Managers → Tori"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {de
                      ? "Ausgaben, Rechnungen, Lieferantenadressen, Nachbestellungen und Historie."
                      : "Expenses, invoices, supplier addresses, reorders, and history."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          icon={ShieldCheck}
          titleDe="Microsoft 365 / Outlook verbinden"
          titleEn="Connect Microsoft 365 / Outlook"
          descriptionDe="Postfächer werden sicher per OAuth autorisiert. Exchange-Passwörter werden nicht in iROC gespeichert."
          descriptionEn="Mailboxes are authorized securely through OAuth. Exchange passwords are not stored in iROC."
        />
        <Card>
          <CardContent className="space-y-4 p-5">
            <ol className="grid gap-3 md:grid-cols-2">
              {[
                {
                  de: "E-Mail-Konfiguration öffnen.",
                  en: "Open Email Configuration.",
                },
                {
                  de: "Unter Microsoft 365 ein Postfach hinzufügen.",
                  en: "Add a mailbox under Microsoft 365.",
                },
                {
                  de: "Als Zweck „Tori KI-Dokumentenanalyse“ auswählen.",
                  en: "Select “Tori AI document analysis” as the purpose.",
                },
                {
                  de: "„Microsoft autorisieren“ auswählen und die Anmeldung abschließen.",
                  en: "Select “Authorize Microsoft” and complete sign-in.",
                },
              ].map((step, index) => (
                <li key={step.en} className="flex gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{de ? step.de : step.en}</span>
                </li>
              ))}
            </ol>
            <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {de
                  ? "Für Tori reicht normalerweise „Nur lesen“. „Lesen und schreiben“ ist nur erforderlich, wenn das Postfach später auch über Microsoft Graph senden soll."
                  : "For Tori, “Read only” is normally sufficient. “Read and write” is only required if the mailbox will later send through Microsoft Graph."}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {de
                ? "Im Microsoft-365-Tool stehen außerdem Rollen für Website-Kontaktformular, Bestellungen (Neu- und Bestandskunden), Spirecut- und MiniStem-Schulungen, Rechnungen, DATEV/Buchhaltung, Ankündigungen, SMTP, Benachrichtigungen, Sally und Tori zur Verfügung."
                : "The Microsoft 365 tool also provides roles for website contact forms, orders (new and existing customers), Spirecut and MiniStem training, invoices, DATEV/bookkeeping, announcements, SMTP, notifications, Sally, and Tori."}
            </p>
            <Link
              href="/email-config"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              {de ? "Zu Microsoft-365-Postfächern" : "Go to Microsoft 365 mailboxes"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading
          icon={Mail}
          titleDe="Alle Microsoft-365-E-Mail-Rollen"
          titleEn="All Microsoft 365 email roles"
          descriptionDe="Jede dieser Rollen ist im Microsoft-365-Postfachformular als eigener Verwendungszweck auswählbar. Die Adresse ist entweder fest, ein Standardwert oder wird vom Administrator beim Anlegen des Postfachs eingetragen."
          descriptionEn="Each role below is available as a separate purpose in the Microsoft 365 mailbox form. The address is either fixed, a default, or entered by the administrator when adding the mailbox."
        />
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{de ? "Rolle / Postfach" : "Role / mailbox"}</th>
                  <th className="px-4 py-3 font-medium">{de ? "Funktion" : "Function"}</th>
                  <th className="px-4 py-3 font-medium">{de ? "Pfad und Einstellung" : "Path and setting"}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {MICROSOFT_MAILBOX_ROLES.map((role) => (
                  <tr key={role.value} className="align-top">
                    <td className="px-4 py-4">
                      <p className="font-medium">{de ? role.labelDe : role.labelEn}</p>
                      <p className="mt-1 break-words font-mono text-xs text-primary">
                        {de ? role.addressDe : role.addressEn}
                      </p>
                    </td>
                    <td className="px-4 py-4 leading-relaxed text-muted-foreground">
                      {de ? role.functionDe : role.functionEn}
                    </td>
                    <td className="px-4 py-4">
                      <p className="leading-relaxed text-muted-foreground">
                        {de ? role.pathDe : role.pathEn}
                      </p>
                      <code className="mt-2 inline-block max-w-full break-words rounded bg-muted px-2 py-1 text-xs">
                        {de ? role.settingDe : role.settingEn}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <div className="flex gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {de
              ? "Kunden-, Patienten-, Lead- und Lieferantenadressen werden dynamisch aus den jeweiligen Datensätzen verwendet. Beispieladressen aus Formular-Platzhaltern oder Tests sind keine echten Projektpostfächer."
              : "Customer, patient, lead, and supplier addresses are used dynamically from their respective records. Example addresses from form placeholders or tests are not real project mailboxes."}
          </p>
        </div>
      </section>
    </div>
  );
}