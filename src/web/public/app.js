const messagesEl = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const statusBar = document.getElementById("status-bar");
const settingsBtn = document.getElementById("settings-btn");
const consolePanel = document.getElementById("console-panel");
const dreamBtn = document.getElementById("dream-btn");
const memoryContent = document.getElementById("memory-content");
const memoryRefreshBtn = document.getElementById("memory-refresh-btn");
const profileContent = document.getElementById("profile-content");
const profileRefreshBtn = document.getElementById("profile-refresh-btn");
const worldEntriesList = document.getElementById("world-entries-list");
const worldKeys = document.getElementById("world-keys");
const worldContentInput = document.getElementById("world-content");
const worldAddBtn = document.getElementById("world-add-btn");
const worldRefreshBtn = document.getElementById("world-refresh-btn");
const configModel = document.getElementById("config-model");
const configCache = document.getElementById("config-cache");
const configClients = document.getElementById("config-clients");
const modelSelect = document.getElementById("model-select");
const templateSelect = document.getElementById("template-select");
const templateApply = document.getElementById("template-apply");
const personaSave = document.getElementById("persona-save");
const personaImport = document.getElementById("persona-import");

const personaEditors = {
  identity: document.getElementById("persona-identity"),
  style: document.getElementById("persona-style"),
  emotion: document.getElementById("persona-emotion"),
  constraints: document.getElementById("persona-constraints"),
  background: document.getElementById("persona-background"),
};

let ws = null;
let currentAssistantEl = null;
let reconnectTimer = null;
let typingEl = null;
let isResponding = false;
let isFirstConnect = true;

function showTypingIndicator() {
  if (typingEl) return;
  typingEl = document.createElement("div");
  typingEl.className = "message typing";
  typingEl.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  messagesEl.appendChild(typingEl);
  scrollToBottom();
}

function removeTypingIndicator() {
  if (typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const token = new URLSearchParams(location.search).get("token") || "";
  ws = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    statusBar.textContent = "已连接";
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (isFirstConnect) {
      isFirstConnect = false;
      ws.send(JSON.stringify({ type: "command", content: "/memory" }));
      ws.send(JSON.stringify({ type: "command", content: "/whoami" }));
      ws.send(JSON.stringify({ type: "command", content: "/world" }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: "command", content: "/history" }));
      }, 200);
    }
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      console.warn("畸形消息:", event.data);
      return;
    }
    handleMessage(data);
  };

  ws.onclose = (event) => {
    if (event.code === 4001) {
      statusBar.textContent = "认证失败，请使用正确的连接 URL";
      return;
    }
    statusBar.textContent = "已断开，重连中...";
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws.close();
  };
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  }
}

function handleMessage(data) {
  switch (data.type) {
    case "connected":
      if (data.clients) configClients.textContent = String(data.clients);
      break;

    case "chunk":
      if (currentAssistantEl) {
        removeTypingIndicator();
        currentAssistantEl.textContent += data.content;
        scrollToBottom();
      }
      break;

    case "start":
      isResponding = true;
      sendBtn.disabled = true;
      messageInput.disabled = true;
      sendBtn.textContent = "回复中...";
      showTypingIndicator();
      currentAssistantEl = addMessage("", "assistant");
      break;

    case "end":
      removeTypingIndicator();
      currentAssistantEl = null;
      isResponding = false;
      sendBtn.disabled = false;
      messageInput.disabled = false;
      sendBtn.textContent = "发送";
      messageInput.focus();
      break;

    case "status":
      statusBar.textContent = data.content;
      parseStatus(data.content);
      break;

    case "system":
      handleSystemMessage(data.content);
      break;

    case "error":
      addMessage(data.content, "error");
      break;

    case "config":
      try {
        const cfg = JSON.parse(data.content);
        if (cfg.characterName) {
          document.getElementById("header").querySelector("h1").textContent = cfg.characterName;
          document.title = `${cfg.characterName} - AI 女友`;
        }
      } catch (e) {
        console.error("Config parse error:", e);
      }
      break;
  }
}

