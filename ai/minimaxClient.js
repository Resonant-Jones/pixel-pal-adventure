const http = require("http");
const https = require("https");

const { getMiniMaxConfig, validateMiniMaxConfig } = require("../config/minimax");

function postJson(urlString, { headers = {}, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const client = url.protocol === "https:" ? https : http;

    const request = client.request(
      {
        method: "POST",
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers
        }
      },
      (response) => {
        let data = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          const statusCode = response.statusCode || 500;

          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(`MiniMax request failed (${statusCode}): ${data || "empty response body"}`)
            );
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`MiniMax returned invalid JSON: ${error.message}`));
          }
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`MiniMax request timed out after ${timeoutMs}ms`));
    });

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function stripCodeFences(text) {
  return text.replace(/^```(?:json)?\s*|\s*```$/gim, "").trim();
}

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJsonObject(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function normalizeMessageContent(response) {
  const content = response?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        return part?.text || part?.content || "";
      })
      .join("");
  }

  return "";
}

function normalizeAction(action) {
  if (!action) {
    return { type: "none" };
  }

  if (typeof action === "string") {
    return { type: action.toLowerCase() };
  }

  const type = String(action.type || action.name || action.action || "none").toLowerCase();
  return { ...action, type };
}

const ALLOWED_ACTION_TYPES = new Set([
  "none",
  "chat",
  "follow_player",
  "stop_following",
  "move_to",
  "look_at",
  "compose_structure",
  "build_structure",
  "inventory_status",
  "inspect_build_site",
  "plan_build",
  "clear_footprint",
  "place_block",
  "break_block",
  "continue_build_phase",
  "repair_failed_step",
  "gather_materials",
  "explain_build_plan",
  "finalize_build",
  "start_emergent_build"
]);

function sanitizeAction(action) {
  const normalized = normalizeAction(action);
  if (!ALLOWED_ACTION_TYPES.has(normalized.type)) {
    return { type: "none" };
  }

  return normalized;
}

function normalizeStructuredResponse(parsed, raw) {
  if (!parsed || typeof parsed !== "object") {
    return {
      message: "",
      action: { type: "none" },
      raw,
      parseMode: "rejected"
    };
  }

  const action = sanitizeAction(parsed.action);
  if (action.target === undefined && parsed.target !== undefined) {
    action.target = parsed.target;
  }

  if (action.coordinates === undefined && parsed.coordinates !== undefined) {
    action.coordinates = parsed.coordinates;
  }

  if (action.position === undefined && parsed.position !== undefined) {
    action.position = parsed.position;
  }

  if (action.player === undefined && parsed.player !== undefined) {
    action.player = parsed.player;
  }

  const message =
    typeof parsed.message === "string"
      ? parsed.message.trim()
      : typeof parsed.reply === "string"
        ? parsed.reply.trim()
        : typeof action.message === "string"
          ? action.message.trim()
        : "";

  return {
    message,
    action,
    task: parsed.task && typeof parsed.task === "object" ? parsed.task : null,
    raw,
    parseMode: "structured"
  };
}

function looksLikeStructuredLeak(text) {
  const normalized = String(text || "").trim();

  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("{") || normalized.startsWith("```")) {
    return true;
  }

  return /"message"\s*:|"action"\s*:|"type"\s*:\s*"[^"]+"/i.test(normalized);
}

function parseStructuredResponse(content) {
  const cleaned = stripThinking(stripCodeFences(content));

  try {
    return normalizeStructuredResponse(JSON.parse(cleaned), content);
  } catch (directError) {
    const candidate = extractJsonObject(cleaned);

    if (candidate) {
      try {
        return normalizeStructuredResponse(JSON.parse(candidate), content);
      } catch (nestedError) {
        void nestedError;
      }
    }

    if (looksLikeStructuredLeak(cleaned)) {
      return {
        message: "",
        action: { type: "none" },
        raw: content,
        parseMode: "rejected"
      };
    }

    return {
      message: cleaned,
      action: { type: "none" },
      raw: content,
      parseMode: "freeform_fallback"
    };
  }
}

function normalizeFreeformText(content) {
  return stripThinking(stripCodeFences(content))
    .replace(/\s+/g, " ")
    .trim();
}

class MiniMaxClient {
  constructor(config = getMiniMaxConfig()) {
    validateMiniMaxConfig(config);
    this.config = config;
  }

  async requestChatCompletion({
    systemPrompt,
    userPrompt,
    temperature = this.config.temperature,
    maxTokens = this.config.maxTokens
  }) {
    const response = await postJson(`${this.config.baseUrl}/chat/completions`, {
      timeoutMs: this.config.timeoutMs,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: {
        model: this.config.model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ]
      }
    });

    const content = normalizeMessageContent(response);

    if (!content) {
      throw new Error("MiniMax returned no assistant message content.");
    }

    return {
      content,
      providerResponse: response
    };
  }

  async complete({ systemPrompt, userPrompt }) {
    const { content, providerResponse } = await this.requestChatCompletion({
      systemPrompt,
      userPrompt
    });

    return {
      ...parseStructuredResponse(content),
      providerResponse
    };
  }

  async summarizeAdventure({ systemPrompt, userPrompt }) {
    const { content, providerResponse } = await this.requestChatCompletion({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 120
    });

    return {
      summary: normalizeFreeformText(content),
      providerResponse
    };
  }
}

module.exports = {
  MiniMaxClient,
  parseStructuredResponse
};
