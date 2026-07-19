import { describe, expect, it } from 'vitest';
import { availableLocales } from '../i18n';
import {
  getLegalContent,
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR,
  OFFICIAL_FAN_GUIDELINE_URL,
  type LegalDocumentId,
} from '../legalContent';

const documentIds: LegalDocumentId[] = ['overview', 'privacy', 'terms', 'contact'];

describe('public legal content', () => {
  it('publishes the approved operator, contact, and official policy source', () => {
    expect(LEGAL_OPERATOR).toBe('ZUTOMAYO CARD ONLINE Community');
    expect(LEGAL_CONTACT_EMAIL).toBe('contact@mail.zutomayocard.online');
    expect(new URL(OFFICIAL_FAN_GUIDELINE_URL)).toMatchObject({ protocol: 'https:', hostname: 'zutomayo.net' });
  });

  it.each(availableLocales)('has complete public documents for %s', (locale) => {
    const content = getLegalContent(locale);
    expect(content.pageTitle.trim()).not.toBe('');
    expect(content.authoritativeNotice.trim()).not.toBe('');

    for (const id of documentIds) {
      const document = content.documents[id];
      expect(document.title.trim()).not.toBe('');
      expect(document.summary.trim()).not.toBe('');
      expect(document.sections.length).toBeGreaterThanOrEqual(4);
      for (const section of document.sections) {
        expect(section.heading.trim()).not.toBe('');
        expect((section.paragraphs?.length ?? 0) + (section.bullets?.length ?? 0)).toBeGreaterThan(0);
      }
    }
  });
});
