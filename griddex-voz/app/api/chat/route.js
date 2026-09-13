import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "../../../lib/systemPrompt";
import { TOOLS, applyTool, defaultEstado } from "../../../lib/tools";

export const runtime = "nodejs";
export const maxDuration = 30;

const MODEL = "claude-sonnet-4-5";
const MAX_TOOL_ROUNDS = 6;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("Falta configurar ANTHROPIC_API_KEY en el proyecto de Vercel."), { status: 500 });
  }
  return new Anthropic({ apiKey });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const history = Array.isArray(body.history) ? body.history : [];
    const userText = typeof body.userText === "string" ? body.userText : "";
    let estado = body.estado && typeof body.estado === "object" ? body.estado : defaultEstado();

    if (!userText.trim()) {
      return Response.json({ error: "Mensaje vacío." }, { status: 400 });
    }

    const client = getClient();
    const system = buildSystemPrompt();

    const messages = [...history, { role: "user", content: userText }];
    const newMessages = [{ role: "user", content: userText }];

    let finalText = "";
    let exportRequested = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 700,
        system,
        tools: TOOLS,
        messages,
      });

      const textParts = response.content.filter((b) => b.type === "text").map((b) => b.text);
      const toolUses = response.content.filter((b) => b.type === "tool_use");

      if (textParts.length) finalText += (finalText ? " " : "") + textParts.join(" ");

      // Record the assistant turn (text + tool_use blocks) verbatim for history continuity.
      messages.push({ role: "assistant", content: response.content });
      newMessages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        break;
      }

      const toolResults = [];
      for (const tu of toolUses) {
        const { estado: nextEstado, result } = applyTool(estado, tu.name, tu.input || {});
        estado = nextEstado;
        if (tu.name === "solicitar_exportacion" && result.ok !== false) {
          exportRequested = tu.input && tu.input.formato;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
      newMessages.push({ role: "user", content: toolResults });
    }

    return Response.json({
      texto: finalText.trim() || "De acuerdo.",
      estado,
      historyDelta: newMessages,
      exportar: exportRequested,
    });
  } catch (err) {
    console.error(err);
    const status = err && err.status ? err.status : 500;
    return Response.json({ error: err && err.message ? err.message : "Error interno." }, { status });
  }
}