function handleSystemMessage(content) {
  if (content.includes("=== 对话概要 ===")) {
    const memoryMatch = content.match(/=== 对话概要 ===\n([\s\S]*?)\n===============/);
    if (memoryMatch) {
      memoryContent.textContent = memoryMatch[1].trim() || "(暂无概要，使用 /summarize 生成)";
      return;
    }
  }

  if (content.includes("=== 我认识的你 ===")) {
    const profileMatch = content.match(/=== 我认识的你 ===\n([\s\S]*?)\n=================/);
    if (profileMatch) {
      profileContent.textContent = profileMatch[1].trim() || "还不太了解你，多聊聊吧~";
      return;
    }
  }

  if (content.includes("=== 世界书 ===")) {
    const worldMatch = content.match(/=== 世界书 ===\n([\s\S]*?)\n=============/);
    if (worldMatch) {
      parseWorldEntries(worldMatch[1].trim());
      return;
    }
  }

  if (content.includes("世界书为空")) {
    renderWorldEntries([]);
    return;
  }

  if (content.includes("已删除世界书条目") || content.includes("已添加世界书条目")) {
    setTimeout(() => refreshWorldEntries(), 100);
    return;
  }

  if (content.includes("=== 今日对话 ===")) {
    const historyMatch = content.match(/=== 今日对话 ===\n([\s\S]*?)\n================/);
    if (historyMatch) {
      const lines = historyMatch[1].trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const lineMatch = line.match(/^\[[\d:]+\]\s*(.+?):\s*(.+)$/);
        if (lineMatch) {
          const role = lineMatch[1];
          const msg = lineMatch[2];
          const type = role === "你" ? "user" : "assistant";
          addMessage(msg, type);
        }
      }
      return;
    }
  }

  addMessage(content, "system");
}

function parseWorldEntries(text) {
  if (!text) {
    renderWorldEntries([]);
    return;
  }
  const lines = text.split("\n").filter(Boolean);
  const entries = lines.map((line) => {
    const match = line.match(/\[([^\]]+)\]\s*(.+?)\s*→\s*(.+)/);
    if (match) {
      return { uid: match[1], keys: match[2].trim(), content: match[3].trim() };
    }
    return { uid: "?", keys: "", content: line };
  });
  renderWorldEntries(entries);
}

function renderWorldEntries(entries) {
  worldEntriesList.innerHTML = "";
  if (entries.length === 0) {
    const p = document.createElement("p");
    p.id = "world-empty";
    p.className = "hint-text";
    p.textContent = "世界书为空";
    worldEntriesList.appendChild(p);
    return;
  }
  for (const entry of entries) {
    const div = document.createElement("div");
    div.className = "world-entry";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "entry-delete";
    deleteBtn.dataset.uid = entry.uid;
    deleteBtn.textContent = "×";

    const keysDiv = document.createElement("div");
    keysDiv.className = "entry-keys";
    keysDiv.textContent = entry.keys;

    const contentDiv = document.createElement("div");
    contentDiv.className = "entry-content";
    contentDiv.textContent = entry.content;

    div.appendChild(deleteBtn);
    div.appendChild(keysDiv);
    div.appendChild(contentDiv);

    deleteBtn.addEventListener("click", () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "command", content: `/world-del ${entry.uid}` }));
      }
    });
    worldEntriesList.appendChild(div);
  }
}

function refreshWorldEntries() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "command", content: "/world" }));
  }
}

function parseStatus(text) {
  const cacheMatch = text.match(/缓存:\s*([\d.]+)%/);
  const modelMatch = text.match(/模型:\s*(\S+)/);

  if (cacheMatch) configCache.textContent = cacheMatch[1] + "%";
  if (modelMatch) {
    configModel.textContent = modelMatch[1];
    if (modelSelect.querySelector(`option[value="${modelMatch[1]}"]`)) {
      modelSelect.value = modelMatch[1];
    }
  }
}

