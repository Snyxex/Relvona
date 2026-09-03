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
    organizationId: null,
  };

  let state = {
    isOpen: false,
    customerId: localStorage.getItem(`ai_chat_customer_id_${storageSuffix}`) || null,
    conversationId: localStorage.getItem(`ai_chat_conv_id_${storageSuffix}`) || null,
    messages: [],
    loading: false,
    handoff: false,
  };

  // Inject Styles
  const styleTag = document.createElement("style");
  styleTag.innerHTML = `
    .ai-chat-launcher {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 30px;
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
      bottom: 96px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 580px;
      max-height: calc(100vh - 120px);
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.15);
      z-index: 99999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
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
      background: #f9fafb;
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
      background: #e5e7eb;
      color: #1f2937;
      border-bottom-left-radius: 2px;
    }
    .ai-chat-footer {
      padding: 12px;
      background: #ffffff;
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
      document.documentElement.style.setProperty("--primary-color", config.primaryColor || "#3B82F6");
      nameLabel.textContent = config.name || "Support Assistant";

      // Session setup
      const sessionRes = await fetch(`${apiBase}/api/v1/widget/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: config.assistantId,
          widgetKey,
          organizationId: config.organizationId,
        }),
      });

      if (sessionRes.ok) {
        const session = await sessionRes.json();
        state.customerId = session.customerId;
        state.conversationId = session.conversationId;
        localStorage.setItem(`ai_chat_customer_id_${storageSuffix}`, session.customerId);
        localStorage.setItem(`ai_chat_conv_id_${storageSuffix}`, session.conversationId);

        // Fetch history
        loadMessages();
      } else throw new Error("Unable to start a chat session");
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

    msgContainer.scrollTop = msgContainer.scrollHeight;
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
    if (!text || state.loading) return;

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
          conversationId: state.conversationId,
          content: text,
        }),
      });

      if (!res.ok || !res.body) throw new Error("Streaming response unavailable");
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let aiMessage = null;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || "";
        for (const event of events) {
          const type = event.match(/^event:\s*(.+)\r?$/m)?.[1]?.trim(); const raw = event.match(/^data:\s*(.+)\r?$/m)?.[1]; if (!raw) continue;
          const data = JSON.parse(raw);
          if (type === "token") { if (!aiMessage) { aiMessage = { senderType: "ai", content: "" }; state.messages.push(aiMessage); } aiMessage.content += data.content; renderMessages(); }
          if (type === "complete") {
            if (!aiMessage && data.content) {
              aiMessage = { id: data.messageId, senderType: "ai", content: data.content };
              state.messages.push(aiMessage);
            } else if (aiMessage) {
              aiMessage.id = data.messageId;
            } else {
              // Older backends and cached answers may send only a completion
              // event. The answer is already persisted, so fetch it instead of
              // silently leaving the customer without a reply.
              await loadMessages();
            }
            renderMessages();
          }
          if (type === "error") throw new Error(data.error || "Unable to process the message");
        }
      }
      // Keep the browser view consistent with persisted conversation state even
      // when an intermediary buffered, stripped, or malformed SSE events.
      if (!aiMessage) await loadMessages();
    } catch (e) {
      console.error(e);
      showError("Die Nachricht konnte nicht gesendet werden. Bitte erneut versuchen.");
    } finally {
      state.loading = false;
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
