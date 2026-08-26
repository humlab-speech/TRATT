import { escapeXmlEntities, escapeHtml } from './functions';

describe('escapeXmlEntities', () => {
  it('escapes the 5 reserved characters with the given apostrophe entity', () => {
    expect(escapeXmlEntities(`<a href="x">it's & "that"</a>`, '&apos;')).toBe(
      '&lt;a href=&quot;x&quot;&gt;it&apos;s &amp; &quot;that&quot;&lt;/a&gt;',
    );
  });

  it('escapeHtml delegates with the HTML apostrophe entity', () => {
    expect(escapeHtml(`it's`)).toBe('it&#039;s');
  });
});
