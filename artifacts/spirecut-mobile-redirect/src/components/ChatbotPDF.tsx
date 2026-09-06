/**
 * ChatbotPDF — renders a Spirecut chatbot conversation as a downloadable PDF.
 * Uses @react-pdf/renderer for consistent, print-ready output.
 */

// @ts-nocheck
// @react-pdf/renderer's published React 19 component typings are incompatible
// with this workspace's JSX checker; Vite still validates and bundles this UI.
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  PDFDownloadLink,
} from '@react-pdf/renderer';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// ── Colours ────────────────────────────────────────────────────────────────────

const TEAL   = '#0D7D8A';  // Spirecut primary
const NAVY   = '#0A3D5C';
const GRAY   = '#333333';
const LGRAY  = '#666666';
const BGUSER = '#E8F6F8';
const BGBOT  = '#F4F4F5';
const BORDER = '#D1D5DB';

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 40,
    paddingTop: 32,
    paddingBottom: 40,
    fontFamily: 'Helvetica',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1.5,
    borderBottomColor: TEAL,
    paddingBottom: 10,
    marginBottom: 16,
  },
  logo: {
    height: 30,
    objectFit: 'contain',
    objectPositionX: 'left',
    maxWidth: 160,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
  },
  headerSub: {
    fontSize: 8,
    color: LGRAY,
    marginTop: 2,
  },

  // Disclaimer banner
  disclaimer: {
    backgroundColor: '#FFF8E7',
    borderWidth: 1,
    borderColor: '#F0C040',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 16,
  },
  disclaimerText: {
    fontSize: 7.5,
    color: '#7A5800',
    lineHeight: 1.5,
  },

  // Messages
  messageWrap: {
    marginBottom: 10,
  },
  roleLabelUser: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: TEAL,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
    textAlign: 'right',
  },
  roleLabelBot: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  bubbleUser: {
    backgroundColor: BGUSER,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: 'flex-end',
    maxWidth: '80%',
  },
  bubbleBot: {
    backgroundColor: BGBOT,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: 'flex-start',
    maxWidth: '80%',
    borderLeftWidth: 2,
    borderLeftColor: TEAL,
  },
  bubbleTextUser: {
    fontSize: 9.5,
    color: GRAY,
    lineHeight: 1.55,
    textAlign: 'right',
  },
  bubbleTextBot: {
    fontSize: 9.5,
    color: GRAY,
    lineHeight: 1.55,
  },

  // Markdown block styles (used inside bot bubble)
  mdHeading: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    lineHeight: 1.4,
    marginTop: 3,
    marginBottom: 2,
  },
  mdParagraph: {
    fontSize: 9.5,
    color: GRAY,
    lineHeight: 1.55,
    marginBottom: 1,
  },
  mdListRow: {
    flexDirection: 'row',
    marginBottom: 1,
  },
  mdBullet: {
    fontSize: 9.5,
    color: TEAL,
    lineHeight: 1.55,
    width: 12,
    flexShrink: 0,
  },
  mdListText: {
    fontSize: 9.5,
    color: GRAY,
    lineHeight: 1.55,
    flex: 1,
  },
  mdSpacer: {
    height: 4,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7,
    color: LGRAY,
  },
});

// ── Markdown renderer ──────────────────────────────────────────────────────────

/**
 * Parses inline text with **bold** markers into an array of
 * { text, bold } segments.
 */
function parseInline(text: string): Array<{ text: string; bold: boolean }> {
  const parts: Array<{ text: string; bold: boolean }> = [];
  // Split on **...**
  const segments = text.split(/\*\*(.+?)\*\*/g);
  // split with a capture group: odd indices are the captured bold content
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === '') continue;
    parts.push({ text: segments[i], bold: i % 2 === 1 });
  }
  return parts;
}

/**
 * Renders inline text with bold support as nested <Text> spans.
 */
function InlineText({ text, style }: { text: string; style: ReturnType<typeof StyleSheet.create>[string] }) {
  const parts = parseInline(text);
  if (parts.length === 1 && !parts[0].bold) {
    // Fast path: no bold formatting
    return <Text style={style}>{parts[0].text}</Text>;
  }
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.bold ? (
          <Text key={i} style={{ fontFamily: 'Helvetica-Bold' }}>{p.text}</Text>
        ) : (
          <Text key={i}>{p.text}</Text>
        )
      )}
    </Text>
  );
}

type MdBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'ordered'; n: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'spacer' };

/**
 * Parses a markdown string into a list of block descriptors.
 */
function parseMarkdown(content: string): MdBlock[] {
  const lines = content.split('\n');
  const blocks: MdBlock[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Empty line → spacer (collapse consecutive empties later)
    if (line.trim() === '') {
      if (blocks.length > 0 && blocks[blocks.length - 1].kind !== 'spacer') {
        blocks.push({ kind: 'spacer' });
      }
      continue;
    }

    // Heading: ## or # (treat both as same heading style)
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ kind: 'heading', text: headingMatch[1].trim() });
      continue;
    }

    // Unordered bullet: - item or * item
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({ kind: 'bullet', text: bulletMatch[1] });
      continue;
    }

    // Ordered list: 1. item
    const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      blocks.push({ kind: 'ordered', n: parseInt(orderedMatch[1], 10), text: orderedMatch[2] });
      continue;
    }

    // Plain paragraph
    blocks.push({ kind: 'paragraph', text: line });
  }

  return blocks;
}