function addMessage(content, type) {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  div.textContent = content;
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function sendMessage() {
  if (isResponding) return;
  const text = messageInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  addMessage(text, "user");

  sendBtn.style.transform = "scale(0.95)";
  setTimeout(() => { sendBtn.style.transform = ""; }, 150);

  if (text.startsWith("/")) {
    ws.send(JSON.stringify({ type: "command", content: text }));
  } else {
    ws.send(JSON.stringify({ type: "message", content: text }));
  }

  messageInput.value = "";
  messageInput.focus();
}

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

settingsBtn.addEventListener("click", () => {
  consolePanel.classList.toggle("show");
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

    tab.classList.add("active");
    const tabId = tab.dataset.tab;
    document.getElementById(`${tabId}-tab`).classList.add("active");
  });
});

document.querySelectorAll(".persona-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".persona-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".persona-editor").forEach((e) => e.classList.remove("active"));

    tab.classList.add("active");
    const personaId = tab.dataset.persona;
    document.getElementById(`persona-${personaId}`).classList.add("active");
  });
});

dreamBtn.addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "command", content: "/dream" }));
  }
});

memoryRefreshBtn.addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "command", content: "/memory" }));
  }
});

profileRefreshBtn.addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "command", content: "/whoami" }));
  }
});

worldAddBtn.addEventListener("click", () => {
  const keys = worldKeys.value.trim();
  const content = worldContentInput.value.trim();
  if (!keys || !content) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "command", content: `/world-add ${keys} | ${content}` }));
    worldKeys.value = "";
    worldContentInput.value = "";
  }
});

worldRefreshBtn.addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "command", content: "/world" }));
  }
});

modelSelect.addEventListener("change", () => {
  const model = modelSelect.value;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "command", content: `/model ${model}` }));
  }
});

templateApply.addEventListener("click", () => {
  const template = templateSelect.value;
  if (!template) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "command", content: `/persona-file templates/${template}.md` }));
    addMessage(`已应用模板: ${template}`, "system");
  }
});

personaSave.addEventListener("click", () => {
  const identity = personaEditors.identity.value.trim();
  const style = personaEditors.style.value.trim();
  const emotion = personaEditors.emotion.value.trim();
  const constraints = personaEditors.constraints.value.trim();
  const background = personaEditors.background.value.trim();
  const allEmpty = !identity && !style && !emotion && !constraints && !background;
  if (allEmpty) {
    addMessage("请至少填写一个人格维度再保存", "error");
    return;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    const data = JSON.stringify({ identity, style, emotion, constraints, background });
    ws.send(JSON.stringify({ type: "command", content: `/persona-save ${data}` }));
    addMessage("人格已保存", "system");
  }
});

personaImport.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".md,.txt";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result;
      personaEditors.identity.value = content;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const data = JSON.stringify({ identity: content, style: "", emotion: "", constraints: "", background: "" });
        ws.send(JSON.stringify({ type: "command", content: `/persona-save ${data}` }));
        addMessage("人格文件已导入到 identity 维度并保存", "system");
      }
    };
    reader.readAsText(file);
  };
  input.click();
});

// ===== 文件拖拽导入 =====

const chatPanel = document.getElementById("chat-panel");
let dragCounter = 0;

chatPanel.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragCounter++;
  chatPanel.classList.add("drag-over");
});

chatPanel.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0) chatPanel.classList.remove("drag-over");
});

chatPanel.addEventListener("dragover", (e) => {
  e.preventDefault();
});

chatPanel.addEventListener("drop", (e) => {
  e.preventDefault();
  dragCounter = 0;
  chatPanel.classList.remove("drag-over");

  const files = Array.from(e.dataTransfer.files);
  const validExts = [".md", ".txt"];
  const MAX_SIZE = 100 * 1024; // 100KB

  for (const file of files) {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!validExts.includes(ext)) {
      addMessage(`不支持的文件类型: ${file.name}（仅支持 .md / .txt）`, "error");
      continue;
    }
    if (file.size > MAX_SIZE) {
      addMessage(`文件太大: ${file.name}（最大 100KB）`, "error");
      continue;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result;
      if (!content.trim()) {
        addMessage(`文件为空: ${file.name}`, "error");
        return;
      }
      addMessage(`📎 ${file.name}`, "user");
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "message", content }));
      }
    };
    reader.readAsText(file);
  }
});

connect();
