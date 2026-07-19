import { setupShell, initReveals } from './core.js?v=20260719.8';

const page = document.body.dataset.page || 'home';

async function boot() {
  await setupShell(page);
  try {
    const module = await import(`./pages/${page}.js?v=20260719.8`);
    if (typeof module.init === 'function') await module.init();
  } catch (error) {
    console.error(`Atlas 页面“${page}”初始化失败：`, error);
    const main = document.getElementById('main-content');
    if (main && !main.querySelector('.page-error')) {
      const box = document.createElement('div');
      box.className = 'page-error container empty-state';
      box.innerHTML = '<h2>页面暂时无法加载</h2><p>请确认通过本地静态服务器打开，并检查 data/index.json 是否存在。</p>';
      main.appendChild(box);
    }
  }
  initReveals();
}

boot();
