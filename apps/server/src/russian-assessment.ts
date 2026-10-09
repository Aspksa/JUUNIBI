/** Closed-world Russian orthography exercises with an explicit local answer key. */
export interface RussianTask { question:string; expected:string; kind:"orthography" }
const words: readonly (readonly [string,string])[]=[
  ["привилегия","превилегия"],
  ["аккуратный","акуратный"],
  ["территория","територия"],
  ["искусство","искуство"],
  ["профессия","професия"],
  ["коллектив","колектив"],
  ["грамматика","граматика"],
  ["апелляция","апеляция"],
];
export function makeRussianTask(turn:number):RussianTask {
  const n=Number.isFinite(turn)?Math.abs(Math.trunc(turn)):0;
  const [correct,wrong]=words[n%words.length]!;
  const swap=n%2===0;
  const first=swap?wrong:correct,second=swap?correct:wrong;
  return {kind:"orthography",question:`Русский язык. Выбери нормативное написание слова: «${first}» или «${second}». Ответь только одним словом, без пояснений.`,expected:correct};
}
export function checkRussianAnswer(task:RussianTask,answer:string):boolean {
  return answer.trim().toLocaleLowerCase("ru-RU")===task.expected;
}
