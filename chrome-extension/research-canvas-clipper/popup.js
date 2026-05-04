const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  bind('connectBtn', 'click', () => run('CONNECT_FROM_ACTIVE_TAB', '连接成功'));
  bind('sendSelectionBtn', 'click', () => run('SEND_SELECTION', '已发送选区'));
  bind('sendPageBtn', 'click', () => run('SEND_PAGE', '已发送整页文本'));
  bind('optionsBtn', 'click', () => chrome.runtime.openOptionsPage());
  bind('testBtn', 'click', () => run('TEST_CONNECTION', '连接正常'));
  bind('clearBtn', 'click', () => run('CLEAR_TOKEN', '已断开本机连接'));
  await refresh();
});

function bind(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

async function refresh() {
  const state = await send('GET_STATE');
  const connected = Boolean(state.authToken);
  $('statusPill').textContent = connected ? '已连接' : '未连接';
  $('statusPill').className = connected ? 'pill ok' : 'pill';
  $('appUrl').textContent = state.config.appUrl;
  $('autoProcess').textContent = state.config.autoProcess ? '开启' : '关闭';
  $('userLine').textContent = state.connectedUser?.email
    ? `${state.connectedUser.name || '用户'} · ${state.connectedUser.email}`
    : 'token 只保存在本机；地址设置会跟随 Chrome 同步。';
  $('lastUpload').textContent = state.lastUpload?.uploadedAt
    ? `上次上传：${state.lastUpload.fileName || state.lastUpload.id || ''}`
    : '还没有上传记录。';
}

async function run(type, successText) {
  setBusy(true);
  showMessage('', '');
  try {
    const result = await send(type);
    const warning = result?.settingsWarning ? `。${result.settingsWarning}` : '';
    showMessage(`${successText}${warning}`, 'success');
    await refresh();
  } catch (error) {
    showMessage(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '操作失败');
  return response.result;
}

function setBusy(isBusy) {
  for (const button of document.querySelectorAll('button')) {
    button.disabled = isBusy;
  }
}

function showMessage(text, type) {
  const el = $('message');
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'message';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `message ${type}`;
}
