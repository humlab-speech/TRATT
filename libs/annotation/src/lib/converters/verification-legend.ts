/**
 * Språkbanken graphic profile colours
 * (https://sprakbanken.se/internt/teknik/grafisk-profil): "Grön" for
 * verified transcriptions, "sborange" for non-verified ones.
 */
export const VERIFIED_COLOR = '5AA018';
export const NON_VERIFIED_COLOR = 'F0581A';

/**
 * One-line key placed at the top of Word and ODT exports, explaining the
 * coloured "|" that starts each transcription line.
 */
export function verificationLegend(
  swedish: boolean,
): { text: string; color?: string }[] {
  return swedish
    ? [
        { text: 'Grönt ' },
        { text: '|', color: VERIFIED_COLOR },
        {
          text: ' = verifierad transkription (avlyssnad eller redigerad av en person). Orange ',
        },
        { text: '|', color: NON_VERIFIED_COLOR },
        { text: ' = ännu inte verifierad (automatisk utdata).' },
      ]
    : [
        { text: 'Green ' },
        { text: '|', color: VERIFIED_COLOR },
        {
          text: ' = verified transcription (listened to or edited by a person). Orange ',
        },
        { text: '|', color: NON_VERIFIED_COLOR },
        { text: ' = not yet verified (automatic output).' },
      ];
}
