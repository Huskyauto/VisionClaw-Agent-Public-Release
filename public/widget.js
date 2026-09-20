(function() {
  var VisionClawChat = window.VisionClawChat || {};
  if (VisionClawChat._initialized) return;
  VisionClawChat._initialized = true;

  var token = VisionClawChat.token || document.currentScript?.getAttribute("data-token") || "";
  var host = VisionClawChat.host || document.currentScript?.src.replace(/\/widget\.js.*$/, "") || "";
  var position = VisionClawChat.position || "right";

  if (!token) { console.warn("VisionClaw Chat: Missing token"); return; }

  var isOpen = false;
  var style = document.createElement("style");
  style.textContent = [
    ".vc-widget-btn{position:fixed;bottom:20px;" + (position === "left" ? "left:20px" : "right:20px") + ";width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border:none;cursor:pointer;box-shadow:0 4px 20px rgba(59,130,246,0.4);z-index:999999;display:flex;align-items:center;justify-content:center;transition:transform 0.2s,box-shadow 0.2s}",
    ".vc-widget-btn:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(59,130,246,0.5)}",
    ".vc-widget-btn svg{width:24px;height:24px;fill:none;stroke:white;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
    ".vc-widget-frame{position:fixed;bottom:88px;" + (position === "left" ? "left:20px" : "right:20px") + ";width:400px;height:600px;max-width:calc(100vw - 40px);max-height:calc(100vh - 120px);border:none;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.3);z-index:999998;display:none;overflow:hidden;background:#0a0a0a}",
    "@media(max-width:480px){.vc-widget-frame{width:calc(100vw - 20px);height:calc(100vh - 100px);bottom:80px;" + (position === "left" ? "left:10px" : "right:10px") + ";border-radius:12px}}"
  ].join("");
  document.head.appendChild(style);

  var btn = document.createElement("button");
  btn.className = "vc-widget-btn";
  btn.setAttribute("aria-label", "Open chat");
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  document.body.appendChild(btn);

  var iframe = document.createElement("iframe");
  iframe.className = "vc-widget-frame";
  iframe.src = host + "/public-chat/" + token;
  iframe.setAttribute("title", "Chat");
  document.body.appendChild(iframe);

  btn.addEventListener("click", function() {
    isOpen = !isOpen;
    iframe.style.display = isOpen ? "block" : "none";
    btn.innerHTML = isOpen
      ? '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  });

  window.VisionClawChat = VisionClawChat;
})();
