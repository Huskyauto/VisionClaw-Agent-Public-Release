import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { Bot, Send, MessageCircle, Loader2, AlertCircle } from "lucide-react";

interface Message {
  id?: number;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface ChatConfig {
  tenantName: string;
  personaName: string;
  personaIcon: string;
  personaRole: string;
}

export default function PublicChatPage({ mode = "token" }: { mode?: "token" | "slug" }) {
  const params = useParams<{ token?: string; slug?: string }>();
  const identifier = mode === "slug" ? params.slug : params.token;
  const apiBase = mode === "slug" ? `/api/c/${identifier}` : `/api/public-chat/${identifier}`;

  const [config, setConfig] = useState<ChatConfig | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    async function init() {
      try {
        const configRes = await fetch(`${apiBase}/config`);
        if (!configRes.ok) {
          setError("This chat link is no longer available.");
          setIsLoading(false);
          return;
        }
        const configData = await configRes.json();
        setConfig(configData);

        const convRes = await fetch(`${apiBase}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!convRes.ok) throw new Error("Failed to start conversation");
        const { conversationId: cid } = await convRes.json();
        setConversationId(cid);
        setIsLoading(false);
      } catch {
        setError("Unable to connect. Please try again later.");
        setIsLoading(false);
      }
    }
    if (identifier) init();
  }, [identifier, apiBase]);

  async function sendMessage() {
    if (!input.trim() || !conversationId || isSending) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsSending(true);

    const assistantIdx = messages.length + 1;
    setMessages((prev) => [...prev, { role: "assistant", content: "", isStreaming: true }]);

    try {
      const response = await fetch(
        `${apiBase}/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: userMessage }),
        }
      );

      if (!response.ok) throw new Error("Failed to send");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullContent += data.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIdx] = {
                    role: "assistant",
                    content: fullContent,
                    isStreaming: true,
                  };
                  return updated;
                });
              }
              if (data.done) {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIdx] = {
                    role: "assistant",
                    content: fullContent,
                    isStreaming: false,
                  };
                  return updated;
                });
              }
              if (data.error) {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIdx] = {
                    role: "assistant",
                    content: "Sorry, something went wrong. Please try again.",
                    isStreaming: false,
                  };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[assistantIdx]) {
          updated[assistantIdx] = {
            role: "assistant",
            content: "Sorry, I couldn't process that. Please try again.",
            isStreaming: false,
          };
        }
        return updated;
      });
    }

    setIsSending(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Connecting...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-white text-lg font-medium mb-2">Chat Unavailable</h2>
          <p className="text-gray-400 text-sm" data-testid="text-public-chat-error">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 flex flex-col">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm px-4 py-3 shrink-0">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm" data-testid="text-persona-name">
              {config?.personaName || "AI Assistant"}
            </h1>
            <p className="text-gray-500 text-xs">{config?.personaRole || "Assistant"}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="public-chat-welcome">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center mb-6">
                <MessageCircle className="w-8 h-8 text-blue-400" />
              </div>
              <h2 className="text-white text-xl font-semibold mb-2">
                Chat with {config?.personaName || "AI"}
              </h2>
              <p className="text-gray-400 text-sm max-w-sm">
                Send a message to start the conversation. I'm here to help!
              </p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`mb-4 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              data-testid={`message-${msg.role}-${idx}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-md"
                    : "bg-gray-800 text-gray-100 rounded-bl-md border border-gray-700/50"
                }`}
              >
                {msg.role === "assistant" && !msg.content && msg.isStreaming ? (
                  <div className="flex items-center gap-2 text-gray-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span className="text-xs">Thinking...</span>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                )}
                {msg.isStreaming && msg.content && (
                  <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className="border-t border-gray-800 bg-gray-950/80 backdrop-blur-sm px-4 py-3 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 bg-gray-800/50 rounded-2xl border border-gray-700/50 px-4 py-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              className="flex-1 bg-transparent text-white placeholder-gray-500 text-sm resize-none outline-none min-h-[24px] max-h-[120px]"
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
              disabled={isSending}
              data-testid="input-public-chat-message"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isSending}
              className="shrink-0 w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 flex items-center justify-center transition-colors text-white"
              data-testid="button-send-public-chat"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-center text-gray-600 text-[10px] mt-2">
            Powered by <span className="text-gray-500 font-medium">VisionClaw</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