/**
 * Renders markdown content as a series of @react-pdf/renderer Views/Texts
 * inside the bot bubble.
 */
function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdown(content);

  return (
    <View>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'spacer':
            return <View key={i} style={s.mdSpacer} />;

          case 'heading':
            return (
              <InlineText key={i} text={block.text} style={s.mdHeading} />
            );

          case 'bullet':
            return (
              <View key={i} style={s.mdListRow}>
                <Text style={s.mdBullet}>{'\u2022'}</Text>
                <InlineText text={block.text} style={s.mdListText} />
              </View>
            );

          case 'ordered':
            return (
              <View key={i} style={s.mdListRow}>
                <Text style={s.mdBullet}>{block.n}.</Text>
                <InlineText text={block.text} style={s.mdListText} />
              </View>
            );

          case 'paragraph':
            return (
              <InlineText key={i} text={block.text} style={s.mdParagraph} />
            );

          default:
            return null;
        }
      })}
    </View>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTimestamp(date: Date, lang: 'de' | 'en'): string {
  try {
    const locale = lang === 'de' ? 'de-DE' : 'en-GB';
    const dateStr = date.toLocaleDateString(locale, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    const timeStr = date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${dateStr}, ${timeStr}`;
  } catch {
    return date.toISOString();
  }
}

function getAssetBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${import.meta.env.BASE_URL}`;
  }
  return import.meta.env.BASE_URL;
}

// ── PDF Document ───────────────────────────────────────────────────────────────

interface ConversationDocProps {
  messages: ChatMessage[];
  lang: 'de' | 'en';
  timestamp: Date;
  assetBase: string;
}

function ConversationDocument({ messages, lang, timestamp, assetBase }: ConversationDocProps) {
  const ts = formatTimestamp(timestamp, lang);

  const headerTitle =
    lang === 'de' ? 'Gesprächszusammenfassung' : 'Conversation Summary';
  const generatedLabel =
    lang === 'de' ? `Erstellt am: ${ts}` : `Generated: ${ts}`;
  const disclaimerText =
    lang === 'de'
      ? 'Dieser Assistent ersetzt keine ärztliche Beratung. Die Inhalte dienen nur zur allgemeinen Information. Bei medizinischen Fragen wenden Sie sich bitte an Ihren Arzt.'
      : 'This assistant does not replace medical advice. The content is for general information only. For medical concerns, please consult your physician.';
  const userLabel = lang === 'de' ? 'Sie' : 'You';
  const botLabel = 'Spiro';
  const footerLeft = lang === 'de' ? 'Spiro \u2013 Spirecut\u00AE Patientenassistent' : 'Spiro \u2013 Spirecut\u00AE Patient Assistant';
  const footerRight = lang === 'de' ? 'Nur zur Information \u00B7 Kein Ersatz f\u00FCr \u00E4rztlichen Rat' : 'For information only \u00B7 Not a substitute for medical advice';

  return (
    <Document
      title={headerTitle}
      author="Spirecut"
      creator="Spirecut Patient Portal"
    >
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.header}>
          <Image style={s.logo} src={`${assetBase}spirecut-logo-full.png`} />
          <View style={s.headerRight}>
            <Text style={s.headerTitle}>{headerTitle}</Text>
            <Text style={s.headerSub}>{generatedLabel}</Text>
          </View>
        </View>

        {/* Disclaimer */}
        <View style={s.disclaimer}>
          <Text style={s.disclaimerText}>{disclaimerText}</Text>
        </View>

        {/* Messages */}
        {messages.map((msg) => (
          <View key={msg.id} style={s.messageWrap} wrap={false}>
            {msg.role === 'user' ? (
              <>
                <Text style={s.roleLabelUser}>{userLabel}</Text>
                <View style={s.bubbleUser}>
                  <Text style={s.bubbleTextUser}>{msg.content}</Text>
                </View>
              </>
            ) : (
              <>
                <Text style={s.roleLabelBot}>{botLabel}</Text>
                <View style={s.bubbleBot}>
                  <MarkdownContent content={msg.content} />
                </View>
              </>
            )}
          </View>
        ))}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{footerLeft}</Text>
          <Text style={s.footerText}>{footerRight}</Text>
        </View>

      </Page>
    </Document>
  );
}

// ── Download Button ────────────────────────────────────────────────────────────

interface DownloadButtonProps {
  messages: ChatMessage[];
  lang: 'de' | 'en';
  className?: string;
  children: React.ReactNode;
}

export function ChatbotPDFDownload({ messages, lang, className, children }: DownloadButtonProps) {
  const now = new Date();
  const assetBase = getAssetBase();

  // Build filename: Spirecut-Gesprach-YYYY-MM-DD.pdf
  const dateStr = now.toISOString().slice(0, 10);
  const fileName = `Spirecut-Gesprach-${dateStr}.pdf`;

  const doc = (
    <ConversationDocument
      messages={messages}
      lang={lang}
      timestamp={now}
      assetBase={assetBase}
    />
  );

  return (
    <PDFDownloadLink document={doc} fileName={fileName} className={className}>
      {({ loading }) =>
        loading ? (
          <span style={{ opacity: 0.6 }}>{children}</span>
        ) : (
          <span>{children}</span>
        )
      }
    </PDFDownloadLink>
  );
}
