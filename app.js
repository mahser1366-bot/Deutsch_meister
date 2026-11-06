import {openDB,setDB,all,put,remove,clear,getSetting,setSetting,saveReview} from './db.js';
// All learning content comes from the learner's own vocabulary.
import {today,isDue,schedule,ensureSchedules} from './scheduler.js';
import {parseCSV,escapeCSVCell} from './csv.js';
import {stripArticle,formatPlural,pluralOptions,getArticle,inferPartOfSpeech,buildVerbBank,buildVerbQuestions,uniqueOptions,shuffle} from './challenges.js';
import {prepareVoiceModels, speakNeural, terminateNeuralWorker, deleteNeuralVoice} from './voice-manager.js';
const $=id=>document.getElementById(id),uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;
let words=[],settings={},logs=[],sessions=[],currentView='home',studyQueue=[],studyIndex=0,currentWord=null,exercise=null,toastTimer,libraryLimit=100;
const voiceModelReady={jarvis:false,amy:false};const voiceModelState={jarvis:'Preparing',amy:'Preparing'};let voiceSetupRunning=false,voiceSetupRetryRequested=false,voiceFailureShown=false;
function applyLanguage(){document.documentElement.lang='en';}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2400)}
function activeWords(){return words.filter(w=>w.active!==false)}
function dueWords(){const method=settings.algorithm||'sm2';return activeWords().filter(w=>isDue(w,method)).sort((a,b)=>(a.scheduling?.[method]?.dueDate||a.dueDate||'').localeCompare(b.scheduling?.[method]?.dueDate||b.dueDate||''))}
function reviewedToday(){const seen=new Set();for(const log of logs)if(log.date===today()&&log.type==='review')seen.add(log.wordId);return seen.size}
function streak(){
 const byDate=new Map(),cutoff=settings.v3StartedOn||today();
 for(const log of logs){
  let day=byDate.get(log.date);if(!day){day={legacy:false,quiz:false,reviews:new Set()};byDate.set(log.date,day);}
  if(log.type==='legacy'){day.legacy=true;continue;}
  if(log.legacy||log.date<cutoff)continue;
  if(log.type==='quiz'&&(Number(log.total||0)>0||log.legacy))day.quiz=true;
  if(log.type==='review'&&log.wordId)day.reviews.add(log.wordId);
 }
 const days=[...byDate.entries()].filter(([,v])=>v.legacy||v.quiz||v.reviews.size>=5).map(([date])=>date).sort();
 const set=new Set(days);let current=0,d=new Date();if(!set.has(today()))d.setDate(d.getDate()-1);
 for(;;){const key=localDate(d);if(set.has(key)){current++;d.setDate(d.getDate()-1);}else break;}
 let best=0,run=0,previous=null;for(const date of days){const dt=new Date(date+'T12:00:00');if(previous&&Math.round((dt-previous)/86400000)===1)run++;else run=1;best=Math.max(best,run);previous=dt;}
 return {current,best};
}
async function init(){
 try{
  try{localStorage.removeItem('deutsch-meister-piper-preloaded-v1')}catch{}
  const db=await openDB();setDB(db);
  [words,logs,sessions]=await Promise.all([all('words'),all('reviewLogs'),all('sessions')]);
  settings={theme:await getSetting('theme','dark'),dailyGoal:await getSetting('dailyGoal',10),algorithm:await getSetting('algorithm','sm2'),speechRate:await getSetting('speechRate',.88),germanVoiceMode:await getSetting('germanVoiceMode','system'),englishVoiceMode:await getSetting('englishVoiceMode','system'),voiceModelsDisabled:await getSetting('voiceModelsDisabled',false),v3StartedOn:await getSetting('v3StartedOn',null)};
  if(!settings.v3StartedOn){settings.v3StartedOn=today();await setSetting('v3StartedOn',settings.v3StartedOn);}
  await migrateLegacyHistory();
  words=await all('words');
  // Add missing schedule branches without replacing existing user records or history.
  for(const w of words){const upgraded=ensureSchedules(w,settings.algorithm);if(JSON.stringify(upgraded.scheduling)!==JSON.stringify(w.scheduling||{}))await put('words',upgraded);}
  words=await all('words');applyTheme();applyLanguage();bind();renderAll();
  registerOfflineWorker();
  window.addEventListener('online',()=>{if(navigator.serviceWorker?.controller){if(voiceSetupRunning)voiceSetupRetryRequested=true;else startVoiceModelSetup();}});
  window.addEventListener('pagehide',terminateNeuralWorker);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')terminateNeuralWorker();});
 }catch(e){
  console.error('Deutsch Meister startup failed:',e);
  const host=document.getElementById('main');
  if(host){host.innerHTML=`<section class="startup-error"><h1>Deutsch Meister could not start</h1><p>${esc(e?.message||String(e))}</p><p>Your browser storage may be unavailable or blocked. Open the app from its HTTPS address and reload.</p><button class="button button-outline" onclick="location.reload()">Reload app</button></section>`;}
 }
}

