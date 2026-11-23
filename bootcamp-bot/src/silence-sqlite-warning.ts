// node:sqlite의 "실험 기능" 경고 한 줄만 숨긴다. 다른 경고는 그대로 보인다.
const original = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: any[]) => {
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (typeof text === 'string' && text.includes('SQLite is an experimental feature')) return;
  return (original as any)(warning, ...rest);
}) as typeof process.emitWarning;
