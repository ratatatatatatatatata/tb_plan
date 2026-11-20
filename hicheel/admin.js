const $=id=>document.getElementById(id);let csrf='',adminId=null;
async function api(path,body){const response=await fetch('/hicheel/api'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.code),{status:response.status});return data;}
const node=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
function field(label,type='text'){const wrapper=node('label',label),input=document.createElement('input');input.type=type;input.required=true;wrapper.append(input);return{wrapper,input};}
function clear(){adminId=null;$('orders').replaceChildren();$('refresh-orders').hidden=true;}
async function refresh(){
  try{const config=await api('/config');csrf=config.csrf;const me=await api('/me');
    if(me.user?.is_admin!==true){clear();$('admin-status').textContent='Энэ хуудас зөвхөн TB Plan-ийн эрх бүхий админд нээлттэй.';$('login-link').hidden=!!me.user;return;}
    adminId=me.user.id;const data=await api('/admin/orders');$('orders').replaceChildren();$('login-link').hidden=true;$('refresh-orders').hidden=false;$('admin-status').textContent=`Сүүлийн ${data.orders.length} захиалга`;
    for(const order of data.orders){const card=node('article','','order'),title=node('h2',`${order.reference} · ${new Intl.NumberFormat('mn-MN').format(order.amount_mnt)} ₮`);card.append(title,node('p',`${order.display_name||''} — ${order.email}`),node('p',`Төлөв: ${order.status}`));
      if(order.status==='pending'){const form=document.createElement('form'),amount=field('Банкнаас шалгасан дүн (₮)','number'),reference=field('Банкны гүйлгээний дугаар (картын дугаар биш)'),confirm=field(' Банкны орлогыг шалгасан','checkbox');amount.input.min='1';amount.input.step='1';amount.input.value=String(order.amount_mnt);reference.input.maxLength=120;
        const button=node('button','Баталгаажуулж эрх нээх','button button-accent');button.type='submit';form.append(amount.wrapper,reference.wrapper,confirm.wrapper,button);
        form.addEventListener('submit',async event=>{event.preventDefault();if(!confirm.input.checked)return;button.disabled=true;try{await api('/admin/approve',{order_id:order.id,amount_mnt:Number(amount.input.value),bank_reference:reference.input.value,confirmed_in_bank:true});await refresh();}catch(e){$('admin-status').textContent=`Баталгаажуулалт амжилтгүй: ${e.message||'холболт'}`;button.disabled=false;}});card.append(form);
      }else if(order.status==='paid'){const form=document.createElement('form'),reason=field('Эрх цуцлах шалтгаан'),button=node('button','Үзэх эрхийг цуцлах','button button-dark');reason.input.minLength=3;reason.input.maxLength=500;button.type='submit';form.append(reason.wrapper,button);form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;try{await api('/admin/revoke',{order_id:order.id,reason:reason.input.value});await refresh();}catch(e){$('admin-status').textContent='Эрх цуцлах үйлдэл амжилтгүй.';button.disabled=false;}});card.append(form);}
      $('orders').append(card);
    }
  }catch(e){clear();$('admin-status').textContent=e.status===403?'Админы эрх шаардлагатай.':'Үйлчилгээ түр боломжгүй байна.';}
}
$('refresh-orders').addEventListener('click',()=>void refresh());window.addEventListener('focus',()=>void refresh());
if('BroadcastChannel'in window){const channel=new BroadcastChannel('tbplan-session');channel.onmessage=()=>{clear();void refresh();};}
await refresh();
