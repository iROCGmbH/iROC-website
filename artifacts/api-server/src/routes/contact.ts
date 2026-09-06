import { Router, type IRouter } from "express";
import { sendEmail, getEmailDest } from "../lib/email";

const router: IRouter = Router();

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

router.post("/contact", async (req, res) => {
  const { name, email, subject, message, privacyConsent } = req.body as Record<string, unknown>;

  if (
    typeof name !== "string" || !name.trim() ||
    typeof email !== "string" || !isValidEmail(email) ||
    typeof subject !== "string" || !subject.trim() ||
    typeof message !== "string" || message.trim().length < 10 ||
    privacyConsent !== true
  ) {
    res.status(400).json({ error: "Invalid contact form data" });
    return;
  }

  const body = `
Neue Kontaktanfrage über die iROC Website

Name: ${name}
E-Mail: ${email}
Betreff: ${subject}

Nachricht:
${message}

Datenschutz zugestimmt: Ja
  `.trim();

  try {
    const to = await getEmailDest("email_dest_contact", { mailboxPurpose: "website_contact" });
    await sendEmail({
      to,
      subject: `Kontaktanfrage: ${subject} (von ${name})`,
      text: body,
      replyTo: email,
      mailboxPurpose: "website_contact",
    });
  } catch (err) {
    console.error("[contact] Failed to send contact form email:", err);
    res.status(502).json({
      error: err instanceof Error ? err.message : "Contact email delivery failed.",
      code: "EMAIL_DELIVERY_FAILED",
    });
    return;
  }

  res.status(201).json({ message: "Message sent successfully." });
});

export default router;
