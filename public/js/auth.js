'use strict';
/* Login / register page logic */

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.auth-tab');
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  const loginErr = document.getElementById('loginErr');
  const regErr = document.getElementById('regErr');

  // If already logged in, go straight to the player
  fetch('/api/auth/me')
    .then((r) => (r.ok ? window.location.replace('/index.html') : null))
    .catch(() => {});

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      loginForm.style.display = which === 'login' ? 'flex' : 'none';
      regForm.style.display = which === 'register' ? 'flex' : 'none';
      loginErr.textContent = '';
      regErr.textContent = '';
    });
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErr.textContent = '';
    const body = {
      username: loginForm.username.value.trim(),
      password: loginForm.password.value,
    };
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return (loginErr.textContent = data.error || '登录失败');
      window.location.href = '/index.html';
    } catch (err) {
      loginErr.textContent = '网络错误，请稍后再试';
    }
  });

  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    regErr.textContent = '';
    const pwd = regForm.password.value;
    const confirm = regForm.confirm.value;
    if (pwd !== confirm) return (regErr.textContent = '两次输入的密码不一致');
    const body = {
      username: regForm.username.value.trim(),
      password: pwd,
    };
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return (regErr.textContent = data.error || '注册失败');
      window.location.href = '/index.html';
    } catch (err) {
      regErr.textContent = '网络错误，请稍后再试';
    }
  });
});