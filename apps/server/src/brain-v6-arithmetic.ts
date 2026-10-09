/** Only bounded integer equations can be deterministically corrected. */
export function verifyIntegerEquation(text: string) {
 const m=/^\s*(-?\d{1,6})\s*([+*×-])\s*(-?\d{1,6})\s*=\s*(-?\d{1,12})\s*$/.exec(text);
 if(!m) return {verifiable:false as const};
 const a=Number(m[1]),b=Number(m[3]),claimed=Number(m[4]);
 const expected=m[2]==="+"?a+b:m[2]==="-"?a-b:a*b;
 if(!Number.isSafeInteger(expected)) return {verifiable:false as const};
 return {verifiable:true as const,correct:claimed===expected,expected,proposedCorrection:claimed===expected?null:String(expected)};
}
