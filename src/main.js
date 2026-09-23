import { createClient } from '@supabase/supabase-js'
import './style.css'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !publishableKey) {
  document.querySelector('#app').innerHTML = '<main class="auth"><section class="card"><h1>尚未配置</h1><p>请先设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY。</p></section></main>'
  throw new Error('Missing Supabase configuration')
}

const supabase = createClient(supabaseUrl, publishableKey)
let session = null
let activeConversationId = null
let activeView = 'chat'

const app = document.querySelector('#app')

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function renderAuth(message = '') {
  app.innerHTML = `
    <main class="auth">
      <section class="card">
        <h1>长忆</h1>
        <p>你的角色、关系与长期记忆，由你掌握。</p>
        <label for="email">邮箱</label>
        <input id="email" type="email" autocomplete="email" placeholder="you@example.com">
        <div class="actions"><button class="primary" id="login">发送登录链接</button></div>
        <p class="muted">登录链接将发送到你的邮箱。DeepSeek API Key 不会进入浏览器。</p>
        <p id="auth-message" class="muted">${escapeHtml(message)}</p>
      </section>
    </main>`

  document.querySelector('#login').addEventListener('click', async () => {
    const email = document.querySelector('#email').value.trim()
    const output = document.querySelector('#auth-message')
    if (!email) return
    output.textContent = '正在发送…'
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split('#')[0] }
    })
    output.textContent = error ? error.message : '登录链接已发送，请检查邮箱。'
  })
}

function renderShell() {
  app.innerHTML = `
    <div class="shell">
      <header>
        <div class="brand">长忆<small>DeepSeek 私人记忆客户端</small></div>
        <nav class="nav">
          <button class="ghost active" data-view="chat">对话</button>
          <button class="ghost" data-view="memories">记忆</button>
          <button class="ghost" data-view="settings">设定</button>
        </nav>
      </header>
      <main>
        <section id="chat-view" class="chat-page">
          <div id="messages" class="messages"></div>
          <form id="composer" class="composer">
            <textarea id="message-input" rows="1" placeholder="写下你想说的话…"></textarea>
            <button class="primary" type="submit">发送</button>
          </form>
        </section>
        <section id="memories-view" class="page hidden">
          <h2>长期记忆</h2>
          <p class="muted">这里展示系统从对话中提取的长期信息。你可以删除不准确或不希望保留的内容。</p>
          <div id="memory-list"></div>
        </section>
        <section id="settings-view" class="page hidden">
          <section class="card">
            <h2>迁移与设定</h2>
            <p class="notice">把旧 DeepSeek App 窗口整理出的内容分别粘贴到这里。当前明确设定会优先于自动记忆。</p>
            <form id="profile-form">
              <label for="assistant-persona">角色宪章</label>
              <textarea id="assistant-persona" placeholder="ta 是谁、性格核心、价值观、说话风格、称呼、边界…"></textarea>
              <label for="user-profile">你的档案与偏好</label>
              <textarea id="user-profile" placeholder="希望被怎样称呼、沟通偏好、长期目标、敏感点…"></textarea>
              <label for="relationship-state">关系状态与共同经历</label>
              <textarea id="relationship-state" placeholder="目前关系、重要经历、共同约定、未完成事项…"></textarea>
              <label for="response-style">回答风格</label>
              <textarea id="response-style" placeholder="长度、语气、格式、需要避免的表达…"></textarea>
              <div class="actions">
                <button class="primary" type="submit">保存设定</button>
                <button class="ghost" id="logout" type="button">退出登录</button>
              </div>
              <p id="settings-message" class="muted"></p>
            </form>
          </section>
        </section>
      </main>
      <footer></footer>
    </div>`

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view))
  })
  document.querySelector('#composer').addEventListener('submit', sendMessage)
  document.querySelector('#profile-form').addEventListener('submit', saveProfile)
  document.querySelector('#logout').addEventListener('click', () => supabase.auth.signOut())
}

async function switchView(view) {
  activeView = view
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view))
  for (const name of ['chat', 'memories', 'settings']) {
    document.querySelector(`#${name}-view`).classList.toggle('hidden', name !== view)
  }
  if (view === 'memories') await loadMemories()
  if (view === 'settings') await loadProfile()
}

