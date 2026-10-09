/**
 * Masks things that must never leave the machine in a training set: keys, tokens, e-mails, phone and card numbers,
 * and the value after "пароль/password/token". Conservative on purpose: a false positive only costs a masked word.
 */
const RULES: [RegExp, string][] = [
  [/\b(?:sk|pk|rk|ghp|gho|ghs|xox[abp])-?[A-Za-z0-9_-]{12,}\b/g, "[ключ]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [токен]"],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[почта]"],
  [/(?:\+?\d[\s().-]{0,2}){10,}\d/g, "[номер]"],
  [/((?:api[_ -]?key|парол[ьяеи]|password|passwd|token|токен|secret|секрет)\s*(?:[:=]|—|-|это|is)\s*)\S+/gi, "$1[скрыто]"],
];
export function redactSensitive(text: string): string {
  return RULES.reduce((s, [re, to]) => s.replace(re, to), text);
}
/** True when the text contained something that had to be masked. */
export function hadSensitive(text: string): boolean { return redactSensitive(text) !== text; }
