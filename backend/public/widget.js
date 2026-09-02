(function () {
  const scriptTag = document.currentScript || document.querySelector("script[data-assistant-id]");
  const assistantId = scriptTag ? scriptTag.getAttribute("data-assistant-id") : null;
  const widgetKey = scriptTag ? scriptTag.getAttribute("data-widget-key") : null;
  const apiBase = scriptTag ? scriptTag.getAttribute("data-api-base") || "http://localhost:8080" : "http://localhost:8080";
  const autoOpen = scriptTag ? scriptTag.getAttribute("data-auto-open") === "true" : false;
  const storageSuffix = assistantId || "default";

  let config = {
    name: "Support Assistant",
    welcomeMessage: "Hello! How can I help you today?",
    primaryColor: "#3B82F6",
    widgetSettings: {},
    organizationId: null,
  };

  let state = {
    isOpen: false,
    customerId: localStorage.getItem(`ai_chat_customer_id_${storageSuffix}`) || null,
    conversationId: localStorage.getItem(`ai_chat_conv_id_${storageSuffix}`) || null,
    messages: [],
    loading: false,
    ready: false,
    handoff: false,
  };

  // Inject Styles
  const styleTag = document.createElement("style");
  styleTag.innerHTML = `
    .ai-chat-launcher {
      position: fixed;
      bottom: var(--widget-offset, 24px);
      right: var(--widget-offset, 24px);
      width: var(--launcher-size, 60px);
      height: var(--launcher-size, 60px);
      border-radius: var(--launcher-radius, 30px);
      background-color: var(--primary-color, #3B82F6);
      color: white;
      border: none;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      cursor: pointer;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease;
    }
    .ai-chat-launcher:hover { transform: scale(1.05); }
    
    .ai-chat-window {
      position: fixed;
      bottom: calc(var(--launcher-size, 60px) + var(--widget-offset, 24px) + 12px);
      right: var(--widget-offset, 24px);
      width: var(--window-width, 380px);
      max-width: calc(100vw - 32px);
      height: 580px;
      max-height: calc(100vh - 120px);
      background: var(--surface-color, #ffffff);
      border-radius: var(--widget-radius, 16px);
      box-shadow: 0 10px 25px rgba(0,0,0,0.15);
      z-index: 99999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: var(--widget-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
    }
    .ai-chat-window.open { display: flex; }

    .ai-chat-header {
      background: var(--primary-color, #3B82F6);
      color: white;
      padding: 16px;
      font-weight: 600;
      font-size: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .ai-chat-body {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: var(--background-color, #f9fafb);
    }
    .ai-chat-msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.4;
      word-break: break-word;
    }
    .ai-chat-msg.customer {
      align-self: flex-end;
      background: var(--primary-color, #3B82F6);
      color: white;
      border-bottom-right-radius: 2px;
    }
    .ai-chat-msg.ai, .ai-chat-msg.agent {
      align-self: flex-start;
      background: var(--agent-bubble-color, #e5e7eb);
      color: var(--text-color, #1f2937);
      border-bottom-left-radius: 2px;
    }
    .ai-chat-footer {
      padding: 12px;
      background: var(--surface-color, #ffffff);
      border-top: 1px solid #e5e7eb;
      display: flex;
      gap: 8px;
    }
    .ai-chat-input {
      flex: 1;
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .ai-chat-send {
      background: var(--primary-color, #3B82F6);
      color: white;
      border: none;
      padding: 0 16px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
    }
    .ai-chat-send:disabled, .ai-chat-input:disabled { opacity: 0.6; cursor: not-allowed; }
    .ai-chat-thinking {
      align-self: flex-start;
      width: min(210px, 75%);
      padding: 10px 12px;
      border-radius: 12px;
      background: #e5e7eb;
      color: #4b5563;
      font-size: 12px;
    }
    .ai-chat-thinking-label { display: block; margin-bottom: 7px; }
    .ai-chat-thinking-track { height: 4px; overflow: hidden; border-radius: 999px; background: #cbd5e1; }
    .ai-chat-thinking-bar { width: 42%; height: 100%; border-radius: inherit; background: var(--primary-color, #3B82F6); animation: ai-chat-thinking 1.1s ease-in-out infinite; }
    @keyframes ai-chat-thinking { 0% { transform: translateX(-110%); } 100% { transform: translateX(360%); } }
  `;
  document.head.appendChild(styleTag);

  // Build UI Container
  const container = document.createElement("div");
  container.innerHTML = `
    <button class="ai-chat-launcher" id="ai-chat-launcher-btn">💬</button>
    <div class="ai-chat-window" id="ai-chat-window-box">
      <div class="ai-chat-header">
        <span id="ai-chat-assistant-name">Support Assistant</span>
        <button style="background:none;border:none;color:white;cursor:pointer;font-size:18px;" id="ai-chat-close-btn">✕</button>
      </div>
      <div class="ai-chat-body" id="ai-chat-msg-container"></div>
      <div class="ai-chat-footer">
        <input type="text" class="ai-chat-input" id="ai-chat-input-field" placeholder="Type a message..." />
        <button class="ai-chat-send" id="ai-chat-send-btn">Send</button>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const launcherBtn = document.getElementById("ai-chat-launcher-btn");
  const windowBox = document.getElementById("ai-chat-window-box");
  const closeBtn = document.getElementById("ai-chat-close-btn");
  const nameLabel = document.getElementById("ai-chat-assistant-name");
  const msgContainer = document.getElementById("ai-chat-msg-container");
  const inputField = document.getElementById("ai-chat-input-field");
  const sendBtn = document.getElementById("ai-chat-send-btn");
  function applyWidgetSettings() {
    const settings = config.widgetSettings || {};
    const root = document.documentElement.style;
    const color = (value, fallback) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
    root.setProperty("--primary-color", color(settings.primaryColor, config.primaryColor || "#3B82F6"));
    root.setProperty("--background-color", color(settings.backgroundColor, "#f9fafb"));
    root.setProperty("--surface-color", color(settings.surfaceColor, "#ffffff"));
    root.setProperty("--agent-bubble-color", color(settings.agentBubbleColor, "#e5e7eb"));
    root.setProperty("--text-color", color(settings.textColor, "#1f2937"));
    root.setProperty("--widget-radius", `${number(settings.borderRadius, 16, 0, 32)}px`);
    root.setProperty("--launcher-radius", `${number(settings.launcherRadius, 30, 0, 36)}px`);
    root.setProperty("--launcher-size", `${number(settings.launcherSize, 60, 44, 80)}px`);
    root.setProperty("--window-width", `${number(settings.windowWidth, 380, 300, 520)}px`);
    root.setProperty("--widget-offset", `${number(settings.offset, 24, 12, 48)}px`);
    root.setProperty("--widget-font", settings.fontFamily === "serif" ? "Georgia, serif" : settings.fontFamily === "mono" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif");
    const left = settings.position === "bottom-left";
    [launcherBtn, windowBox].forEach((element) => { element.style.left = left ? "var(--widget-offset, 24px)" : ""; element.style.right = left ? "auto" : ""; });
    launcherBtn.textContent = typeof settings.launcherIcon === "string" && settings.launcherIcon.length <= 4 ? settings.launcherIcon : "💬";
    nameLabel.textContent = typeof settings.headerTitle === "string" && settings.headerTitle.trim() ? settings.headerTitle.trim().slice(0, 80) : (config.name || "Support Assistant");
    inputField.placeholder = typeof settings.inputPlaceholder === "string" && settings.inputPlaceholder.trim() ? settings.inputPlaceholder.trim().slice(0, 120) : "Type a message...";
    sendBtn.textContent = typeof settings.sendLabel === "string" && settings.sendLabel.trim() ? settings.sendLabel.trim().slice(0, 30) : "Send";
  }
  function integrationParams() { return new URLSearchParams({ assistantId: assistantId || "", widgetKey: widgetKey || "" }); }
  function showError(message) {
    const errorEl = document.createElement("div"); errorEl.className = "ai-chat-msg ai"; errorEl.textContent = message;
    msgContainer.appendChild(errorEl); msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  // Fetch Config
  async function initWidget() {
    try {
      if (!assistantId || !widgetKey) throw new Error("Missing public widget key");
      const res = await fetch(`${apiBase}/api/v1/widget/config?${integrationParams()}`);
      if (!res.ok) throw new Error("Widget integration was rejected");
      config = await res.json();
      applyWidgetSettings();

      // Merely opening a chat must not create a database record. Existing
      // conversations load their history; a new one is created on first send.
      if (state.conversationId) await loadMessages();
      state.ready = true;
      renderMessages();
    } catch (e) {
      console.warn("AI Chat Widget init failed:", e);
      showError("Der Chat ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.");
    }
  }

  async function loadMessages() {
    if (!state.conversationId || !config.organizationId) return;
    try {
      const res = await fetch(
        `${apiBase}/api/v1/widget/messages?conversationId=${state.conversationId}&organizationId=${config.organizationId}&${integrationParams()}`
      );
      if (res.ok) {
        const msgs = await res.json();
        state.messages = msgs;
        renderMessages();
      }
    } catch (e) {}
  }

  function renderMessages() {
    msgContainer.innerHTML = "";

    if (state.messages.length === 0 && config.welcomeMessage) {
      const welcomeEl = document.createElement("div");
      welcomeEl.className = "ai-chat-msg ai";
      welcomeEl.textContent = config.welcomeMessage;
      msgContainer.appendChild(welcomeEl);
    }

    state.messages.forEach((m) => {
      const msgEl = document.createElement("div");
      msgEl.className = `ai-chat-msg ${m.senderType}`;
      msgEl.textContent = m.content;
      msgContainer.appendChild(msgEl);
      if (m.senderType === "ai" && m.id) {
        const feedback = document.createElement("div");
        feedback.className = "ai-chat-feedback";
        [ [1, "👍", "Helpful"], [-1, "👎", "Not helpful"] ].forEach(([rating, label, title]) => {
          const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.title = title;
          button.addEventListener("click", () => submitFeedback(m.id, rating)); feedback.appendChild(button);
        });
        msgContainer.appendChild(feedback);
      }
    });

    if (state.loading) {
      const thinkingEl = document.createElement("div");
      thinkingEl.className = "ai-chat-thinking";
      thinkingEl.setAttribute("role", "status");
      thinkingEl.innerHTML = '<span class="ai-chat-thinking-label">KI denkt nach …</span><div class="ai-chat-thinking-track"><div class="ai-chat-thinking-bar"></div></div>';
      msgContainer.appendChild(thinkingEl);
    }

    msgContainer.scrollTop = msgContainer.scrollHeight;
    inputField.disabled = state.loading || !state.ready;
    sendBtn.disabled = state.loading || !state.ready;
  }

  async function submitFeedback(messageId, rating) {
    try {
      await fetch(`${apiBase}/api/v1/widget/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assistantId: config.assistantId, widgetKey, organizationId: config.organizationId, conversationId: state.conversationId, messageId, rating }) });
    } catch (e) {}
  }

  async function sendMessage() {
    // Email/ticket forms often paste signatures and quoted history. Remove that UI noise
    // before it becomes model input; the original remains in the host application.
    const text = inputField.value
      .replace(/\n?--\s*\n[\s\S]*$/m, "")
      .replace(/(?:^|\n)>.*(?:\n>.*)*/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 6000);
    if (!text || state.loading || !state.ready) return;

    inputField.value = "";
    state.loading = true;

    // Append local temp message
    state.messages.push({ senderType: "customer", content: text });
    renderMessages();

    try {
      const res = await fetch(`${apiBase}/api/v1/widget/message/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: config.assistantId,
          widgetKey,
          organizationId: config.organizationId,
          conversationId: state.conversationId || undefined,
          content: text,
        }),
      });

      if (!res.ok || !res.body) throw new Error("Streaming response unavailable");
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let aiMessage = null;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const events = buffer.split("\n\n"); buffer = events.pop() || "";
        for (const event of events) {
          const type = event.match(/^event: (.+)$/m)?.[1]; const raw = event.match(/^data: (.+)$/m)?.[1]; if (!raw) continue;
          const data = JSON.parse(raw);
          if (type === "token") { if (!aiMessage) { aiMessage = { senderType: "ai", content: "" }; state.messages.push(aiMessage); } aiMessage.content += data.content; renderMessages(); }
          if (type === "complete") {
            if (data.conversationId) {
              state.conversationId = data.conversationId;
              localStorage.setItem(`ai_chat_conv_id_${storageSuffix}`, data.conversationId);
            }
            if (data.customerId) {
              state.customerId = data.customerId;
              localStorage.setItem(`ai_chat_customer_id_${storageSuffix}`, data.customerId);
            }
            if (!aiMessage && data.content) { aiMessage = { senderType: "ai", content: data.content }; state.messages.push(aiMessage); }
            if (aiMessage) aiMessage.id = data.messageId;
            renderMessages();
          }
          if (type === "error") throw new Error(data.error || "Unable to process the message");
        }
      }
    } catch (e) {
      console.error(e);
      showError("Die Nachricht konnte nicht gesendet werden. Bitte erneut versuchen.");
    } finally {
      state.loading = false;
      renderMessages();
    }
  }

  launcherBtn.addEventListener("click", () => {
    state.isOpen = !state.isOpen;
    windowBox.classList.toggle("open", state.isOpen);
  });
  closeBtn.addEventListener("click", () => {
    state.isOpen = false;
    windowBox.classList.remove("open");
  });
  sendBtn.addEventListener("click", sendMessage);
  inputField.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  initWidget();
  if (autoOpen) { state.isOpen = true; windowBox.classList.add("open"); }
})();
