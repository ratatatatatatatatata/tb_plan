import {plannedCatalog} from './catalog.js';
const $=id=>document.getElementById(id),API='/hicheel/api';
const sessionChannel='BroadcastChannel'in window?new BroadcastChannel('tbplan-session'):null;
const state={ready:false,csrf:'',clientId:'',user:null,course:plannedCatalog,modules:plannedCatalog.modules,lessons:plannedCatalog.lessons,
  selected:plannedCatalog.lessons[0]?.id,live:false,entitlements:[],progress:new Map(),video:null,videoLesson:null,order:null,lastSave:0,saving:false,afterLogin:null};
const text=(id,value)=>{$(id).textContent=value??'';};
const money=value=>`${new Intl.NumberFormat('mn-MN').format(value)} ₮`;
const accessTerm=days=>Number.isSafeInteger(days)?`Төлбөр баталгаажсан өдрөөс ${days} хоногийн үзэх эрх.`:'Хугацаагүй үзэх эрх.';
const lesson=()=>state.lessons.find(x=>x.id===state.selected);
const owned=()=>state.entitlements.some(x=>x.course_id===state.course.id&&x.active===true&&(x.expires_at===null||Date.parse(x.expires_at)>Date.now()));
const saleOpen=()=>state.ready&&state.live&&state.course.enrollment_open===true&&Number.isSafeInteger(state.course.price_mnt)&&state.course.price_mnt>0;
const canPlay=()=>!!state.user&&state.live&&(owned()||lesson()?.is_preview===true);
function message(id,value,error=false){text(id,value);$(id).classList.toggle('error',error);}
function notice(value,error=false){message('connection-status',value,error);$('connection-status').hidden=!value;}
function show(id){if(!$(id).open)$(id).showModal();}function close(id){if($(id).open)$(id).close();}
function toast(value){text('toast',value);$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,5000);}
function explain(error){if(error?.status===401)return 'Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.';if(error?.status===403)return 'Үзэх эрх баталгаажаагүй байна.';if(error?.status===429)return 'Олон хүсэлт ирсэн байна. Түр хүлээгээд дахин оролдоно уу.';if(error?.code==='COURSE_CLOSED')return 'Бүртгэл одоогоор хаалттай байна.';return 'Үйлчилгээ түр боломжгүй байна. Дараа дахин оролдоно уу.';}
async function api(path,body){
  const response=await fetch(API+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    ...(body===undefined?{}:{headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  let data;try{data=await response.json();}catch{throw Object.assign(new Error(),{status:response.status});}
  if(!response.ok)throw Object.assign(new Error(data.error?.message),{status:response.status,code:data.error?.code});return data;
}
function clearPlayer(){
  if(state.video){state.video.pause();state.video.removeAttribute('src');state.video.load();}
  state.video=null;state.videoLesson=null;$('player-mount').replaceChildren();$('worksheet').hidden=true;text('worksheet-text','');text('save-status','');$('quiz-questions').replaceChildren();$('lesson-quiz').hidden=true;
}
function renderQuiz(quiz){
  $('quiz-questions').replaceChildren();$('lesson-quiz').hidden=!Array.isArray(quiz)||quiz.length!==2;
  if($('lesson-quiz').hidden)return;
  quiz.forEach((item,index)=>{
    const group=document.createElement('fieldset'),legend=document.createElement('legend');group.className='quiz-question';legend.textContent=`${index+1}. ${item.question}`;group.append(legend);
    const check=document.createElement('button'),feedback=document.createElement('p');check.type='button';check.className='button button-small';check.textContent='Хариултаа шалгах';check.disabled=true;feedback.className='quiz-feedback';feedback.setAttribute('role','status');
    const inputs=[];item.options.forEach((option,choice)=>{const label=document.createElement('label'),input=document.createElement('input'),copy=document.createElement('span');label.className='quiz-option';input.type='radio';input.name=`quiz-${state.videoLesson}-${index}`;input.value=String(choice);copy.textContent=option;input.addEventListener('change',()=>{check.disabled=false;feedback.textContent='';feedback.classList.remove('correct','error');});label.append(input,copy);inputs.push(input);group.append(label);});
    check.addEventListener('click',()=>{const choice=inputs.findIndex(input=>input.checked);if(choice<0)return;const correct=choice===item.answer_index;feedback.textContent=(correct?'Зөв. ':'Дахин бодож үзээрэй. ')+item.explanation;feedback.classList.toggle('correct',correct);feedback.classList.toggle('error',!correct);});
    group.append(check,feedback);$('quiz-questions').append(group);
  });
}
function render(){
  text('course-title',state.course.title);text('course-subtitle',state.course.subtitle);text('lesson-count',state.lessons.length);text('module-count',String(state.modules.length).padStart(2,'0'));
  const selected=lesson(),index=state.lessons.indexOf(selected),module=state.modules.find(x=>x.id===selected?.module_id);
  const fragment=document.createDocumentFragment();
  state.modules.forEach((m,mi)=>{
    const details=document.createElement('details');details.className='module';details.open=m.id===selected?.module_id;
    const summary=document.createElement('summary'),number=document.createElement('span'),name=document.createElement('span');
    number.className='module-number';number.textContent=String(mi+1).padStart(2,'0');name.className='module-name';name.textContent=m.title;summary.append(number,name);details.append(summary);
    const list=document.createElement('ol');list.className='lesson-list';state.lessons.filter(l=>l.module_id===m.id).forEach(l=>{
      const item=document.createElement('li'),button=document.createElement('button');button.className='lesson-row';button.dataset.lesson=l.id;if(l.id===state.selected)button.setAttribute('aria-current','true');
      const n=document.createElement('span'),title=document.createElement('span'),status=document.createElement('span');n.className='lesson-num';n.textContent=String(state.lessons.indexOf(l)+1).padStart(2,'0');title.className='lesson-name';title.textContent=l.title;status.className='lesson-state';status.textContent=state.progress.get(l.id)?.completed?'✓':'↗';button.append(n,title,status);item.append(button);list.append(item);
    });details.append(list);fragment.append(details);
  });$('module-list').replaceChildren(fragment);
  text('course-price',Number.isSafeInteger(state.course.price_mnt)?money(state.course.price_mnt):'Үнэ зарлагдаагүй');
  text('access-badge',owned()?'Эрх нээлттэй':saleOpen()?'Бүртгэл нээлттэй':'Удахгүй');$('access-badge').classList.toggle('active',owned());
  text('access-description',owned()?'Таны сургалтын эрх идэвхтэй байна.':saleOpen()?'Банкны шилжүүлгийг баталгаажуулсны дараа эрх нээгдэнэ.':'Бүртгэл удахгүй нээгдэнэ');
  text('enroll-button',owned()?'Суралцаж эхлэх →':saleOpen()?'Сургалтын эрх авах →':'Бүртгэл удахгүй нээгдэнэ');$('enroll-button').disabled=!state.ready||(!owned()&&!saleOpen());
  text('enrollment-note',owned()?'Үзсэн хэсэг, дуусгасан хичээл бүртгэлд хадгалагдана.':saleOpen()?accessTerm(state.course.access_days):'Хичээлүүдийн агуулгатай доороос танилцаарай.');
  $('account-button').disabled=!state.ready;text('account-button',state.user?'Миний хичээл':'Нэвтрэх');text('account-email',state.user?.email||'');text('account-access',owned()?'Үзэх эрх идэвхтэй.':'Үзэх эрх хараахан нээгдээгүй.');$('admin-link').hidden=state.user?.is_admin!==true;
  if(selected){text('lesson-module',`${String(state.modules.indexOf(module)+1).padStart(2,'0')} / ${module?.title||''}`);text('lesson-position',`${String(index+1).padStart(2,'0')} / ${state.lessons.length}`);text('lesson-label',`ХИЧЭЭЛ ${String(index+1).padStart(2,'0')}`);text('lesson-title',selected.title);text('lesson-objective',selected.objective);
    text('lesson-duration',selected.duration_seconds?`${Math.floor(selected.duration_seconds/60)}:${String(selected.duration_seconds%60).padStart(2,'0')} · Монгол хэлээр`:'Монгол хэлээр');}
  const completed=state.lessons.filter(l=>state.progress.get(l.id)?.completed).length;
  text('progress-summary',`${state.lessons.length} хичээл`);$('course-progress').hidden=!state.user;$('progress-meter').max=state.lessons.length||1;$('progress-meter').value=completed;text('progress-label',`${state.lessons.length} хичээлээс ${completed}-ыг дуусгасан`);
  $('previous-lesson').disabled=index<=0;$('next-lesson').disabled=index>=state.lessons.length-1;
  $('player-placeholder').hidden=!!state.video;$('player-mount').hidden=!state.video;
  text('player-message',canPlay()?'Хичээлээ үргэлжлүүлээрэй.':state.user?'Үзэх эрх шаардлагатай.':'Хичээлээ эндээс үзээрэй.');
  text('player-note',canPlay()?'Бичлэг нээх бүрд таны үзэх эрхийг шалгана.':'Бүртгэл нээгдэхэд хичээлээ үзэх боломжтой болно.');
  text('play-button',canPlay()?'Хичээл үзэх →':state.user?'Сургалтын эрх авах':'Нэвтрэх');$('play-button').disabled=!state.ready||(!canPlay()&&!!state.user&&!saleOpen());
  $('complete-button').hidden=!state.video;$('complete-button').disabled=state.progress.get(state.selected)?.completed===true;text('complete-button',state.progress.get(state.selected)?.completed?'✓ Дуусгасан':'Дуусгаснаар тэмдэглэх');
}
async function loadAccount(){
  const previous=state.user?.id,result=await api('/me');
  if(previous!==result.user?.id){clearPlayer();state.order=null;close('payment-dialog');}
  state.user=result.user;state.entitlements=result.entitlements||[];state.progress=new Map((result.progress||[]).map(x=>[x.lesson_id,x]));
  if(state.video&&!canPlay())clearPlayer();render();
}
let googlePromise;
async function signIn(action){
  state.afterLogin=action;show('auth-dialog');message('auth-message','');
  try{
    if(!googlePromise)googlePromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.defer=true;s.onload=resolve;s.onerror=()=>{googlePromise=null;reject(new Error());};document.head.append(s);});
    await googlePromise;window.google.accounts.id.initialize({client_id:state.clientId,nonce:state.csrf,auto_select:false,
      callback:async result=>{try{message('auth-message','Нэвтэрч байна…');await api('/auth/google',{credential:result.credential});await loadAccount();sessionChannel?.postMessage('changed');close('auth-dialog');const next=state.afterLogin;state.afterLogin=null;if(next==='play')await play();else if(next==='enroll')await checkout();}catch(e){message('auth-message',explain(e),true);}}});
    $('google-signin').replaceChildren();window.google.accounts.id.renderButton($('google-signin'),{type:'standard',theme:'outline',size:'large',text:'signin_with',width:280});
  }catch(e){message('auth-message',explain(e),true);}
}
async function checkout(){
  if(!state.user)return signIn('enroll');if(owned()){document.getElementById('curriculum').scrollIntoView({behavior:'smooth'});return;}
  if(!saleOpen())return toast('Бүртгэл одоогоор хаалттай байна.');
  show('payment-dialog');text('payment-course',state.course.title);text('payment-amount',money(state.course.price_mnt));$('payment-content').hidden=true;$('check-payment').disabled=true;message('payment-message','Захиалга бэлдэж байна…');
  try{const result=await api('/orders',{course_id:state.course.id});if(result.access_granted===true){await loadAccount();close('payment-dialog');return;}
    state.order=result.order;text('payment-amount',money(result.order.amount_mnt));text('payment-access',accessTerm(result.order.access_days));text('bank-name',result.bank.name);text('bank-account',result.bank.account);text('bank-holder',result.bank.holder);text('bank-reference',result.order.reference);$('payment-content').hidden=false;$('check-payment').disabled=false;message('payment-message','Шилжүүлгийн дараа TB Plan банкны орлогыг шалгаж эрх нээнэ.');
  }catch(e){message('payment-message',explain(e),true);}
}
async function checkOrder(){
  if(!state.order)return;$('check-payment').disabled=true;
  try{const result=await api('/orders/'+state.order.id);if(result.order.status==='paid'&&result.access_granted===true){await loadAccount();if(owned()){close('payment-dialog');toast('Таны сургалтын эрх нээгдлээ.');}else message('payment-message','Эрхийг дахин шалгаж байна.');}
    else message('payment-message',result.order.status==='revoked'?'Үзэх эрх цуцлагдсан байна. TB Plan-тай холбоо барина уу.':'Шилжүүлгийг хараахан баталгаажуулаагүй байна. Дараа дахин шалгана уу.');
  }catch(e){message('payment-message',explain(e),true);}finally{$('check-payment').disabled=false;}
}
async function saveProgress(completed=false){
  if(!state.video||!state.user||state.saving)return;const video=state.video,user=state.user.id,id=state.videoLesson;state.saving=true;state.lastSave=Date.now();
  const row={lesson_id:id,position_seconds:Math.max(0,Number.isFinite(video.currentTime)?video.currentTime:0),completed:completed||state.progress.get(id)?.completed===true};
  try{await api('/progress',row);if(state.user?.id===user){state.progress.set(id,row);text('save-status','Ахиц хадгалагдлаа.');render();}}
  catch(e){if(state.user?.id===user)text('save-status','Сүүлийн ахицыг хадгалж чадсангүй.');}finally{state.saving=false;}
}
function privatePath(value,extension){return typeof value==='string'&&new RegExp(`^/hicheel/private/[A-Za-z0-9_-]+\\.${extension}$`).test(value);}
async function play(){
  if(!state.user)return signIn('play');if(!canPlay())return checkout();const id=state.selected,user=state.user.id;
  $('play-button').disabled=true;
  try{const result=await api('/playback',{lesson_id:id});if(state.selected!==id||state.user?.id!==user)return;
    if(!privatePath(result.playback_url,'mp4'))throw new Error('Invalid private media');clearPlayer();const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.setAttribute('controlsList','nodownload');video.src=result.playback_url;
    if(result.captions_url&&privatePath(result.captions_url,'vtt')){const track=document.createElement('track');track.kind='subtitles';track.label='Монгол';track.srclang='mn';track.src=result.captions_url;video.append(track);}
    state.video=video;state.videoLesson=id;state.lastSave=Date.now();$('player-mount').append(video);text('worksheet-text',result.worksheet_text||'');$('worksheet').hidden=!result.worksheet_text;renderQuiz(result.quiz);
    video.addEventListener('loadedmetadata',()=>{const row=state.progress.get(id);if(row&&!row.completed&&row.position_seconds<video.duration)video.currentTime=row.position_seconds;});
    video.addEventListener('timeupdate',()=>{if(Date.now()-state.lastSave>60000)void saveProgress();});video.addEventListener('pause',()=>void saveProgress());video.addEventListener('ended',()=>void saveProgress(true));video.addEventListener('error',()=>text('save-status','Бичлэгийг ачаалж чадсангүй. Эрхээ шалгаад дахин нээнэ үү.'));render();
  }catch(e){toast(explain(e));}finally{render();}
}
async function select(id){if(!state.lessons.some(l=>l.id===id))return;if(id!==state.selected){await saveProgress();clearPlayer();state.selected=id;render();}}
$('module-list').addEventListener('click',event=>{const button=event.target.closest('[data-lesson]');if(button)void select(button.dataset.lesson);});
$('account-button').addEventListener('click',()=>state.user?show('account-dialog'):void signIn(null));$('enroll-button').addEventListener('click',()=>void checkout());$('play-button').addEventListener('click',()=>void play());
$('check-payment').addEventListener('click',()=>void checkOrder());$('copy-reference').addEventListener('click',()=>{if(state.order)navigator.clipboard.writeText(state.order.reference).then(()=>toast('Гүйлгээний утгыг хууллаа.')).catch(()=>toast('Гүйлгээний утгыг гараар хуулна уу.'));});
$('previous-lesson').addEventListener('click',()=>void select(state.lessons[state.lessons.indexOf(lesson())-1]?.id));$('next-lesson').addEventListener('click',()=>void select(state.lessons[state.lessons.indexOf(lesson())+1]?.id));
$('complete-button').addEventListener('click',()=>void saveProgress(true));$('account-continue').addEventListener('click',()=>{close('account-dialog');$('curriculum').scrollIntoView({behavior:'smooth'});});
$('signout-button').addEventListener('click',async()=>{await saveProgress();clearPlayer();try{await api('/logout',{});state.user=null;state.entitlements=[];state.progress.clear();state.order=null;sessionChannel?.postMessage('changed');close('account-dialog');close('payment-dialog');render();}catch(e){message('account-message',explain(e),true);}});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>close(button.dataset.close)));document.addEventListener('visibilitychange',()=>{if(document.hidden)void saveProgress();});
if(sessionChannel)sessionChannel.onmessage=()=>{clearPlayer();if(state.ready)void loadAccount().catch(()=>notice('Бүртгэлээ дахин шалгана уу.',true));};
window.addEventListener('focus',()=>{if(state.ready)void loadAccount().catch(()=>clearPlayer());});
render();
try{const config=await api('/config');state.ready=config.ready===true;state.clientId=config.google_client_id;state.csrf=config.csrf;
  try{const catalog=await api('/catalog');state.course=catalog.course;state.modules=catalog.modules;state.lessons=catalog.lessons;state.selected=state.lessons[0]?.id;state.live=true;}catch{notice('Бүртгэл удахгүй нээгдэнэ.');}
  if(state.ready)await loadAccount();else notice('Бүртгэл удахгүй нээгдэнэ.');render();
}catch{notice('Бүртгэл удахгүй нээгдэнэ.');render();}
