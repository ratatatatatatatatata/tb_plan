// Private practice content. This module and its inputs are never public assets.
export function privateContent({worksheet_text='',quiz=[]}={}){
  if(typeof worksheet_text!=='string'||worksheet_text.length>6000)throw new Error('Private worksheet must be plain text of at most 6000 characters.');
  if(!Array.isArray(quiz)||![0,2].includes(quiz.length))throw new Error('A private lesson quiz must contain exactly two questions, or be omitted.');
  for(const item of quiz){
    if(!item||Array.isArray(item)||typeof item!=='object'||Object.keys(item).sort().join('|')!=='answer_index|explanation|options|question')throw new Error('Private quiz question has unsupported fields.');
    if(typeof item.question!=='string'||item.question.length<1||item.question.length>1000||typeof item.explanation!=='string'||item.explanation.length<1||item.explanation.length>2000)throw new Error('Invalid private quiz question/explanation.');
    if(!Array.isArray(item.options)||item.options.length<2||item.options.length>6||item.options.some(x=>typeof x!=='string'||x.length<1||x.length>600)||!Number.isInteger(item.answer_index)||item.answer_index<0||item.answer_index>=item.options.length)throw new Error('Invalid private quiz choices/answer.');
  }
  return {worksheet_text,quiz};
}
