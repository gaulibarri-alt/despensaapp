"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { defaultEstado } from "../lib/tools";
import { markdownToHtml } from "../lib/markdown";

const GREETING = "Vamos a iniciar el estudio de viabilidad. Iré registrando los datos y te preguntaré únicamente lo que vaya necesitando. ¿Dónde está la instalación y qué potencia se solicita?";
const REPORT_SECTIONS = [
  "1. OBJETO", "2. ANTECEDENTES", "3. EMPLAZAMIENTO", "4. INFRAESTRUCTURA",
  "5. ANÁLISIS", "6. ALTERNATIVAS", "7. SOLUCIÓN PROPUESTA", "8. CONCLUSIONES",
];

function slug(s) {
  return (s || "pendiente").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function val(v, unit) {
  if (v === null || v === undefined || v === "") return <span className="na">— pendiente —</span>;
  return <span className="mono">{String(v)}{unit ? " " + unit : ""}</span>;
}
function plainVal(v) {
  if (v === null || v === undefined || v === "") return <span className="na">— pendiente —</span>;
  return String(v);
}

export default function Home() {
  const [estado, setEstado] = useState(defaultEstado());
  const [voiceStatus, setVoiceStatus] = useState("pausado"); // pausado | escuchando | procesando | hablando
  const [micActive, setMicActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcriptLive, setTranscriptLive] = useState("");
  const [lastSpoken, setLastSpoken] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [errorBanner, setErrorBanner] = useState("");
  const [savingMsg, setSavingMsg] = useState("");
  const [showFullInforme, setShowFullInforme] = useState(false);

  const historyRef = useRef([]);
  const recognitionRef = useRef(null);
  const recognitionAvailableRef = useRef(true);
  const finalBufferRef = useRef("");
  const debounceTimerRef = useRef(null);
  const micActiveRef = useRef(false);
  const mutedRef = useRef(false);
  const estadoRef = useRef(estado);
  const busyRef = useRef(false);

  useEffect(() => { estadoRef.current = estado; }, [estado]);
  useEffect(() => { micActiveRef.current = micActive; }, [micActive]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // ---------- Speech recognition setup ----------
  useEffect(() => {
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) {
      recognitionAvailableRef.current = false;
      setErrorBanner("Este navegador no soporta reconocimiento de voz. Prueba con Chrome de escritorio o Android.");
      return;
    }
    const recognition = new SR();
    recognition.lang = "es-ES";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      // Barge-in: si el agente está hablando y detectamos voz nueva, lo cortamos.
      if (typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        setVoiceStatus("escuchando");
      }
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalBufferRef.current = (finalBufferRef.current ? finalBufferRef.current + " " : "") + chunk.trim();
        } else {
          interim += chunk;
        }
      }
      setTranscriptLive((finalBufferRef.current + " " + interim).trim());

      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        const text = finalBufferRef.current.trim();
        finalBufferRef.current = "";
        if (text) sendTurn(text);
      }, 900);
    };

    recognition.onend = () => {
      // Reinicia automáticamente si el micrófono debía seguir activo (Chrome corta la sesión cada cierto tiempo).
      if (micActiveRef.current) {
        try { recognition.start(); } catch (e) { /* ya en marcha */ }
      }
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setErrorBanner("Permiso de micrófono denegado. Actívalo en los ajustes del navegador para poder hablar con el agente.");
        setMicActive(false);
      }
    };

    recognitionRef.current = recognition;
    return () => {
      try { recognition.stop(); } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- TTS ----------
  const speak = useCallback((text) => {
    setLastSpoken(text);
    if (!text || typeof window === "undefined" || !window.speechSynthesis || mutedRef.current) {
      setVoiceStatus(micActiveRef.current ? "escuchando" : "pausado");
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "es-ES";
    const voices = window.speechSynthesis.getVoices();
    const esVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("es"));
    if (esVoice) utter.voice = esVoice;
    utter.onstart = () => setVoiceStatus("hablando");
    utter.onend = () => setVoiceStatus(micActiveRef.current ? "escuchando" : "pausado");
    utter.onerror = () => setVoiceStatus(micActiveRef.current ? "escuchando" : "pausado");
    window.speechSynthesis.speak(utter);
  }, []);

  // ---------- Turn handling ----------
  const sendTurn = useCallback(async (userText) => {
    if (busyRef.current || !userText || !userText.trim()) return;
    busyRef.current = true;
    setVoiceStatus("procesando");
    setErrorBanner("");
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: historyRef.current, userText, estado: estadoRef.current }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Error del servidor.");
      historyRef.current = historyRef.current.concat(data.historyDelta || []);
      setEstado(data.estado);
      if (data.exportar === "word") triggerExportWord(data.estado);
      if (data.exportar === "json") triggerExportJson(data.estado);
      speak(data.texto);
    } catch (err) {
      console.error(err);
      setErrorBanner("⚠️ " + (err.message || "No se ha podido conectar con el agente."));
      speak("He tenido un problema de conexión. ¿Puedes repetirlo?");
    } finally {
      busyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speak]);

  // ---------- Controls ----------
  function startConversation() {
    if (!recognitionAvailableRef.current) return;
    setMicActive(true);
    micActiveRef.current = true;
    try { recognitionRef.current && recognitionRef.current.start(); } catch (e) {}
    if (historyRef.current.length === 0) {
      historyRef.current = [{ role: "assistant", content: GREETING }];
      speak(GREETING);
    } else {
      setVoiceStatus("escuchando");
    }
  }
  function pauseMic() {
    setMicActive(false);
    micActiveRef.current = false;
    try { recognitionRef.current && recognitionRef.current.stop(); } catch (e) {}
    setVoiceStatus("pausado");
  }
  function toggleMuted() {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      if (next && typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
      return next;
    });
  }
  function finalizarEstudio() {
    pauseMic();
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }
  function nuevoEstudio() {
    if (!confirm("¿Seguro que quieres empezar un estudio nuevo? Se perderá la conversación actual.")) return;
    finalizarEstudio();
    historyRef.current = [];
    setEstado(defaultEstado());
    setTranscriptLive("");
    setLastSpoken("");
  }
  function generarInforme() { sendTurn("Redacta el informe."); }

  function openManual() {
    setManualText(JSON.stringify(estado, null, 2));
    setManualOpen(true);
  }
  function saveManual() {
    try {
      const parsed = JSON.parse(manualText);
      setEstado(parsed);
      setManualOpen(false);
    } catch (e) {
      alert("El JSON no es válido: " + e.message);
    }
  }

  async function triggerExportWord(estadoActual) {
    try {
      const resp = await fetch("/api/export-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: estadoActual }),
      });
      if (!resp.ok) throw new Error("No se ha podido generar el Word.");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Informe_Viabilidad.docx";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      setErrorBanner("⚠️ " + e.message);
    }
  }
  function triggerExportJson(estadoActual) {
    const blob = new Blob([JSON.stringify(estadoActual, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "Ficha_Viabilidad.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function guardarEstudio() {
    setSavingMsg("Guardando…");
    try {
      const resp = await fetch("/api/studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      const data = await resp.json();
      setSavingMsg(data.ok ? "Estudio guardado ✓" : "Sin almacenamiento conectado en este despliegue todavía.");
    } catch (e) {
      setSavingMsg("No se ha podido guardar.");
    }
    setTimeout(() => setSavingMsg(""), 4000);
  }

  const tramos = (estado.red && estado.red.tramos) || [];
  const pendientes = estado.datos_pendientes || [];
  const condicionantes = estado.condicionantes || [];
  const alternativas = estado.alternativas || [];
  const calculos = estado.calculos || {};
  const informe = estado.informe_markdown;

  return (
    <div id="appRoot">
      <header className="topbar">
        <div className="brand">
          <div className="name">GRIDDE<span className="accent">x</span> · Voz</div>
          <div className="tag">Copiloto de voz para viabilidad eléctrica</div>
        </div>
        <div className={"status-pill status-" + slug(estado.conclusion.estado)}>
          {estado.conclusion.estado || "PENDIENTE DE DATOS"}
        </div>
        <button className="btn" onClick={openManual}>Corregir manualmente</button>
        <button className="btn" onClick={guardarEstudio}>Guardar estudio</button>
        <button className="btn" onClick={nuevoEstudio}>Nuevo estudio</button>
      </header>

      {errorBanner && (
        <div style={{ background: "#FBEAE5", color: "#7A2E1B", padding: "8px 20px", fontSize: 12.5 }}>{errorBanner}</div>
      )}
      {savingMsg && (
        <div style={{ background: "#EFF6E4", color: "#375f22", padding: "6px 20px", fontSize: 12.5 }}>{savingMsg}</div>
      )}

      <div className="layout">
        <section className="col-datos">
          <div className="panel-title">Datos del expediente</div>

          <div className={"ficha-block" + (pendientes.length ? " has-items" : "")}>
            <h3>Pendiente <span className="count">{pendientes.length}</span></h3>
            {pendientes.length ? (
              <ul className="pend-list">{pendientes.map((p, i) => <li key={i}>{p}</li>)}</ul>
            ) : <p className="muted">Sin información pendiente registrada.</p>}
          </div>

          <div className="ficha-block">
            <h3>Identificación</h3>
            <div className="row"><span>Expediente</span><span>{val(estado.identificacion.expediente)}</span></div>
            <div className="row"><span>Cliente</span><span>{plainVal(estado.identificacion.cliente)}</span></div>
            <div className="row"><span>Dirección</span><span>{plainVal(estado.identificacion.direccion)}</span></div>
            <div className="row"><span>Municipio</span><span>{plainVal(estado.identificacion.municipio)}</span></div>
            <div className="row"><span>Provincia</span><span>{plainVal(estado.identificacion.provincia)}</span></div>
          </div>

          <div className="ficha-block">
            <h3>Solicitud</h3>
            <div className="row"><span>Tipo</span><span>{plainVal(estado.solicitud.tipo)}</span></div>
            <div className="row"><span>Potencia actual</span><span>{val(estado.solicitud.potencia_actual_kw, "kW")}</span></div>
            <div className="row"><span>Potencia solicitada</span><span>{val(estado.solicitud.potencia_solicitada_kw, "kW")}</span></div>
            <div className="row"><span>Tensión</span><span>{val(estado.solicitud.tension_v, "V")}</span></div>
            <div className="row"><span>Uso</span><span>{plainVal(estado.solicitud.uso_instalacion)}</span></div>
          </div>

          <div className="ficha-block">
            <h3>Centro de transformación</h3>
            <div className="row"><span>Código</span><span>{val(estado.ct.codigo)}</span></div>
            <div className="row"><span>Potencia</span><span>{val(estado.ct.potencia_kva, "kVA")}</span></div>
            <div className="row"><span>Carga actual</span><span>{plainVal(estado.ct.carga_actual)}</span></div>
            <div className="row"><span>Salidas BT</span><span>{val(estado.ct.numero_salidas_bt)}</span></div>
          </div>

          <div className="ficha-block">
            <h3>Red BT</h3>
            {tramos.length ? tramos.map((t) => (
              <div className="tramo-card" key={t.tramo}>
                <div className="tramo-head"><span className="mono">Tramo {t.tramo}</span><span>{t.tipo || "—"}</span></div>
                <div className="row"><span>Origen → Fin</span><span>{t.origen || "—"} → {t.fin || "—"}</span></div>
                <div className="row"><span>Cable</span><span className="mono">{[t.cable, t.material, t.fases, t.neutro].filter(Boolean).join(" ") || "—"}</span></div>
                <div className="row"><span>Longitud</span><span>{val(t.longitud_m, "m")}</span></div>
                <div className="row"><span>Carga actual</span><span>{val(t.carga_actual_a, "A")}</span></div>
              </div>
            )) : <p className="muted">Sin tramos registrados todavía.</p>}
          </div>

          <div className="ficha-block">
            <h3>Condicionantes</h3>
            {condicionantes.length ? <ul>{condicionantes.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="muted">Ninguno registrado.</p>}
          </div>

          <div className="ficha-block">
            <h3>Cálculos</h3>
            {Object.keys(calculos).length ? Object.entries(calculos).map(([k, v]) => (
              <div className="row" key={k}><span>{k}</span><span className="mono">{typeof v === "object" ? v.valor : v}</span></div>
            )) : <p className="muted">Sin cálculos realizados todavía.</p>}
          </div>

          <div className="ficha-block">
            <h3>Alternativas</h3>
            {alternativas.length ? <ul>{alternativas.map((a, i) => <li key={i}>{a}</li>)}</ul> : <p className="muted">Ninguna planteada.</p>}
          </div>

          <div className="ficha-block">
            <h3>Conclusión</h3>
            <div className="row"><span>Estado</span><span className={"status-tag status-" + slug(estado.conclusion.estado)}>{estado.conclusion.estado}</span></div>
            <div className="row"><span>Potencia viable</span><span>{val(estado.conclusion.potencia_viable_kw, "kW")}</span></div>
            <p className="justif">{estado.conclusion.justificacion || <span className="na">Sin justificación todavía.</span>}</p>
          </div>
        </section>

        <section className="col-borrador">
          <div className="panel-title">Borrador del informe</div>
          <ul className="outline-list">
            {REPORT_SECTIONS.map((s) => {
              const done = informe && informe.toUpperCase().includes(s.split(". ")[1]);
              return (
                <li key={s} className={done ? "done" : ""}>
                  <span className="outline-check">{done ? "✓" : ""}</span>{s}
                </li>
              );
            })}
          </ul>

          {informe ? (
            <>
              <button className="btn light" style={{ marginBottom: 12 }} onClick={() => setShowFullInforme((v) => !v)}>
                {showFullInforme ? "Ocultar informe completo" : "Ver informe completo"}
              </button>
              {showFullInforme && (
                <div className="informe-view" dangerouslySetInnerHTML={{ __html: markdownToHtml(informe) }} />
              )}
            </>
          ) : (
            <div className="informe-empty">Aún no hay borrador. Di «redacta el informe» o pulsa «Generar informe».</div>
          )}
        </section>
      </div>

      <footer className="bottombar">
        <div className="voice-status-row">
          <div className={"voice-indicator " + voiceStatus}>
            <span className="dot" />
            {voiceStatus === "escuchando" && "ESCUCHANDO"}
            {voiceStatus === "hablando" && "AGENTE HABLANDO"}
            {voiceStatus === "procesando" && "PROCESANDO"}
            {voiceStatus === "pausado" && "PAUSADO"}
          </div>
          <div className="transcript-live">{transcriptLive || lastSpoken}</div>
        </div>
        <div className="controls-row">
          {!micActive ? (
            <button className="btn primary" onClick={startConversation}>🎙️ Iniciar conversación</button>
          ) : (
            <button className="btn" onClick={pauseMic}>⏸ Pausar micrófono</button>
          )}
          <button className="btn" onClick={toggleMuted}>{muted ? "🔇 Agente silenciado" : "🔊 Silenciar agente"}</button>
          <button className="btn" onClick={generarInforme}>Generar informe</button>
          <button className="btn light" onClick={() => triggerExportWord(estado)} disabled={!informe}>Exportar Word</button>
          <button className="btn light" onClick={() => triggerExportJson(estado)}>Exportar JSON</button>
          <button className="btn danger" onClick={finalizarEstudio}>Finalizar estudio</button>
        </div>
      </footer>

      <div className={"modal-overlay" + (manualOpen ? " open" : "")}>
        <div className="modal">
          <div className="modal-head">
            <h2>Corrección manual del expediente</h2>
            <button className="icon-btn-close" onClick={() => setManualOpen(false)}>✕</button>
          </div>
          <div className="modal-body">
            <p className="hint">Edita el JSON del estudio directamente. Útil para correcciones rápidas sin pasar por voz. Ten cuidado de mantener un JSON válido.</p>
            <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} spellCheck={false} />
          </div>
          <div className="modal-foot">
            <button className="btn light" onClick={() => setManualOpen(false)}>Cancelar</button>
            <button className="btn primary" onClick={saveManual}>Guardar cambios</button>
          </div>
        </div>
      </div>
    </div>
  );
}
