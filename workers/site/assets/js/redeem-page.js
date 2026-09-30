(function () {
 var RB=((window.MSP&&window.MSP.bakedConfig&&window.MSP.bakedConfig().formBase)||'https://subscribe.mysweetpea.cc')+'/webhook',endpoint=RB+'/redeem-code',btn=document.getElementById('rc-submit');
 var fields={'rc-code':'code','rc-name':'name','rc-email':'email','rc-username':'username'};
 function valid(type,v){v=v.trim();if(type==='code')return /^(PEA|FAM)-[A-Z0-9]{8}$/.test(v.toUpperCase());if(type==='name')return v.length>=2;if(type==='email')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);return /^[A-Za-z0-9_]{3,}$/.test(v);}
 function normCode(v){var c=v.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,11);return c.length>=3?c.slice(0,3)+'-'+c.slice(3):c;}
 function update(){btn.disabled=!Object.keys(fields).every(function(id){var v=document.getElementById(id).value;if(id==='rc-code'){v=normCode(v);}return valid(fields[id],v);});}
 /* === Ledger key tray (approved mockup port) ===
    One invisible real input (#rc-code) drives everything; the 8 underline
    cells, counter and meta line are painted from it. Normalization always
    writes the dashed form (PEA-XXXXXXXX) back into input.value so the
    webhook payload keeps its dash. */
 var cells=document.querySelectorAll('#lcells .cell'),
     lcount=document.getElementById('lcount'),
     
     ledger=document.getElementById('ledger'),
     lhint=document.getElementById('lhint');
 var input=document.createElement('input');
 input.type='text';input.id='rc-code';input.className='form-input redeem-code-input';input.autocomplete='off';
 input.setAttribute('autocapitalize','characters');input.setAttribute('spellcheck','false');input.setAttribute('aria-label','Invite code');
 input.style.cssText='position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:text;z-index:3';
 document.querySelector('.redeem-code-group').appendChild(input);
 function codeValidFull(v){var t=v.toUpperCase().trim();return /^(PEA|FAM)-[A-Z0-9]{8}$/.test(t);}
 /* === Live DB check (single owner — moved here from site.js) ===
    Every edit re-queries the database: the painted verdict ALWAYS belongs to the
    exact code currently in the input. A monotonic seq token means in-flight
    fetches for older values can never paint; the per-value memo (dbValue/dbState)
    reuses a verdict on blur/refocus of an UNCHANGED code without refetching. */
 var checkTimer=null,checkSeq=0,dbState='idle',dbValue='';
 function metaRow(pre,tail,complete,full){
  var norm=pre+'-'+tail;
  if(!complete||!full){clearTimeout(checkTimer);dbState='idle';dbValue='';
   lhint.textContent=complete?'CHECK CODE':(norm.replace('-','').length?'IN PROGRESS':'AWAITING CODE');
   lhint.classList.toggle('err',complete&&!full);return;}
  if(dbValue!==norm){
   // TIMER RULE: clear ONLY when scheduling a replacement. paint() also fires on
   // keyup/click/focus for the same value — clearing there would kill the pending
   // check before it fires (the stuck-at-CHECKING bug).
   clearTimeout(checkTimer);
   dbValue=norm;dbState='checking';
   var seq=++checkSeq;
   checkTimer=setTimeout(function(){
    fetch(RB+'/check-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invite_code:norm})})
    .then(function(r){return r.text().then(function(t){if(t){try{return JSON.parse(t);}catch(e){return {ok:r.ok};}}return {ok:r.ok};});})
    .then(function(data){if(seq!==checkSeq)return;dbState=data.ok?'valid':'invalid';
     lhint.textContent=data.ok?'CODE VALID':'CODE REJECTED';lhint.classList.toggle('err',!data.ok);})
    .catch(function(){if(seq!==checkSeq)return;dbState='error';
     lhint.textContent='CHECK FAILED — TRY AGAIN';lhint.classList.add('err');});
   },600);
  }
  if(dbState==='checking'){lhint.textContent='CHECKING…';lhint.classList.remove('err');}
  else if(dbState==='valid'){lhint.textContent='CODE VALID';lhint.classList.remove('err');}
  else if(dbState==='invalid'){lhint.textContent='CODE REJECTED';lhint.classList.add('err');}
  else if(dbState==='error'){lhint.textContent='CHECK FAILED — TRY AGAIN';lhint.classList.add('err');}
 }
 function paint(){
  // 11 visible slots: cells 0-2 = prefix letters, dash after slot 3, cells 3-10 = 8 tail chars.
  // DESIGN RULE (learned the hard way): NEVER rewrite input.value during typing.
  // Rewriting fights mobile keyboards (autocapitalize/composition) and produces
  // reversed input. The invisible input is the source of truth; we normalize a
  // SEPARATE copy for display + validation, and normalize the real value only on blur.
  var raw=input.value.toUpperCase().replace(/\s/g,'');
  var alnum=raw.replace(/[^A-Z0-9]/g,'');
  var cl=alnum.slice(0,11);
  // CAP ENFORCEMENT: if the real input exceeds 11 alnum (insertion at cap), rewrite
  // it to the clamped form with the caret kept in place — otherwise edits past the
  // cap silently no-op and a stale VALID keeps showing (user-reported bug).
  if (alnum !== cl) {
    var rebuilt=(cl.length>=3)?cl.slice(0,3)+'-'+cl.slice(3):cl;
    var caret=input.selectionStart||0;
    var alnumBeforeCaret=input.value.slice(0,caret).toUpperCase().replace(/[^A-Z0-9]/g,'').length;
    input.value=rebuilt;
    var newCaret=cl.length>=3?Math.min(alnumBeforeCaret+(alnumBeforeCaret>3?1:0),rebuilt.length):alnumBeforeCaret;
    try{input.setSelectionRange(newCaret,newCaret);}catch(e){}
  }
  var pre=cl.slice(0,3), tail=cl.slice(3,11);
  for(var i=0;i<3;i++){var pc=pre[i]||'';cells[i].textContent=pc;cells[i].classList.toggle('filled',!!pc);}
  for(var i=3;i<11;i++){var tc=tail[i-3]||'';cells[i].textContent=tc;cells[i].classList.toggle('filled',!!tc);}
  // caret glow: the slot being EDITED (selectionStart), else the slot just typed
  var pos=input.selectionStart||0;
  var dashInDisp=input.value.indexOf('-');
  var alnumBefore=(dashInDisp>-1&&pos>dashInDisp)?pos-1:pos;
  var editIdx=Math.max(0,Math.min(alnumBefore,10));
  cells.forEach(function(c,i){c.classList.toggle('cur',i===editIdx&&document.activeElement===input);});
  var complete=cl.length===11;
  var full=codeValidFull(pre+'-'+tail);
  ledger.classList.toggle('valid',complete&&full);
  ledger.classList.toggle('invalid',complete&&!full);
  lcount.textContent=cl.length+' / 11 CHARACTERS';
  window.__codeMeta=lhint;window.__codeState=complete?(full?'valid':'invalid'):'idle';
  metaRow(pre,tail,complete,full);
  var cicon=document.getElementById('rc-code-icon');
  update();
 }
 function normalizeValue(){
  input.value = normCode(input.value);
  paint();
 }
 input.addEventListener('blur',normalizeValue);
 input.addEventListener('input',paint);input.addEventListener('keyup',paint);input.addEventListener('click',paint);input.addEventListener('focus',paint);

 document.getElementById('ledger').addEventListener('click',function(){input.focus();});
 Object.keys(fields).forEach(function(id){var el=document.getElementById(id);function placeCaret(){if(id!=='rc-code')return;var caret=document.querySelector('.cb-caret');if(!caret)return;var cells=document.querySelectorAll('.code-boxes .cb-cell');var pos=el.selectionStart||0;var v=el.value.replace('-','');var idx=pos;if(pos>3)idx=pos-1;if(idx>11)idx=11;var cell=cells[Math.min(idx,11)];if(cell){var r=cell.getBoundingClientRect();var br=document.querySelector('.code-boxes').getBoundingClientRect();caret.style.left=(r.left-br.left+r.width/2)+'px';}}function updateUsernameChecks(){if(id!=='rc-username')return;var v=el.value;var checks=document.querySelectorAll('#rc-username-checks .uc-item');if(!checks.length)return;var rules={len:v.length>=3,alnum:/[A-Za-z0-9]/.test(v),underscore:/^[A-Za-z0-9_]+$/.test(v)};checks.forEach(function(c){var k=c.getAttribute('data-uc');var ok=rules[k];c.classList.toggle('ok',ok);var icon=c.querySelector('.uc-icon');if(icon)icon.textContent=ok?'✓':'×';});}el.addEventListener('input',function(){if(id==='rc-code')return;var ok=valid(fields[id],el.value);el.classList.toggle('valid',ok);el.classList.toggle('invalid',el.value.trim().length>0&&!ok);var icon=document.getElementById(id+'-icon');if(icon){icon.classList.toggle('show',el.value.trim().length>0);icon.classList.toggle('valid',ok);icon.classList.toggle('invalid',el.value.trim().length>0&&!ok);icon.textContent=ok?'✓':'×';}update();updateUsernameChecks();});el.addEventListener('keyup',placeCaret);el.addEventListener('click',placeCaret);el.addEventListener('select',placeCaret);el.addEventListener('blur',function(){if(id==='rc-code')return;var ok=valid(fields[id],el.value);el.classList.toggle('valid',ok);el.classList.toggle('invalid',el.value.trim().length>0&&!ok);var icon=document.getElementById(id+'-icon');if(icon){icon.classList.toggle('show',el.value.trim().length>0);icon.classList.toggle('valid',ok);icon.classList.toggle('invalid',el.value.trim().length>0&&!ok);icon.textContent=ok?'✓':'×';}update();updateUsernameChecks();placeCaret();});});
 btn.addEventListener('click',function(){if(btn.disabled)return;var data={invite_code:normCode(document.getElementById('rc-code').value),name:document.getElementById('rc-name').value.trim(),email:document.getElementById('rc-email').value.trim(),username:document.getElementById('rc-username').value.trim()};btn.disabled=true;btn.classList.add('loading');btn.textContent='Creating account…';fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.text().then(function(t){if(t){try{return JSON.parse(t);}catch(e){return {ok:r.ok};}}return {ok:r.ok};});}).then(function(result){if(!result.ok)throw new Error(result.msg||'Could not create account');window.location.href='/success.html?type=redeem';}).catch(function(e){btn.disabled=false;btn.classList.remove('loading');btn.textContent=e.message||'Try again';setTimeout(function(){btn.textContent='Request MySweetPea Account';update();},3000);});});
 paint();
})();