let offlineWorkerRegistered=false;
async function registerOfflineWorker(){
 if(!('serviceWorker'in navigator)||!location.protocol.startsWith('http')){
  setVoiceStatus('System voices are available. Offline neural voices require a supported browser.');
  return;
 }
 const startWhenControlled=()=>{
  if(!navigator.serviceWorker.controller||offlineWorkerRegistered)return;
  offlineWorkerRegistered=true;
  startVoiceModelSetup();
 };
 navigator.serviceWorker.addEventListener('controllerchange',startWhenControlled);
 try{
  await navigator.serviceWorker.register('./sw.js');
  await navigator.serviceWorker.ready;
  startWhenControlled();
  if(!navigator.serviceWorker.controller){
   setVoiceStatus('System voices are ready. Preparing offline voice storage…');
   setTimeout(()=>{
    if(!navigator.serviceWorker.controller)setVoiceStatus('System voices are ready. Reload once to prepare offline neural voices.');
   },10000);
  }
 }catch(error){
  console.warn('Offline cache could not be prepared:',error);
  setVoiceStatus('System voices are available. Offline neural voices could not be prepared.');
 }
}
async function migrateLegacyHistory(){if(await getSetting('v3HistoryMigrated',false))return;const legacyActivity=await getSetting('activityByDate',{}),legacyStreak=await getSetting('streakDays',[]);for(const [date,entry] of Object.entries(legacyActivity||{})){for(const wordId of entry.reviewedWordIds||[]){await put('reviewLogs',{id:`v2-review-${date}-${wordId}`,date,type:'review',wordId,rating:'legacy',legacy:true});}for(let i=0;i<(entry.quizzes||0);i++){await put('reviewLogs',{id:`v2-quiz-${date}-${i}`,date,type:'quiz',correct:0,total:0,legacy:true});}}for(const date of legacyStreak||[]){await put('reviewLogs',{id:`v2-streak-${date}`,date,type:'legacy'});}logs=await all('reviewLogs');await setSetting('v3HistoryMigrated',true);}
function applyTheme(){const t=settings.theme||'dark';document.body.classList.toggle('light',t==='light'||(t==='system'&&matchMedia('(prefers-color-scheme: light)').matches));$('themeSelect').value=t;}
function renderAll(){renderHome();if(currentView==='home')renderLearn();if(currentView==='library')renderLibrary();if(currentView==='progress')renderProgress();if(currentView==='settings')renderImportBatches();renderPracticeAvailability();$('dailyGoalSelect').value=String(settings.dailyGoal||10);$('algorithmSelect').value=settings.algorithm||'sm2';$('speechRate').value=String(settings.speechRate||.88);$('themeSelect').value=settings.theme||'dark';renderVoiceSettings();}
function renderHome(){const active=activeWords(),due=dueWords(),goal=Number(settings.dailyGoal||10),done=reviewedToday(),st=streak(),mastered=active.filter(w=>{const x=w.scheduling?.[settings.algorithm]||w;return settings.algorithm==='leitner'?(x.box||0)>=5:(x.interval||0)>=14;}).length;$('homeWords').textContent=active.length;$('homeDue').textContent=due.length;$('homeMastered').textContent=mastered;$('homeStreak').textContent=`${st.current} ${st.current===1?'day':'days'}`;$('goalNumber').textContent=`${done} / ${goal}`;$('goalBar').style.width=`${Math.min(100,done/goal*100)}%`;$('goalPercent').textContent=`${Math.min(100,Math.round(done/goal*100))}%`;$('goalCaption').textContent=done>=goal?'Daily goal complete — excellent work.':'A focused session is a good start.';$('homeFocusText').textContent=due.length?`You have ${due.length} ${due.length===1?'word':'words'} ready. A few minutes is enough to make progress.`:'No reviews are due right now. Add words or try a short practice quiz.';$('startReview').disabled=due.length===0||!!currentWord;$('startReview').textContent=due.length?'Start review →':'No review due';}
function renderLearn(){const due=dueWords();const hasCurrent=!!currentWord;$('learnEmpty').hidden=due.length>0||hasCurrent;$('studyCard').hidden=!hasCurrent;$('sessionProgress').hidden=!hasCurrent;$('sessionProgress').textContent=hasCurrent?`Review ${studyIndex+1} of ${studyQueue.length}`:'';$('homeView').classList.toggle('reviewing',hasCurrent);document.body.classList.toggle('reviewing-session',hasCurrent);if(hasCurrent)showStudyWord();}
function startStudy(){studyQueue=dueWords();studyIndex=0;currentWord=studyQueue[0]||null;showView('home');renderLearn();if(!currentWord)toast('No reviews due. Add vocabulary or try Practice.');}
function showStudyWord(){
 const w=currentWord;if(!w)return;
 $('studyGerman').textContent=w.german||'';
 const pos=String(w.partOfSpeech||inferPartOfSpeech(w)||'').trim();
 $('studyMeta').textContent=[pos,getArticle(w),w.plural].filter(Boolean).join(' · ');
 $('studyLevel').textContent='YOUR WORD';
 $('studyCounter').textContent=`${studyIndex+1} / ${studyQueue.length}`;
 $('studyTranslation').textContent=w.translation||'No English meaning provided.';
 $('studyPersianTranslation').textContent=w.translationFa||'';$('studyPersianBlock').hidden=!(w.translationFa||'').trim();
 $('studyTranslationSpeak').disabled=!w.translation;
 $('studyExample').textContent=w.example||'';
 $('studyExampleEn').textContent=w.exampleEn||'';
 $('studyGermanExampleBlock').hidden=!(w.example||'').trim();
 $('studyEnglishExampleBlock').hidden=!(w.exampleEn||'').trim();
 $('studyExampleSpeakDe').disabled=!(w.example||'').trim();
 $('studyExampleSpeakEn').disabled=!(w.exampleEn||'').trim();
 const dictionary=safeDictionaryHref(w.dictionaryUrl);
 const link=$('studyDictionaryLink');link.hidden=!dictionary;if(dictionary)link.href=dictionary;else link.removeAttribute('href');
 $('studyTranslationSpeak').onclick=()=>speak(w.translation,'en');
 $('studyExampleSpeakDe').onclick=()=>speak(w.example,'de');
 $('studyExampleSpeakEn').onclick=()=>speak(w.exampleEn,'en');
 $('studyCard').classList.remove('is-flipped','card-swipe-out');$('revealAnswer').hidden=false;
}
async function rateWord(rating){if(!currentWord||$('studyCard').classList.contains('card-swipe-out'))return;const direction=rating==='again'||rating==='hard'?'left':'right';$('studyCard').classList.add('card-swipe-out',`swipe-${direction}`);await new Promise(resolve=>setTimeout(resolve,230));try{const updated=schedule(currentWord,rating,settings.algorithm);const log={id:uid(),date:today(),type:'review',wordId:currentWord.id,rating,algorithm:settings.algorithm};await saveReview(updated,log);words=words.map(w=>w.id===updated.id?updated:w);logs.push(log);studyIndex++;currentWord=studyQueue[studyIndex]||null;if(currentWord)showStudyWord();else{toast('Study session complete. Nice work!');currentWord=null;$('studyCard').hidden=true;$('learnEmpty').hidden=false;}renderHome();renderLearn();if(currentView==='progress')renderProgress();}catch(error){$('studyCard').classList.remove('card-swipe-out','swipe-left','swipe-right');console.error('Could not save review:',error);toast('Your review could not be saved. Please try again.');}}
function renderLibrary(){
 const q=$('wordSearch').value.toLocaleLowerCase();
 const personal=words.filter(w=>!q||[w.german,w.translation,w.translationFa,w.article,w.plural,w.partOfSpeech,w.example,w.exampleEn,w.notes,w.level,w.prateritum,w.perfekt,...(w.tags||[]),w.presentIch,w.presentDu,w.presentEr,w.presentWir,w.presentIhr,w.presentSie].filter(Boolean).join(' ').toLocaleLowerCase().includes(q));
 const visible=personal.slice(0,libraryLimit);
 $('personalWordList').innerHTML=visible.length?visible.map(w=>`<article class="word-row"><div class="word-main"><b>${esc(w.german)}</b><small>${esc(w.translation||'')}${w.translationFa?' · '+esc(w.translationFa):''}${w.level?' · '+esc(w.level):''}${w.article?' · '+esc(w.article):''}${safeDictionaryHref(w.dictionaryUrl)?' · <a class="dictionary-link" href="'+esc(safeDictionaryHref(w.dictionaryUrl))+'" target="_blank" rel="noopener noreferrer">Dictionary ↗</a>':''}</small></div><div class="word-actions"><button data-edit="${esc(w.id)}" aria-label="Edit word">✎</button><button data-delete="${esc(w.id)}" aria-label="Delete word">×</button></div></article>`).join(''):'<div class="empty-inline">No words found. Add a word or import your CSV file.</div>';
 const more=$('loadMoreWords');if(more){more.hidden=visible.length>=personal.length;more.textContent=`Show ${Math.min(100,personal.length-visible.length)} more (${personal.length-visible.length} remaining)`;}
 const count=$('libraryCount');if(count)count.textContent=`${personal.length} ${personal.length===1?'word':'words'}`;
}
function renderProgress(){
 const st=streak(),active=activeWords(),method=settings.algorithm||'sm2';
 const quizLogs=logs.filter(x=>x.type==='quiz'),correct=quizLogs.reduce((n,x)=>n+(x.correct||0),0),answered=quizLogs.reduce((n,x)=>n+(x.total||0),0);
 const states=active.map(w=>ensureSchedules(w,method).scheduling[method]);
 const mastered=states.filter(x=>method==='leitner'?(x.box||1)>=5:(x.interval||0)>=14).length;
 const due=active.filter(w=>isDue(w,method)).length;
 $('progressStreak').innerHTML=`${st.current} <small>days</small>`;
 $('progressStreakMessage').textContent=st.current?`Your best streak is ${st.best} days. A streak day requires five distinct word reviews or a completed quiz.`:'A streak day requires five distinct word reviews or a completed quiz.';
 $('totalReviews').textContent=logs.filter(x=>x.type==='review').length;$('progressMastered').textContent=mastered;
 $('quizAccuracy').textContent=answered?`${Math.round(correct/answered*100)}%`:'—';
 const counts=new Map();for(const log of logs)counts.set(log.date,(counts.get(log.date)||0)+1);const last=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const date=localDate(d);last.push({day:['S','M','T','W','T','F','S'][d.getDay()],n:counts.get(date)||0});}
 const activityChart=$('activityChart'),hasActivity=last.some(x=>x.n>0);
 activityChart.classList.toggle('empty',!hasActivity);
 if(hasActivity){const max=Math.max(1,...last.map(x=>x.n));activityChart.innerHTML=last.map(x=>`<div class="activity-column"><i style="height:${Math.max(3,x.n/max*100)}%" title="${x.n} activities"></i><small>${x.day}</small></div>`).join('');}
 else activityChart.innerHTML='<p class="empty-inline">Your review activity will appear here.</p>';
 $('progressActivityNote').hidden=!hasActivity;
 // Month grid is derived only from persisted review/quiz events; no synthetic activity is added.
 const now=new Date(),year=now.getFullYear(),month=now.getMonth(),first=new Date(year,month,1),daysInMonth=new Date(year,month+1,0).getDate();
 const monthName=now.toLocaleDateString(undefined,{month:'long',year:'numeric'});$('monthlyCalendarTitle').textContent=`${monthName} activity`;
 const monthCounts=new Map();for(const log of logs){if(log.type==='review'||(log.type==='quiz'&&Number(log.total||0)>0))monthCounts.set(log.date,(monthCounts.get(log.date)||0)+1);}
 const calendar=$('monthlyCalendar');calendar.innerHTML=['M','T','W','T','F','S','S'].map(d=>`<span class="calendar-weekday">${d}</span>`).join('')+Array.from({length:(first.getDay()+6)%7},()=>'<span class="calendar-blank" aria-hidden="true"></span>').join('')+Array.from({length:daysInMonth},(_,i)=>{const day=i+1,date=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,count=monthCounts.get(date)||0;return `<span class="calendar-day${count?' has-activity':''}${day===now.getDate()?' is-today':''}" title="${date}: ${count} recorded activities" aria-label="${date}, ${count} recorded activities">${day}</span>`;}).join('');
 const levels=['A1','A2','B1','B2','C1','C2'],levelCounts=Object.fromEntries(levels.map(level=>[level,active.filter(w=>String(w.level||'').toUpperCase()===level).length]));
 $('cefrDistribution').innerHTML=levels.map(level=>`<div class="cefr-row"><span>${level}</span><div class="cefr-track"><i style="width:${active.length?levelCounts[level]/active.length*100:0}%"></i></div><strong>${levelCounts[level]}</strong></div>`).join('')+`<p class="muted small">${active.filter(w=>!levels.includes(String(w.level||'').toUpperCase())).length} words without a CEFR level</p>`;
 $('progressDue').textContent=due;$('progressLearning').textContent=Math.max(0,active.length-mastered);
 const label=method==='leitner'?'Leitner':'SM-2';
 $('methodSnapshot').innerHTML=`<span>Current method: <strong>${label}</strong></span><span>Mastered means ${method==='leitner'?'Leitner box 5':'a 14-day review interval'}.</span>`;
 const leitnerDue=active.filter(w=>isDue(w,'leitner')).length,sm2Due=active.filter(w=>isDue(w,'sm2')).length;
 $('schedulerBreakdown').textContent=`Independent schedules · Leitner due: ${leitnerDue} · SM-2 due: ${sm2Due}`;
}
function showView(name){
 if(name==='learn')name='home';currentView=name;
 document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===name));
 document.querySelectorAll('.nav-item').forEach(v=>v.classList.toggle('active',v.dataset.nav===name));
 if(name==='settings'){$('themeSelect').value=settings.theme||'dark';renderImportBatches();renderVoiceSettings();}
 if(name==='progress')renderProgress();
 if(name==='library')renderLibrary();
 if(name==='practice')renderPracticeAvailability();
 if(name==='home'){renderHome();renderLearn();}
}
function openEditor(w=null){$('wordEditor').hidden=false;$('editorTitle').textContent=w?'Edit vocabulary':'Add vocabulary';$('editId').value=w?.id||'';for(const [field,key] of Object.entries({fieldGerman:'german',fieldTranslation:'translation',fieldPersian:'translationFa',fieldLevel:'level',fieldTags:'tags',fieldArticle:'article',fieldPlural:'plural',fieldExample:'example',fieldExampleEn:'exampleEn',fieldNotes:'notes',fieldPartOfSpeech:'partOfSpeech',fieldPresentIch:'presentIch',fieldPresentDu:'presentDu',fieldPresentEr:'presentEr',fieldPresentWir:'presentWir',fieldPresentIhr:'presentIhr',fieldPresentSie:'presentSie',fieldPrateritum:'prateritum',fieldPerfekt:'perfekt',fieldAuxiliary:'auxiliary',fieldDictionaryUrl:'dictionaryUrl'}))$(field).value=Array.isArray(w?.[key])?w[key].join(', '):(w?.[key]||'');if(w&&!w.article)$('fieldArticle').value=getArticle(w);$('wordEditor').scrollIntoView({behavior:'smooth',block:'start'});}
async function saveEditor(e){e.preventDefault();const id=$('editId').value||uid(),old=words.find(w=>w.id===id)||{};const w=ensureSchedules({...old,id,german:$('fieldGerman').value.trim(),translation:$('fieldTranslation').value.trim(),translationFa:$('fieldPersian').value.trim(),level:$('fieldLevel').value, tags:$('fieldTags').value.split(',').map(x=>x.trim()).filter(Boolean),article:$('fieldArticle').value.trim(),plural:$('fieldPlural').value.trim(),example:$('fieldExample').value.trim(),exampleEn:$('fieldExampleEn').value.trim(),notes:$('fieldNotes').value.trim(),category:old.category||'Imported',partOfSpeech:$('fieldPartOfSpeech').value.trim(),presentIch:$('fieldPresentIch').value.trim(),presentDu:$('fieldPresentDu').value.trim(),presentEr:$('fieldPresentEr').value.trim(),presentWir:$('fieldPresentWir').value.trim(),presentIhr:$('fieldPresentIhr').value.trim(),presentSie:$('fieldPresentSie').value.trim(),prateritum:$('fieldPrateritum').value.trim(),perfekt:$('fieldPerfekt').value.trim(),auxiliary:$('fieldAuxiliary').value,dictionaryUrl:$('fieldDictionaryUrl').value.trim(),source:'personal',active:true,box:old.box||1,repetitions:old.repetitions||0,easeFactor:old.easeFactor||2.5,interval:old.interval||0,dueDate:old.dueDate||today(),favorite:old.favorite||false,createdAt:old.createdAt||new Date().toISOString()},settings.algorithm);await put('words',w);words=await all('words');$('wordEditor').hidden=true;e.target.reset();renderAll();toast('Word saved.');}
function renderVoiceSettings(){
 const german=$('germanSpeechVoice'),english=$('englishSpeechVoice');
 if(german){const option=german.querySelector('option[value="jarvis"]');if(option){option.disabled=!voiceModelReady.jarvis;option.textContent=voiceModelReady.jarvis?'Jarvis · Neural':`Jarvis · ${voiceModelState.jarvis}`;}if(settings.germanVoiceMode==='jarvis'&&!voiceModelReady.jarvis)german.value='system';else german.value=settings.germanVoiceMode||'system';}
 if(english){const option=english.querySelector('option[value="amy"]');if(option){option.disabled=!voiceModelReady.amy;option.textContent=voiceModelReady.amy?'Amy · Neural':`Amy · ${voiceModelState.amy}`;}if(settings.englishVoiceMode==='amy'&&!voiceModelReady.amy)english.value='system';else english.value=settings.englishVoiceMode||'system';}
 const removeButton=$('deleteVoiceModels'),downloadButton=$('downloadVoiceModels');if(removeButton)removeButton.hidden=!!settings.voiceModelsDisabled||(!voiceModelReady.jarvis&&!voiceModelReady.amy);if(downloadButton)downloadButton.hidden=!settings.voiceModelsDisabled;
}

