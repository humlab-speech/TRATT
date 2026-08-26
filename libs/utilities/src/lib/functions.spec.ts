import { escapeXmlEntities, escapeHtml, formatMinutesSeconds, padSequenceNumber } from './functions';

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

describe('formatMinutesSeconds', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatMinutesSeconds(0)).toBe('0:00');
    expect(formatMinutesSeconds(65)).toBe('1:05');
    expect(formatMinutesSeconds(3661)).toBe('61:01');
  });
});

describe('padSequenceNumber', () => {
  it('zero-pads to maxDecimals digits', () => {
    expect(padSequenceNumber(3, 4)).toBe('0003');
    expect(padSequenceNumber(42, 4)).toBe('0042');
    expect(padSequenceNumber(10000, 4)).toBe('10000');
  });
});
