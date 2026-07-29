export function toHalfwidthAscii(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/gu, ' ');
}