function setVoiceStatus(message,percent=null){
 const status=$('voiceDownloadStatus');if(status)status.textContent=message;
 const track=$('voiceProgressTrack'),bar=$('voiceProgressBar');
 if(track)track.hidden=percent===null;
 if(bar&&percent!==null)bar.style.width=`${Math.max(0,Math.min(100,percent))}%`;
}
async function startVoiceModelSetup(){
 if(voiceSetupRunning)return;
 voiceSetupRunning=true;
 setVoiceStatus(navigator.onLine?'Preparing offline speech and voice models…':'Checking voices saved on this device…',0);
 try{
  const result=await prepareVoiceModels(progress=>{
   if(progress.voice==='runtime'){
    if(progress.state==='starting')setVoiceStatus('Preparing the offline speech engine…',null);
    else if(progress.state==='downloading')setVoiceStatus(`Preparing speech engine · ${progress.fileName||'runtime files'}`,null);
    else if(progress.state==='ready')setVoiceStatus('Speech engine is ready. Preparing voices…',8);
    else if(progress.state==='error')setVoiceStatus('The speech engine could not be prepared. System voices remain available.',null);
    return;
   }
   const label=progress.voice==='jarvis'?'Jarvis · German':'Amy · English';
   if(progress.state==='ready'){
    voiceModelReady[progress.voice]=true;voiceModelState[progress.voice]='Ready';renderVoiceSettings();
    setVoiceStatus(`${label} is ready.`,progress.voice==='jarvis'?55:100);
   }else if(progress.state==='starting'){voiceModelState[progress.voice]='Downloading';renderVoiceSettings();setVoiceStatus(`Starting ${label} download…`,progress.voice==='jarvis'?8:55);}
   else if(progress.state==='downloading'){
    const pct=progress.total?Math.round(progress.loaded/progress.total*100):0;
    setVoiceStatus(`Downloading ${label} · ${pct}%`,progress.voice==='jarvis'?8+pct*.47:55+pct*.45);
   }else if(progress.state==='pending'){voiceModelState[progress.voice]='Waiting for internet';renderVoiceSettings();setVoiceStatus('Voice models will download automatically when you are online.',null);}
   else if(progress.state==='retrying'){voiceModelState[progress.voice]='Retrying';renderVoiceSettings();setVoiceStatus(`Connection interrupted. Retrying ${label}…`,null);}
   else if(progress.state==='error'){voiceModelState[progress.voice]='Unavailable';renderVoiceSettings();setVoiceStatus(`${label} could not be downloaded. System voice remains available.`,null);}
  },navigator.onLine&&!settings.voiceModelsDisabled);
  const stored=new Set(result.stored||[]);
  const runtimeReady=!result.runtimeError;
  voiceModelReady.jarvis=runtimeReady&&stored.has('de_DE-jarvis-medium');
  voiceModelReady.amy=runtimeReady&&stored.has('en_US-amy-medium');
  if(!voiceModelReady.jarvis&&settings.germanVoiceMode==='jarvis'){settings.germanVoiceMode='system';await setSetting('germanVoiceMode','system');}
  if(!voiceModelReady.amy&&settings.englishVoiceMode==='amy'){settings.englishVoiceMode='system';await setSetting('englishVoiceMode','system');}
  renderVoiceSettings();
  if(result.runtimeError){
   voiceModelState.jarvis='Unavailable';voiceModelState.amy='Unavailable';renderVoiceSettings();
   setVoiceStatus('Offline speech engine unavailable. System voices are selected; neural voices will retry when online.',null);
  }else if(result.errors?.length){
   for(const item of result.errors)voiceModelState[item.voice]='Unavailable';
   const failed=result.errors.map(x=>x.voice==='jarvis'?'Jarvis':'Amy').join(' and ');
   if(result.errors.some(x=>x.voice==='jarvis')&&settings.germanVoiceMode==='jarvis'){settings.germanVoiceMode='system';await setSetting('germanVoiceMode','system');}
   if(result.errors.some(x=>x.voice==='amy')&&settings.englishVoiceMode==='amy'){settings.englishVoiceMode='system';await setSetting('englishVoiceMode','system');}
   renderVoiceSettings();
   setVoiceStatus(`${failed} could not be downloaded. System voices are selected instead.`,null);
  }else if(result.pending?.length){
   for(const voice of result.pending)voiceModelState[voice]='Waiting for internet';
   renderVoiceSettings();
   setVoiceStatus('Voice models will download automatically when you are online.',null);
  }else if(settings.voiceModelsDisabled){setVoiceStatus('Neural voices are deleted or disabled. System voices remain available.',null);}else setVoiceStatus('Both neural voices are saved for offline use.',100);
 }catch(error){
  console.error('Neural voice setup failed:',error);
  setVoiceStatus('Neural voices could not be prepared. System voices remain available.',null);
 }finally{voiceSetupRunning=false;if(voiceSetupRetryRequested&&navigator.onLine&&navigator.serviceWorker?.controller){voiceSetupRetryRequested=false;queueMicrotask(startVoiceModelSetup);}}
}

