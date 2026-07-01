/* ============================================================
   auth.js — handles Sign In and New Joiner sign-up
   Talks to the Python backend (app.py) via /api/login and /api/signup
   ============================================================ */

function showTab(t){
  document.getElementById('tab-login').classList.toggle('on', t==='login');
  document.getElementById('tab-signup').classList.toggle('on', t==='signup');
  document.getElementById('form-login').classList.toggle('hide', t!=='login');
  document.getElementById('form-signup').classList.toggle('hide', t!=='signup');
}

async function postJSON(url, data){
  const res = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  return { ok: res.ok, body: await res.json() };
}

async function doLogin(){
  const id  = document.getElementById('li-id').value.trim();
  const pw  = document.getElementById('li-pw').value;
  const msg = document.getElementById('li-msg');
  const btn = document.getElementById('li-btn');
  msg.className='msg'; msg.textContent='';
  if(!id || !pw){ msg.className='msg err'; msg.textContent='Enter your Employee ID and password.'; return; }
  btn.disabled=true; btn.textContent='Signing in…';
  try{
    const {ok, body} = await postJSON('/api/login', {emp_id:id, password:pw});
    if(ok && body.ok){
      msg.className='msg ok'; msg.textContent='Welcome! Loading your portal…';
      setTimeout(()=> location.href = body.redirect, 500);
    }else{
      msg.className='msg err'; msg.textContent = body.msg || 'Could not sign in.';
      btn.disabled=false; btn.textContent='Sign In';
    }
  }catch(e){
    msg.className='msg err'; msg.textContent='Network error. Please try again.';
    btn.disabled=false; btn.textContent='Sign In';
  }
}

async function doSignup(){
  const name  = document.getElementById('su-name').value.trim();
  const id    = document.getElementById('su-id').value.trim();
  const phone = document.getElementById('su-phone').value.trim();
  const desg  = document.getElementById('su-desg').value;
  const pw    = document.getElementById('su-pw').value;
  const msg   = document.getElementById('su-msg');
  const btn   = document.getElementById('su-btn');
  msg.className='msg'; msg.textContent='';
  if(!name||!id||!phone||!desg||!pw){ msg.className='msg err'; msg.textContent='Please fill in all fields.'; return; }
  if(pw.length<6){ msg.className='msg err'; msg.textContent='Password must be at least 6 characters.'; return; }
  btn.disabled=true; btn.textContent='Submitting…';
  try{
    const {ok, body} = await postJSON('/api/signup',
      {name, emp_id:id, phone, designation:desg, password:pw});
    if(ok && body.ok){
      msg.className='msg ok'; msg.textContent = body.msg;
      ['su-name','su-id','su-phone','su-pw'].forEach(x=>document.getElementById(x).value='');
      document.getElementById('su-desg').value='';
    }else{
      msg.className='msg err'; msg.textContent = body.msg || 'Could not submit.';
    }
    btn.disabled=false; btn.textContent='Request Account';
  }catch(e){
    msg.className='msg err'; msg.textContent='Network error. Please try again.';
    btn.disabled=false; btn.textContent='Request Account';
  }
}

