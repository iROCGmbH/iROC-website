import { pdf } from '@react-pdf/renderer';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  ConversationDocument,
  parseInline,
  parseMarkdown,
  stripFollowUpMetadata,
} from './ChatbotPDF';

function decodePdfHexText(source: string): string {
  return Array.from(source.matchAll(/<([0-9a-fA-F]+)>/g))
    .map((match) => Buffer.from(match[1], 'hex').toString('latin1'))
    .join('');
}

function normalizePdfText(text: string): string {
  return text.replace(/(?<=[a-z])-(?=[a-z])/gi, '').replace(/\s+/g, ' ');
}

function longBoundaryMessage(): string {
  const paragraphs = Array.from(
    { length: 26 },
    (_, index) =>
      `Paragraph ${index + 1}: Keep the area clean and follow the recovery guidance carefully. **Contact your doctor** if symptoms change.`,
  );

  return [
    '## Recovery steps near the page boundary',
    '',
    'This formatted response starts close to a page boundary and must remain readable when it continues on the next page.',
    '',
    '- Keep the dressing dry.',
    '- Avoid pressure on the treated area.',
    '- Check for increasing redness or swelling.',
    '',
    '1. Rest according to these instructions.',
    '2. Take only the recommended medication.',
    '3. Ask for help if you are unsure what to do.',
    '',
    ...paragraphs,
    '',
    'Final paragraph after the list: the recovery guidance is complete.',
  ].join('\n');
}

describe('Chatbot PDF markdown parser', () => {
  describe('parseInline', () => {
    it('splits bold text into normal and bold segments', () => {
      expect(parseInline('Before **important** after')).toEqual([
        { text: 'Before ', bold: false },
        { text: 'important', bold: true },
        { text: ' after', bold: false },
      ]);
    });

    it('returns plain text as one normal segment', () => {
      expect(parseInline('Nothing is emphasized')).toEqual([
        { text: 'Nothing is emphasized', bold: false },
      ]);
    });
  });

  describe('parseMarkdown', () => {
    it('emits heading, bullet, ordered, paragraph, and spacer blocks', () => {
      expect(
        parseMarkdown(
          '## Heading\n\n- First bullet\n- Second bullet\n\n1. First step\n2. Second step\n\nA paragraph.',
        ),
      ).toEqual([
        { kind: 'heading', text: 'Heading' },
        { kind: 'spacer' },
        { kind: 'bullet', text: 'First bullet' },
        { kind: 'bullet', text: 'Second bullet' },
        { kind: 'spacer' },
        { kind: 'ordered', n: 1, text: 'First step' },
        { kind: 'ordered', n: 2, text: 'Second step' },
        { kind: 'spacer' },
        { kind: 'paragraph', text: 'A paragraph.' },
      ]);
    });

    it('preserves inline markdown in a paragraph followed by a bullet list', () => {
      const blocks = parseMarkdown(
        'Take **care** with the area:\n- Keep it clean\n- Watch for swelling',
      );

      expect(blocks).toEqual([
        { kind: 'paragraph', text: 'Take **care** with the area:' },
        { kind: 'bullet', text: 'Keep it clean' },
        { kind: 'bullet', text: 'Watch for swelling' },
      ]);
      expect(parseInline(blocks[0].kind === 'paragraph' ? blocks[0].text : '')).toEqual([
        { text: 'Take ', bold: false },
        { text: 'care', bold: true },
        { text: ' with the area:', bold: false },
      ]);
    });

    it('keeps saved answer text but omits malformed follow-up metadata', () => {
      const answer = 'The hand should remain elevated.';
      const incomplete = `${answer}\n<!-- SPIRO_FOLLOWUPS: ["When can I work?"`;
      const invalidComplete = `${answer}\n<!-- SPIRO_FOLLOWUPS: not-valid-json -->`;

      expect(stripFollowUpMetadata(incomplete)).toBe(answer);
      expect(stripFollowUpMetadata(invalidComplete)).toBe(answer);
      expect(parseMarkdown(incomplete)).toEqual([
        { kind: 'paragraph', text: answer },
      ]);
      expect(JSON.stringify(parseMarkdown(invalidComplete))).not.toContain('SPIRO_FOLLOWUPS');
    });
  });

  it('omits malformed saved follow-up metadata from the rendered transcript', async () => {
    const answer = 'The hand should remain elevated.';
    const messages = [
      {
        id: 'malformed-follow-ups',
        role: 'assistant' as const,
        content: `${answer}\n<!-- SPIRO_FOLLOWUPS: ["When can I work?"`,
      },
    ];
    const logoDirectory = `${process.cwd()}/public/`;
    const document = createElement(ConversationDocument, {
      messages,
      lang: 'en',
      timestamp: new Date('2026-09-04T10:30:00.000Z'),
      assetBase: logoDirectory,
    }) as Parameters<typeof pdf>[0];
    const source = await pdf(document).toString();
    const renderedText = normalizePdfText(decodePdfHexText(source));

    expect(renderedText).toContain(answer);
    expect(renderedText).not.toContain('SPIRO_FOLLOWUPS');
    expect(renderedText).not.toContain('When can I work?');
  });

  it('keeps answer text selectable while omitting valid follow-up metadata', async () => {
    const answer = 'Keep the treated area dry and contact your doctor if swelling increases.';
    const followUp = 'When can I return to work?';
    const messages = [{
      id: 'valid-follow-ups',
      role: 'assistant' as const,
      content: `${answer}\n<!-- SPIRO_FOLLOWUPS: ${JSON.stringify([followUp])} -->`,
    }];
    const document = createElement(ConversationDocument, {
      messages,
      lang: 'en',
      timestamp: new Date('2026-09-04T10:30:00.000Z'),
      assetBase: `${process.cwd()}/public/`,
    }) as Parameters<typeof pdf>[0];
    const source = await pdf(document).toString();
    const renderedText = normalizePdfText(decodePdfHexText(source));

    // Text operators in the downloaded PDF preserve copy/select semantics;
    // this would fail if the message were rasterized into an image.
    expect(source).toMatch(/BT[\s\S]*ET/);
    expect(renderedText).toContain(answer);
    expect(renderedText).not.toContain('SPIRO_FOLLOWUPS');
    expect(renderedText).not.toContain(followUp);
  });

  it('keeps long formatted messages and fixed footers intact across page breaks', async () => {
    const messages = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `intro-${index}`,
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `Earlier conversation message ${index + 1}.`,
      })),
      {
        id: 'boundary-message',
        role: 'assistant' as const,
        content: longBoundaryMessage(),
      },
    ];

    const logoDirectory = `${process.cwd()}/public/`;
    const document = createElement(ConversationDocument, {
      messages,
      lang: 'en',
      timestamp: new Date('2026-09-04T10:30:00.000Z'),
      assetBase: logoDirectory,
    }) as Parameters<typeof pdf>[0];
    const source = await pdf(document).toString();
    const pageCount = (source.match(/\/Type\s*\/Page\b/g) ?? []).length;
    const renderedText = normalizePdfText(decodePdfHexText(source));

    expect(pageCount).toBeGreaterThan(1);
    expect(renderedText).toContain('Recovery steps near the page boundary');
    expect(renderedText).toContain('Keep the dressing dry.');
    expect(renderedText).toContain('Rest according to these instructions.');
    expect(renderedText).toContain('Final paragraph after the list');
    expect((renderedText.match(/Spiro/g) ?? []).length).toBe(pageCount);
  });
});