async function speak(text,language='de'){
 if(!text?.trim())return toast(language==='de'?'No German text available.':'No English text available.');
 const voice=language==='de'?(settings.germanVoiceMode||'system'):(settings.englishVoiceMode||'system');
 const ready=voice==='jarvis'?voiceModelReady.jarvis:voice==='amy'?voiceModelReady.amy:false;
 if(voice!=='system'&&ready){
  try{if('speechSynthesis'in window)speechSynthesis.cancel();await speakNeural(voice,text,Number(settings.speechRate||.88),stage=>{const label=`${voice==='jarvis'?'Jarvis':'Amy'}: ${stage}`;$('voiceDiagnosticStatus').textContent=label;const log=$('voiceDiagnosticLog');if(log){const item=document.createElement('li');item.textContent=`${new Date().toLocaleTimeString()} — ${label}`;log.prepend(item);while(log.children.length>12)log.lastChild.remove();}});$('voiceDiagnosticStatus').textContent='Neural audio playback completed.';return;}
  catch(error){console.warn('Neural playback failed; using system speech.',error);$('voiceDiagnosticStatus').textContent=`Failed: ${error?.message||String(error)}`;if(!voiceFailureShown){toast('Neural speech failed. Using the system voice instead.');voiceFailureShown=true;}if(voice==='jarvis'){settings.germanVoiceMode='system';await setSetting('germanVoiceMode','system');}else{settings.englishVoiceMode='system';await setSetting('englishVoiceMode','system');}setVoiceStatus('Neural speech failed. System voice selected instead.');renderVoiceSettings();}
 }
 terminateNeuralWorker();
 if(!('speechSynthesis'in window))return toast('Speech synthesis is not supported in this browser.');
 speechSynthesis.cancel();
 const utterance=new SpeechSynthesisUtterance(text);
 utterance.lang=language==='de'?'de-DE':'en-US';
 utterance.rate=Number(settings.speechRate||.88);
 speechSynthesis.speak(utterance);
}
let practiceAvailabilitySource=null,practiceAvailabilityCache=null;
function renderPracticeAvailability(){
 if(practiceAvailabilitySource!==words){
 const validNouns=words.filter(w=>!!getArticle(w));
 const hasMeaning=new Set(words.filter(w=>String(w.translation||'').trim()).map(w=>String(w.translation).trim().toLowerCase())).size>=3;
 const hasPlural=validNouns.some(w=>String(w.plural||'').trim()&&pluralOptions(w,words).length>=3);
 const hasVerbs=buildVerbQuestions(buildVerbBank(words)).length>0;
 const hasListening=words.some(w=>String(w.example||'').trim())&&new Set(words.map(w=>w.german)).size>=3;
 const available={meaning:hasMeaning,article:validNouns.length>0,plural:hasPlural,verb:hasVerbs,listening:hasListening};
 practiceAvailabilitySource=words;practiceAvailabilityCache=available;
 }
 const available=practiceAvailabilityCache||{};
 let shown=0;
 document.querySelectorAll('[data-exercise]').forEach(button=>{const enabled=!!available[button.dataset.exercise];button.hidden=!enabled;if(enabled)shown++;});
 const empty=$('practiceEmpty');if(empty)empty.hidden=shown>0;
}
function startExercise(type){
 const active=activeWords();let pool=active;
 if(type==='meaning')pool=active.filter(w=>w.translation&&w.translation.trim());
 if(type==='article')pool=active.filter(w=>!!getArticle(w));
 if(type==='plural')pool=active.filter(w=>w.plural&&w.plural.trim());
 if(type==='listening')pool=active.filter(w=>w.example&&w.example.trim());
 if(type==='verb')pool=buildVerbBank(active);
 if(type!=='verb'&&pool.length<1)return toast('No suitable active words for this exercise. Add vocabulary with the required information.');
 let qs=[];
 if(type==='verb')qs=buildVerbQuestions(pool);
 else if(type==='listening')qs=shuffle(pool).slice(0,8).map(w=>{const sentence=(w.example||'').split(/\s\/\s|\s—\s/)[0];return {answer:w.german,meaning:w.translation,options:uniqueOptions(w.german,active.filter(x=>x.id!==w.id).map(x=>x.german)),prompt:'Listen to the complete German sentence. Which vocabulary item did you hear?',speak:sentence,hiddenTranscript:sentence,explanation:`${w.german} means ${w.translation}.`};});
 else qs=shuffle(pool).slice(0,Math.min(10,pool.length)).map(w=>{
  const answer=type==='article'?getArticle(w):type==='plural'?formatPlural(w.plural):w.translation;
  const prompt=type==='article'?`Which definite article belongs to “${stripArticle(w.german)}”?`:type==='plural'?`Choose the correct nominative plural of “${stripArticle(w.german)}”.`:`What does “${w.german}” mean?`;
  const options=type==='article'?uniqueOptions(answer,['der','die','das']):type==='plural'?pluralOptions(w,active):uniqueOptions(answer,active.filter(x=>x.id!==w.id).map(x=>x.translation));
  return {word:w.german,answer,options,prompt,speak:w.german,explanation:type==='plural'?`Singular: ${w.german}. Nominative plural: ${formatPlural(w.plural)}.`:''};
 }).filter(q=>q.options.length>=3&&q.options.filter(x=>x===q.answer).length===1);
 qs=qs.filter(q=>Array.isArray(q.options)&&q.options.length>=2&&new Set(q.options).size===q.options.length&&q.options.filter(x=>x===q.answer).length===1);
 if(!qs.length)return toast(type==='verb'?'Not enough distinct imported verb forms are available yet. Add more verb forms or vocabulary.':'Not enough valid questions are available yet. Add more vocabulary with the required fields.');
 exercise={type,questions:qs};exercise.index=0;exercise.correct=0;exercise.answered=false;$('exercisePanel').hidden=false;$('exercisePanel').scrollIntoView({behavior:'smooth',block:'start'});showExerciseQuestion();
}
function localDate(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function showExerciseQuestion(){const q=exercise.questions[exercise.index];exercise.answered=false;$('exerciseType').textContent=exercise.type.toUpperCase();$('exercisePrompt').textContent=q.prompt;$('exerciseProgress').style.width=`${exercise.index/exercise.questions.length*100}%`;$('exerciseFeedback').textContent='';if($('exerciseTranscript')){$('exerciseTranscript').hidden=true;$('exerciseTranscript').textContent='';}$('exerciseNext').hidden=true;$('exerciseAudio').hidden=exercise.type!=='listening';$('exerciseChoices').innerHTML=q.options.map(o=>`<button class="choice-button" data-choice="${esc(o)}">${esc(o)}</button>`).join('');}
function answerExercise(choice){if(exercise.answered)return;exercise.answered=true;const q=exercise.questions[exercise.index],ok=choice===q.answer;if(ok)exercise.correct++;document.querySelectorAll('.choice-button').forEach(b=>{b.disabled=true;if(b.textContent===q.answer)b.classList.add('correct');else if(b.textContent===choice)b.classList.add('incorrect')});$('exerciseFeedback').textContent=(ok?'Correct — gut gemacht! ':`Correct answer: ${q.answer}. `)+(q.explanation||'');if(exercise.type==='listening'){$('exerciseTranscript').hidden=false;$('exerciseTranscript').textContent=`Transcript: ${q.hiddenTranscript||q.speak}\nTarget word: ${q.answer} — ${q.meaning||''}`;} $('exerciseNext').hidden=false;$('exerciseNext').textContent=exercise.index===exercise.questions.length-1?'Finish':'Continue →';}
async function nextExercise(){exercise.index++;if(exercise.index>=exercise.questions.length){const result={id:uid(),date:today(),type:'quiz',correct:exercise.correct,total:exercise.questions.length,exercise:exercise.type};await put('reviewLogs',result);logs=await all('reviewLogs');$('exercisePanel').hidden=true;toast(`Completed: ${exercise.correct} / ${exercise.questions.length} correct.`);renderAll();return;}showExerciseQuestion();}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function exportBackup(){const payload={app:'Deutsch Meister',version:'3.7.0',schemaVersion:3,exportedAt:new Date().toISOString(),settings,words,reviewLogs:logs,sessions};download(`deutsch-meister-v3-backup-${today()}.json`,JSON.stringify(payload,null,2),'application/json');$('dataStatus').textContent='Backup exported.';}
async function restoreBackup(file){const data=JSON.parse(await file.text());if(!Array.isArray(data.words))throw Error('Invalid backup: words array is missing.');if(!confirm(`Restore ${data.words.length} words and learning history? This merges records by ID; it does not delete current data.`))return;for(const w of data.words){if(!w.id)w.id=uid();await put('words',w);}for(const x of data.reviewLogs||[])if(x.id)await put('reviewLogs',x);for(const x of data.sessions||[])if(x.id)await put('sessions',x);for(const [k,v] of Object.entries(data.settings||{}))await setSetting(k,v);[words,logs,sessions]=await Promise.all([all('words'),all('reviewLogs'),all('sessions')]);settings={...settings,...(data.settings||{})};renderAll();applyTheme();$('dataStatus').textContent=`Restored ${data.words.length} words. Existing unmatched data was kept.`;}
async function importCsv(file){
 const rows=parseCSV(await file.text());if(!rows.length)throw Error('CSV is empty.');
 if(!('german'in rows[0]))throw Error('Required column: german. All other columns are optional.');
 const batchId=uid(),importedAt=new Date().toISOString(),fileName=file.name||'Imported CSV';let added=0,skipped=0;const existing=new Set(words.map(w=>String(w.german||'').trim().toLocaleLowerCase()));
 for(const r of rows){
  if(!String(r.german||'').trim()){skipped++;continue;}
  const normalized=String(r.german).trim().toLocaleLowerCase();if(existing.has(normalized)){skipped++;continue;}existing.add(normalized);
  await put('words',ensureSchedules({id:uid(),german:String(r.german).trim(),translation:r.translation_en||r.translation||'',translationFa:r.translation_fa||r.translation_fa_ir||'',level:/^(A1|A2|B1|B2|C1|C2)$/i.test(r.level||r.cefr||'')?String(r.level||r.cefr).toUpperCase():'',tags:String(r.tags||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean),article:r.article||'',plural:r.plural||'',example:r.example_de||r.example||'',exampleEn:r.example_en||'',notes:r.notes||'',category:r.category||'Imported',partOfSpeech:r.part_of_speech||r.partofspeech||r.partOfSpeech||'',presentIch:r.present_ich||r.presentIch||'',presentDu:r.present_du||r.presentDu||'',presentEr:r.present_er_sie_es||r.present_er||r.presentEr||'',presentWir:r.present_wir||'',presentIhr:r.present_ihr||'',presentSie:r.present_sie||'',prateritum:r.prateritum||r.präteritum||'',perfekt:r.perfekt||'',auxiliary:r.perfekt_auxiliary||r.auxiliary||'',dictionaryUrl:String(r.dictionary_url||r.dictionaryUrl||'').trim().replace(/\\([:.])/g,'$1'),source:'personal',sourceType:'csv',importBatchId:batchId,importFileName:fileName,importedAt,active:true,box:1,repetitions:0,easeFactor:2.5,interval:0,dueDate:today(),favorite:false,createdAt:importedAt},settings.algorithm));added++;
 }
 words=await all('words');renderAll();$('dataStatus').textContent=`Imported ${added}; skipped ${skipped} empty or duplicate rows.`;
 if(!added)$('dataStatus').textContent+=' No new batch was created because no new rows were added.';
 toast(`Imported ${added} words; skipped ${skipped}.`);
}
function renderImportBatches(){
 const host=$('importBatchList');if(!host)return;
 const grouped=new Map();for(const w of words.filter(x=>x.source!=='builtin'&&x.importBatchId)){const key=w.importBatchId;if(!grouped.has(key))grouped.set(key,{id:key,name:w.importFileName||'Imported CSV',date:w.importedAt||w.createdAt||'',count:0});grouped.get(key).count++;}
 const batches=[...grouped.values()].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 host.innerHTML=batches.length?batches.map(b=>`<div class="import-batch-row"><div class="import-batch-meta"><b>${esc(b.name)}</b><small>${b.count} words · ${b.date?new Date(b.date).toLocaleDateString():''}</small></div><button class="button button-danger" type="button" data-delete-import-batch="${esc(b.id)}">Delete batch</button></div>`).join(''):'<p class="muted small">No tracked CSV imports yet.</p>';

}
async function deleteImportBatch(batchId){const batch=words.filter(w=>w.importBatchId===batchId);if(!batch.length)return;const label=batch[0].importFileName||'this CSV file';if(!confirm(`Delete the complete import “${label}” (${batch.length} words) and its review history? Other personal words and other CSV imports will remain.`))return;const ids=new Set(batch.map(w=>w.id));for(const w of batch)await remove('words',w.id);for(const log of logs.filter(x=>ids.has(x.wordId)))await remove('reviewLogs',log.id);words=await all('words');logs=await all('reviewLogs');renderAll();$('dataStatus').textContent=`Deleted CSV import “${label}” (${batch.length} words).`;
}

function exportCsv(){const cols=['german','article','part_of_speech','translation_en','translation_fa','level','tags','example_de','example_en','notes','plural','present_ich','present_du','present_er_sie_es','present_wir','present_ihr','present_sie','prateritum','perfekt','perfekt_auxiliary','dictionary_url'];const personal=[...words];const map={german:'german',article:'article',part_of_speech:'partOfSpeech',translation_en:'translation',translation_fa:'translationFa',level:'level',tags:'tags',example_de:'example',example_en:'exampleEn',notes:'notes',plural:'plural',present_ich:'presentIch',present_du:'presentDu',present_er_sie_es:'presentEr',present_wir:'presentWir',present_ihr:'presentIhr',present_sie:'presentSie',prateritum:'prateritum',perfekt:'perfekt',perfekt_auxiliary:'auxiliary',dictionary_url:'dictionaryUrl'};const q=escapeCSVCell;download('deutsch-meister-vocabulary.csv','\ufeff'+[cols.join(','),...personal.map(w=>cols.map(c=>q(w[map[c]])).join(','))].join('\n'),'text/csv;charset=utf-8');$('dataStatus').textContent='CSV exported.';}
function safeDictionaryHref(value){try{const raw=String(value||'').trim().replace(/\\([:.])/g,'$1');const url=new URL(raw);return url.protocol==='https:'?url.href:'';}catch{return '';}}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function bind(){document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>showView(b.dataset.nav));document.querySelectorAll('[data-action="go-learn"]').forEach(b=>b.onclick=startStudy);document.querySelectorAll('[data-action="go-practice"]').forEach(b=>b.onclick=()=>showView('practice'));document.querySelectorAll('[data-action="go-library"]').forEach(b=>b.onclick=()=>showView('library'));$('settingsOpen').onclick=()=>showView('settings');$('startReview').onclick=startStudy;$('revealAnswer').onclick=()=>{$('studyCard').classList.add('is-flipped');$('revealAnswer').hidden=true};$('endReview').onclick=()=>{currentWord=null;studyQueue=[];studyIndex=0;$('studyCard').hidden=true;renderLearn();renderHome();};$('studySpeak').onclick=()=>speak(currentWord?.german,'de');$('studyTranslationSpeak').onclick=()=>speak(currentWord?.translation,'en');document.querySelectorAll('[data-rating]').forEach(b=>b.onclick=()=>rateWord(b.dataset.rating));$('addWordOpen').onclick=()=>openEditor();$('importCsvOpen').onclick=()=>$('importCsv').click();$('closeEditor').onclick=()=>$('wordEditor').hidden=true;$('wordEditor').onsubmit=saveEditor;$('personalWordList').onclick=async e=>{const ed=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(ed)openEditor(words.find(x=>x.id===ed.dataset.edit));if(del){const target=words.find(x=>x.id===del.dataset.delete);if(!target)return;if(confirm(`Delete “${target.german}” permanently? Its review history will also be removed.`)){await remove('words',target.id);for(const log of logs.filter(x=>x.wordId===target.id))await remove('reviewLogs',log.id);words=await all('words');logs=await all('reviewLogs');renderAll();toast('Personal word deleted.');}}};$('wordSearch').oninput=()=>{libraryLimit=100;renderLibrary()};$('loadMoreWords').onclick=()=>{libraryLimit+=100;renderLibrary()};document.querySelectorAll('[data-exercise]').forEach(b=>b.onclick=()=>startExercise(b.dataset.exercise));$('closeExercise').onclick=()=>$('exercisePanel').hidden=true;$('exerciseChoices').onclick=e=>{const b=e.target.closest('[data-choice]');if(b)answerExercise(b.dataset.choice)};$('exerciseNext').onclick=nextExercise;$('exerciseAudio').onclick=()=>speak(exercise?.questions[exercise.index]?.speak);$('themeSelect').onchange=async()=>{settings.theme=$('themeSelect').value;await setSetting('theme',settings.theme);applyTheme()};$('dailyGoalSelect').onchange=async()=>{settings.dailyGoal=Number($('dailyGoalSelect').value);await setSetting('dailyGoal',settings.dailyGoal);renderHome()};$('algorithmSelect').onchange=async()=>{settings.algorithm=$('algorithmSelect').value;await setSetting('algorithm',settings.algorithm);renderAll();renderProgress();toast('Review method changed. Only the selected method is shown in Progress.');};$('speechRate').onchange=async()=>{settings.speechRate=Number($('speechRate').value);await setSetting('speechRate',settings.speechRate)};$('germanSpeechVoice').onchange=async()=>{settings.germanVoiceMode=$('germanSpeechVoice').value;if(settings.germanVoiceMode==='system')terminateNeuralWorker();await setSetting('germanVoiceMode',settings.germanVoiceMode)};$('englishSpeechVoice').onchange=async()=>{settings.englishVoiceMode=$('englishSpeechVoice').value;if(settings.englishVoiceMode==='system')terminateNeuralWorker();await setSetting('englishVoiceMode',settings.englishVoiceMode)};$('deleteVoiceModels').onclick=async()=>{if(!confirm('Delete the downloaded Jarvis and Amy voice models from this device? Your vocabulary and progress will not be affected. The speech engine files may remain cached.'))return;try{settings.germanVoiceMode='system';settings.englishVoiceMode='system';settings.voiceModelsDisabled=true;await Promise.all([setSetting('germanVoiceMode','system'),setSetting('englishVoiceMode','system'),setSetting('voiceModelsDisabled',true)]);terminateNeuralWorker();voiceModelReady.jarvis=false;voiceModelReady.amy=false;for(const voice of ['jarvis','amy'])await deleteNeuralVoice(voice);voiceModelState.jarvis='Deleted';voiceModelState.amy='Deleted';renderVoiceSettings();$('downloadVoiceModels').hidden=false;$('deleteVoiceModels').hidden=true;setVoiceStatus('Downloaded neural voices deleted. System voices are active.',null);toast('Neural voice models deleted.');}catch(error){$('voiceDiagnosticStatus').textContent=`Delete failed: ${error.message}`;toast('Could not delete all voice files.');}};$('downloadVoiceModels').onclick=async()=>{settings.voiceModelsDisabled=false;await setSetting('voiceModelsDisabled',false);$('downloadVoiceModels').hidden=true;$('deleteVoiceModels').hidden=false;voiceModelState.jarvis='Preparing';voiceModelState.amy='Preparing';renderVoiceSettings();startVoiceModelSetup();};
 $('exportJson').onclick=exportBackup;$('exportCsv').onclick=exportCsv;$('restoreJson').onchange=e=>{if(e.target.files[0])restoreBackup(e.target.files[0]).catch(err=>toast(err.message));e.target.value=''};$('importCsv').onchange=e=>{if(e.target.files[0])importCsv(e.target.files[0]).catch(err=>{$('dataStatus').textContent=err.message;toast('CSV import failed.')});e.target.value=''};$('importBatchList').onclick=e=>{const b=e.target.closest('[data-delete-import-batch]');if(b)deleteImportBatch(b.dataset.deleteImportBatch)};$('deletePersonalWords').onclick=async()=>{const personal=[...words];if(!personal.length)return toast('There are no vocabulary entries to delete.');if(!confirm(`Permanently delete all ${personal.length} vocabulary entries and their review history? Export a JSON backup first if you may need these words later.`))return;const ids=new Set(personal.map(w=>w.id));for(const w of personal)await remove('words',w.id);for(const log of logs.filter(x=>ids.has(x.wordId)))await remove('reviewLogs',log.id);words=await all('words');logs=await all('reviewLogs');renderAll();$('dataStatus').textContent=`Deleted ${personal.length} vocabulary entries.`;toast('Personal vocabulary deleted.');};$('resetProgress').onclick=async()=>{if(!confirm('Reset all review schedules and learning history while keeping every word?'))return;for(const w of words){w.scheduling={leitner:{box:1,interval:0,dueDate:today(),reviewCount:0},sm2:{repetitions:0,easeFactor:2.5,interval:0,dueDate:today(),reviewCount:0}};w.box=1;w.repetitions=0;w.easeFactor=2.5;w.interval=0;w.dueDate=w.scheduling[settings.algorithm].dueDate;delete w.lastReviewed;delete w.reviewCount;await put('words',w);}await clear('reviewLogs');logs=[];renderAll();toast('Learning progress reset. Your words are safe.');};}
init();