async function ensureConversation() {
  const { data: existing, error } = await supabase
    .from('conversations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (existing) return existing.id

  const { data, error: insertError } = await supabase
    .from('conversations')
    .insert({ user_id: session.user.id, title: '我们的对话' })
    .select('id')
    .single()
  if (insertError) throw insertError
  return data.id
}

async function loadMessages() {
  const list = document.querySelector('#messages')
  list.innerHTML = '<p class="muted">正在读取对话…</p>'
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', activeConversationId)
    .order('created_at')
  if (error) {
    list.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`
    return
  }
  list.innerHTML = data.length ? data.map(messageMarkup).join('') : '<p class="muted">设定完成后，就可以从这里继续你们的对话。</p>'
  window.scrollTo({ top: document.body.scrollHeight })
}

function messageMarkup(message, extra = '') {
  return `<article class="message ${message.role} ${extra}">${escapeHtml(message.content)}</article>`
}

async function sendMessage(event) {
  event.preventDefault()
  const input = document.querySelector('#message-input')
  const submit = document.querySelector('#composer button')
  const content = input.value.trim()
  if (!content || submit.disabled) return

  input.value = ''
  submit.disabled = true
  const list = document.querySelector('#messages')
  if (list.querySelector('.muted')) list.innerHTML = ''
  list.insertAdjacentHTML('beforeend', messageMarkup({ role: 'user', content }))
  list.insertAdjacentHTML('beforeend', messageMarkup({ role: 'assistant', content: '正在回想并回应…' }, 'pending'))
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })

  const { data, error } = await supabase.functions.invoke('chat', {
    body: { conversationId: activeConversationId, message: content }
  })
  list.querySelector('.pending')?.remove()
  if (error) {
    list.insertAdjacentHTML('beforeend', `<p class="error">请求失败：${escapeHtml(error.message)}</p>`)
  } else {
    list.insertAdjacentHTML('beforeend', messageMarkup({ role: 'assistant', content: data.reply }))
  }
  submit.disabled = false
  input.focus()
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('*').maybeSingle()
  if (error) return
  document.querySelector('#assistant-persona').value = data?.assistant_persona || ''
  document.querySelector('#user-profile').value = data?.user_profile || ''
  document.querySelector('#relationship-state').value = data?.relationship_state || ''
  document.querySelector('#response-style').value = data?.response_style || ''
}

async function saveProfile(event) {
  event.preventDefault()
  const message = document.querySelector('#settings-message')
  message.textContent = '正在保存…'
  const payload = {
    user_id: session.user.id,
    assistant_persona: document.querySelector('#assistant-persona').value.trim(),
    user_profile: document.querySelector('#user-profile').value.trim(),
    relationship_state: document.querySelector('#relationship-state').value.trim(),
    response_style: document.querySelector('#response-style').value.trim(),
    updated_at: new Date().toISOString()
  }
  const { error } = await supabase.from('profiles').upsert(payload)
  message.textContent = error ? error.message : '已保存。下一次回复会使用这些设定。'
}

async function loadMemories() {
  const list = document.querySelector('#memory-list')
  list.innerHTML = '<p class="muted">正在读取记忆…</p>'
  const { data, error } = await supabase
    .from('memories')
    .select('id, kind, content, importance, created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    list.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`
    return
  }
  list.innerHTML = data.length ? data.map(item => `
    <article class="memory">
      <div class="memory-meta"><span>${escapeHtml(item.kind)}</span><span>${new Date(item.created_at).toLocaleDateString()}</span></div>
      <p>${escapeHtml(item.content)}</p>
      <button class="danger" data-delete-memory="${item.id}">删除</button>
    </article>`).join('') : '<p class="muted">尚未形成长期记忆。</p>'
  document.querySelectorAll('[data-delete-memory]').forEach(button => {
    button.addEventListener('click', async () => {
      await supabase.from('memories').update({ status: 'deleted' }).eq('id', button.dataset.deleteMemory)
      await loadMemories()
    })
  })
}

async function start() {
  const { data } = await supabase.auth.getSession()
  session = data.session
  if (!session) return renderAuth()
  renderShell()
  try {
    activeConversationId = await ensureConversation()
    await loadMessages()
  } catch (error) {
    document.querySelector('#messages').innerHTML = `<p class="error">初始化失败：${escapeHtml(error.message)}</p>`
  }
}

supabase.auth.onAuthStateChange((_event, nextSession) => {
  const wasSignedIn = Boolean(session)
  session = nextSession
  if (wasSignedIn !== Boolean(nextSession)) start()
})

start()
