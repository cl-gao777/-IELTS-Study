/* eslint-disable @typescript-eslint/no-require-imports -- This offline Node script and its authored data modules intentionally use CommonJS (.cjs). */
/* Rebuild public offline morphology content. No network or database writes.
 * Source research is separate; --refresh-evidence reads the actual local
 * MediaWiki revision responses, never treats a successful URL as verification.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const topics = require('./morphology-topics.cjs');
const notes = require('./morphology-lesson-notes.cjs');
const authoredDistractors = require('./morphology-distractors.cjs');
const { translationIndex, resolveTranslation, assertTranslationCoverage } = require('./morphology-translations.cjs');
const root = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const write = (p,v) => fs.writeFileSync(path.join(root,p),JSON.stringify(v,null,2)+'\n');
const reviewedAt = '2026-10-22';
const translations = translationIndex(read('scripts/morphology-translations.json').entries);
const translatedExampleIds = new Set();
const normal = s => s.trim().toLocaleLowerCase('en').replace(/[’‘]/g,"'").replace(/\s+/g,' ');
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0,16);
const manifestPath='scripts/morphology-source-manifest.json';
const wikiId=(title,language='English')=>`wikt:${normal(title)}:${language.toLowerCase()}`;

if(process.argv.includes('--refresh-evidence')) {
  const pages=new Map(), aliases=[];
  for(const name of fs.readdirSync(path.join(root,'work/morphology')).filter(n=>/^wiki-batch-\d+\.json$/.test(n))) {
    const response=read('work/morphology/'+name);
    if(!response.query?.pages)throw new Error('Invalid MediaWiki response: '+name);
    for(const page of response.query.pages) {
      if(page.missing)continue;
      const revision=page.revisions?.[0], text=revision?.slots?.main?.content;
      if(!revision?.revid||!text)throw new Error('Missing actual source revision: '+page.title);
      for(const language of ['English','Latin','French']) {
        const section=text.match(new RegExp('=='+language+'==\\s*\\n([\\s\\S]*?)(?=\\n==[^=]|$)'))?.[1];
        if(!section)continue;
        const etymologies=[...section.matchAll(/===(Etymology(?: \d+)?)===\s*\n([\s\S]*?)(?=\n===[^=]|$)/g)].map(m=>({location:`${language} → ${m[1]}`,evidence:m[2].split(/\n====/)[0].replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/g,'').replace(/<ref\b[^>]*\/>/g,'').trim()}));
        const definitions=section.split('\n').filter(line=>/^# [^:*]/.test(line)).slice(0,6);
        const value={id:wikiId(page.title,language),title:page.title,language,revision:revision.revid,sourceTimestamp:revision.timestamp,reviewedAt,
          url:`https://en.wiktionary.org/w/index.php?title=${encodeURIComponent(page.title)}&oldid=${revision.revid}#${language}`,
          license:'CC BY-SA 4.0 · Wiktionary contributors',etymologies,definitions};
        pages.set(normal(page.title)+'@'+language,value);
      }
    }
    aliases.push(...(response.query.redirects??[]));
  }
  for(const alias of aliases)for(const language of ['English','Latin','French'])if(pages.has(normal(alias.to)+'@'+language))pages.set(normal(alias.from)+'@'+language,pages.get(normal(alias.to)+'@'+language));
  write(manifestPath,{version:1,reviewedAt,attribution:'Wiktionary contributors, CC BY-SA 4.0; revision-specific links retain attribution and edit history. This source manifest retains dictionary etymology/definition excerpts for verification. Course explanations are original Chinese adaptations. Third-party book/journal example quotations and media are not reused.',sources:Object.fromEntries(pages)});
}

const manifest=read(manifestPath).sources;
const get=(title,language='English')=>{
  const source=manifest[normal(title)+'@'+language];
  if(!source)throw new Error(`Unverified source: ${title} (${language})`);
  return source;
};
const aux={
  benefit:[['beneficium','Latin']],beneficial:[['beneficium','Latin']],benevolent:[['benevolens','Latin']],capture:[['captura','Latin']],concept:[['concipio','Latin']],succession:[['successio','Latin']],biography:[['biographia','Latin']],demographic:[['demography']],document:[['documentum','Latin']],efficient:[['efficio','Latin']],genetic:[['genesis']],dehydration:[['hydration']],jurisdiction:[['iurisdictio','Latin']],jurisprudence:[['iurisprudentia','Latin']],adjoin:[['adiungo','Latin']],bilingual:[['lingual']],multilingual:[['lingual']],literacy:[['literate']],luminous:[['lumen','Latin']],maritime:[['maritimus','Latin']],memorial:[['memorialis','Latin']],morphology:[['morpho-']],morphological:[['morphology'],['morpho-']],psychiatrist:[['psychiatry']],respiration:[['respiratio','Latin']],stability:[['stabilis','Latin']],stable:[['stabilis','Latin']],territory:[['territorium','Latin']],vocabulary:[['vocabularium','Latin']],conservation:[['conserve'],['conservo','Latin']],intervention:[['intervenio','Latin']],destruction:[['destructio','Latin']],expedition:[['expeditio','Latin']],hypodermic:[['hypodermis']],hypoglycaemia:[['hypoglycemia']],funding:[['-ing'],['fund']],training:[['-ing'],['train']],manufacturing:[['-ing'],['manufacture']],modernise:[['modernize']],standardise:[['standardize']],specialise:[['specialize']],neighbourhood:[['neighborhood']],
  'pro-environmental':[['pro-'],['environmental']],
};
const catalog=read('src/data/vocabulary-catalog.json').entries;
const authored=new Map(fs.readFileSync(path.join(root,'scripts/morphology-authored-words.tsv'),'utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>{
  const [term,partOfSpeech,meaningZh,definitionEn,...sentences]=line.split('|');
  if(sentences.length!==2)throw new Error('Authored example count: '+term);
  return [term,{term,partOfSpeech,meaningZh,definitionEn,sentences}];
}));
const exemplarData=read('scripts/morphology-exemplar.json');
const exemplar=exemplarData.lessons?.[0]??exemplarData;
const cefrPath='scripts/morphology-cefr-facts.json';
if(process.argv.includes('--refresh-evidence'))write(cefrPath,read('work/morphology/cefr-reference.json'));
const cefr=read(cefrPath);
const knownBasic=new Set('action active audience biology capture include exclude credit cycle recycle predict doctor document introduce reduce equal equality factory final finish flexible reform transform uniform geography gradual graduate graphic paragraph photograph select collection election liberty local locate location manual memory mobile motion sense correct regular structure direct temporary territory visible vision vocabulary automatic absent impossible unfair uncertain freedom kingdom employee researcher translator bakery cultural historical increasingly awareness willingness risky wealthy booklet leaflet training'.split(' '));
const extras={
  root:{'act':['act-','ag-'],'cap-cept':['cap-','capt-','cept-'],'curs':['cur-','curr-','curs-'],'form':['form-'],'grad-gress':['grad-','gradi-','gress-'],'hydr':['hydr-','hydro-'],'ject':['iect-','ject-'],'jur':['jur-','jus-','iur-','iuris-'],'lingu':['lingu-'],'liter':['liter-','litter-'],'man':['manu-'],'mem':['mem-','memor-'],'pos-pon':['pos-','pon-','posit-'],'reg':['reg-','rect-'],'morph':['morph-','morpho-'],'phot':['phot-','photo-'],'therm':['therm-','thermo-']},
  prefix:{ad:['ad-','ac-','af-','ag-','al-','an-','ap-','ar-','as-','at-']},
  suffix:{acy:['-cy','-acy'],ory:['-ory','-tory','-atory'],ous:['-ous','-ious'],ion:['-ion','-tion','-sion','-ation']}
};
const commonSource={id:'grammar:cambridge:word-formation',title:'Cambridge English Grammar Today · Word formation',url:'https://dictionary.cambridge.org/us/grammar/british-grammar/word-formation_2',reviewedAt,license:'Cambridge University Press & Assessment · 仅引用分类事实，不复制正文或例句',note:'前缀位于基词之前、后缀位于之后；派生与复合等现代构词分类。历史词源不等于现代自由构词。'};
const publicSource={id:'ielts-studio:public-vocabulary',title:'IELTS Studio 公开词汇课包 · 原创中文释义与语境例句',url:'https://github.com/cl-gao777/-IELTS-Study',reviewedAt,license:'CC BY-SA 4.0 · IELTS Studio contributors；公开 NGSL/NAWL 英文释义沿用原课包署名',note:'仅复用 src/data/vocabulary-catalog.json 的公开资料；不读取私人 PDF 或私人课程。具体词性和义项经本次复核，必要处另作原创修正。'};
function dataFor(term){
  if(authored.has(term))return authored.get(term);
  const entry=catalog.find(e=>normal(e.term)===normal(term));
  if(!entry)throw new Error('Missing teaching content: '+term);
  return {...entry,sentences:entry.exercises.slice(0,2).map(e=>e.sentence),registered:entry.exercises.slice(0,2)};
}
function evidenceFor(term){
  const result=[];
  if(term!=='pro-environmental')result.push(get(term));
  for(const args of aux[term]??[])result.push(get(...args));
  return [...new Map(result.map(s=>[s.id,s])).values()];
}
function sourceFor(s){return{id:s.id,title:`Wiktionary contributors · ${s.title} (${s.language})`,url:s.url,reviewedAt:s.reviewedAt,license:s.license,note:`修订 ${s.revision}；${s.etymologies.map(e=>e.location).join('；')||s.language+' → 词性/释义/拼写转引'}。词源与拼写事实改写；不复用词典引用的书刊例句或音频。`};}
function modernDerivation(term,source){
  if(['pro-environmental','funding','training','manufacturing','genetic','modernise'].includes(term))return true;
  const etym=source.etymologies.map(x=>x.evidence).join('\n');
  const direct=/\{\{(?:ety|etymon)\|en\|[^\n}]*:af\|/.test(etym)||/\{\{(?:af|affix|pre|prefix|suf|suffix|confix|com)\|en\|/.test(etym);
  // A surface equivalence attached to a Latin/French borrowing is useful but
  // is not a claim that the English word was originally coined by derivation.
  return direct&&!/\{\{(?:bor\+?|inh\+?|[lu]?bor|[lu]?der)\|en\|[^|}]+|:(?:bor|lbor|uder|inh)\||lang[1-9]=(?:la|grc|fr)|\bBorrowed from\b/.test(etym);
}
function makeWord(term,kind,id,form,meaning,variants){
  const data=dataFor(term), sources=evidenceFor(term), primary=sources[0];
  const levelTerm={modernise:'modernize',standardise:'standardize',specialise:'specialize',neighbourhood:'neighborhood'}[term]??term;
  const level=cefr.find(f=>normal(f.term)===normal(levelTerm)&&f.partOfSpeech===data.partOfSpeech);
  const frozenId=`morph-word:${normal(term)}:${data.partOfSpeech}:${data.meaningZh}`;
  const old=exemplar.words.find(w=>normal(w.term)===normal(term)&&w.partOfSpeech===data.partOfSpeech&&w.meaningZh===data.meaningZh);
  const relation=modernDerivation(term,primary)?'derivation':'etymology';
  const splitVariants=variants.map(v=>v.replace(/-/g,'')).sort((a,b)=>b.length-a.length);
  const matched=splitVariants.find(v=>normal(term).includes(v));
  // A historical stem card is deliberately not presented as a complete modern
  // segmentation. No invented meanings for arbitrary leftover substrings.
  const segments=old?.segments??[{surface:matched??form,meaningZh:`${meaning}（${kind==='root'?'词根／历史词干':kind==='prefix'?'前部成分':'后部成分'}）`}];
  let explanationZh=`${term} 在本课固定学习「${data.meaningZh}」（${data.partOfSpeech}）。${relation==='derivation'?'来源列出英语派生或可产构词关系；':'这是历史词源或借词中的构词联系；'}本课部件提示为「${meaning}」，完整现代词义和搭配以两条例句为准，不能仅凭字面拼接推导。`;
  if(term==='pro-environmental')explanationZh+=' 该整词页未收录；依据已核对的 pro-（支持）及 environmental 构成可产的现代表达，不声称词典已有整词词源条目。';
  if(old)explanationZh=old.explanationZh;
  const examples=data.sentences.map((sentence,index)=>{
    const registered=data.registered?.[index];
    const expression=new RegExp('(?<![A-Za-z])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-z])','i');
    const targetSurface=registered?.targetSurface??sentence.match(expression)?.[0];
    if(!targetSurface)throw new Error(`Missing exact target ${term}: ${sentence}`);
    const oldExample=old?.examples.find(e=>e.sentence===sentence);
    const acceptedAnswers=[targetSurface];
    // These spelling pairs were checked in the canonical spelling entries.
    if(['modernise','standardise','specialise'].includes(term))acceptedAnswers.push(targetSurface.replace(/ise$/,'ize'));
    if(term==='hypoglycaemia')acceptedAnswers.push('hypoglycemia');
    if(term==='neighbourhood')acceptedAnswers.push('neighborhood');
    const exampleId=oldExample?.id??`morph-example:${hash(frozenId+':'+sentence)}`;
    const translation=resolveTranslation(translations,exampleId,sentence,data.meaningZh);
    translatedExampleIds.add(exampleId);
    return{id:exampleId,sentence,targetSurface,acceptedAnswers,meaningZh:translation};
  });
  return{id:old?.id??frozenId,term,partOfSpeech:data.partOfSpeech,meaningZh:data.meaningZh,definitionEn:data.definitionEn,
    level:level?.level??null,levelSource:level?`${level.source} · ${level.url} · ${level.note}；等级对应词＋词性，不声称此处具体义项单独定级。`:'未找到本次已核对的 Oxford B2/C1 词＋词性等级；不推定为基础词。',relation,segments,explanationZh,examples,sourceIds:sources.map(s=>s.id),illustrative:knownBasic.has(term)&&!level};
}
const rootDistractorSets=[['颜色；红色','甜味；味觉','气味；嗅觉'],['金钱；支付','山峰；高度','黑暗；阴影'],['植物；叶片','睡眠；休息','天气；降雨'],['火；燃烧','饥饿；食欲','家庭；亲属']];
const perceptionRoots=new Set(['aud','phon','voc','path','sent-sens','lumin','phot','vid-vis']);
const flattened=Object.entries(topics).flatMap(([kind,text])=>text.split('\n').filter(Boolean).map((line,index)=>{const[id,form,meaningZh,terms]=line.split('|');return{kind,id,form,meaningZh,terms:terms.split(' '),rank:index+1}}));
const lessons=flattened.map((topic,index)=>{
  const {kind,id,form,meaningZh,terms,rank}=topic,note=notes[`${kind}:${id}`];
  if(!note)throw new Error('Missing authored lesson note: '+kind+':'+id);
  const variants=extras[kind]?.[id]??form.split(' / ');
  const words=terms.map(term=>makeWord(term,kind,id,form,meaningZh,variants));
  const wikiSources=terms.flatMap(term=>evidenceFor(term)).map(sourceFor);
  const sources=[...new Map([...wikiSources,commonSource,publicSource].map(source=>[source.id,source])).values()];
  const meaningDistractors=kind==='root'?(perceptionRoots.has(id)?['数量；计数','法律；宣誓','迁移；移动']:rootDistractorSets[index%rootDistractorSets.length]):authoredDistractors[`${kind}:${id}`];
  const answer=terms[terms.length-1];
  const unrelated=flattened.filter(t=>t.kind==='root'&&t.id!==id&&!t.terms.some(term=>terms.includes(term))).map(t=>t.terms[0]).filter(term=>!variants.some(v=>term.includes(v.replace(/-/g,''))));
  const options=[answer,...unrelated.slice((index*3)%Math.max(1,unrelated.length-3),(index*3)%Math.max(1,unrelated.length-3)+3)];
  if(options.length<4)throw new Error('Missing curated family distractors');
  return{id:`morph-${kind}-${id}`,version:3,status:'published',kind,rank,form,titleZh:meaningZh,meaningZh,variants,
    overviewZh:note.overview,spellingZh:note.limits,limitsZh:'构词关系分为现代派生与历史词源，不将熟词强行拆分。'+note.limits+' 本课词＋词性等级仅在有公开依据时标 B2/C1；未定级不等于简单。标为构词示例的词用于说明关系，不自动成为词汇待学词。',meaningDistractors,words,sources,
    structureQuestion:{prompt:'下列哪个词属于本课所学构词部件的词群？',options,answer,explanation:`${answer} 属于本课「${form}」词群。${note.overview} ${note.limits}`}};
});
const errors=[];
if(lessons.length!==160)errors.push('160 lesson count');
for(const[kind,n]of Object.entries({root:80,prefix:40,suffix:40}))if(lessons.filter(l=>l.kind===kind).length!==n)errors.push(kind+' count');
for(const lesson of lessons){
  if(lesson.words.length<3||lesson.words.length>5)errors.push(lesson.id+' word count');
  if(new Set(lesson.meaningDistractors).size!==3||lesson.meaningDistractors.includes(lesson.meaningZh))errors.push(lesson.id+' distractors');
  for(const word of lesson.words){
    if(word.examples.length<2||new Set(word.examples.map(e=>e.sentence)).size<2)errors.push(word.id+' examples');
    if(word.examples.some(e=>!normal(e.sentence).includes(normal(e.targetSurface))||!e.acceptedAnswers.some(a=>normal(a)===normal(e.targetSurface))))errors.push(word.id+' target');
    if(word.sourceIds.some(id=>!lesson.sources.some(s=>s.id===id)))errors.push(word.id+' source');
  }
}
if(errors.length)throw new Error(errors.join('\n'));
assertTranslationCoverage(translations,translatedExampleIds);
const bundle={version:3,lessons};
write('src/data/morphology-curriculum.json',bundle);
const words=lessons.flatMap(l=>l.words),uniqueWords=[...new Map(words.map(w=>[w.id,w])).values()];
const audit={version:3,reviewedAt,lessons:lessons.length,byKind:Object.fromEntries(['root','prefix','suffix'].map(k=>[k,lessons.filter(l=>l.kind===k).length])),wordSlots:words.length,uniqueWordSenses:uniqueWords.length,contextSlots:words.reduce((n,w)=>n+w.examples.length,0),uniqueTranslatedExamples:translatedExampleIds.size,distinctSentences:new Set(words.flatMap(w=>w.examples.map(e=>e.sentence))).size,
  levels:Object.fromEntries(['B2','C1','unknown'].map(level=>[level,uniqueWords.filter(w=>(w.level??'unknown')===level).length])),illustrative:uniqueWords.filter(w=>w.illustrative).length,uniqueSourceRevisions:new Set(lessons.flatMap(l=>l.sources.filter(s=>s.id.startsWith('wikt:')).map(s=>s.url))).size,
  authoredWords:authored.size,publicCatalogWords:uniqueWords.filter(w=>!authored.has(w.term)).length,validationErrors:errors,
  exceptions:['reg-/rect- merged as Latin regō/rēctus; replaced duplicate root slot with rupt-.','livelihood excluded from regular -hood examples; adulthood used.','-cy/-acy, -ous/-ious, -ory/-tory/-atory and -ion/-tion/-sion/-ation variants grouped.','pro-environmental is productive pro- + environmental; actual two component entries cited, no claim of an existing whole-word entry.','hypoglycaemia and modernise cite canonical spelling entries; -ing nouns cite nominal definitions, bases and actual -ing entry.','Each sense has two aligned sentences; mixed-sense catalog entries were replaced with original editorial overrides.'],contentLicense:'CC BY-SA 4.0; application code licence remains separate.'};
write('docs/morphology-content-audit.json',audit);
console.log(JSON.stringify(audit,null,2));
