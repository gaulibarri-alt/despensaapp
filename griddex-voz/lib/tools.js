// Definición de herramientas (function calling) para el agente de voz de viabilidad eléctrica.
// Cada herramienta muta una copia del "estado" del expediente y devuelve {estado, result}.

const ESTADOS_VALIDOS = [
  "PENDIENTE DE DATOS",
  "EN ANÁLISIS",
  "VIABLE",
  "VIABLE CON CONDICIONES",
  "NO VIABLE CON RED ACTUAL",
  "REQUIERE ESTUDIO DISTRIBUIDORA",
];

function defaultEstado() {
  return {
    identificacion: { expediente: null, cliente: null, direccion: null, municipio: null, provincia: null },
    solicitud: { tipo: null, potencia_actual_kw: null, potencia_solicitada_kw: null, tension_v: null, uso_instalacion: null },
    ct: { codigo: null, potencia_kva: null, carga_actual: null, numero_salidas_bt: null },
    red: { tramos: [] },
    condicionantes: [],
    alternativas: [],
    calculos: {},
    datos_pendientes: [],
    conclusion: { estado: "PENDIENTE DE DATOS", potencia_viable_kw: null, justificacion: null },
    informe_markdown: null,
    exportar_solicitado: null,
    _siguiente_tramo: 1,
  };
}

const TOOLS = [
  {
    name: "actualizar_identificacion",
    description: "Registra o corrige datos de identificación del expediente (expediente, cliente, dirección, municipio, provincia). Solo incluye los campos que cambian.",
    input_schema: {
      type: "object",
      properties: {
        expediente: { type: "string" },
        cliente: { type: "string" },
        direccion: { type: "string" },
        municipio: { type: "string" },
        provincia: { type: "string" },
      },
    },
  },
  {
    name: "actualizar_solicitud",
    description: "Registra o corrige datos de la solicitud: tipo (nuevo suministro / aumento / reforma / modificación / ampliación), potencia actual y solicitada en kW, tensión en V, uso de la instalación.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string" },
        potencia_actual_kw: { type: "number" },
        potencia_solicitada_kw: { type: "number" },
        tension_v: { type: "number" },
        uso_instalacion: { type: "string" },
      },
    },
  },
  {
    name: "actualizar_ct",
    description: "Registra o corrige datos del centro de transformación: código, potencia nominal en kVA, carga actual (texto libre con el valor y a qué corresponde, p.ej. '68% en salida BT 3'), número de salidas BT.",
    input_schema: {
      type: "object",
      properties: {
        codigo: { type: "string" },
        potencia_kva: { type: "number" },
        carga_actual: { type: "string" },
        numero_salidas_bt: { type: "integer" },
      },
    },
  },
  {
    name: "anadir_tramo",
    description: "Añade un nuevo tramo de red de baja tensión. Nunca reutilices esto para modificar un tramo existente: usa editar_tramo. El sistema asigna automáticamente el número de tramo y lo devuelve en el resultado.",
    input_schema: {
      type: "object",
      properties: {
        origen: { type: "string" },
        fin: { type: "string" },
        tipo: { type: "string", description: "aerea, subterranea, fachada, interior" },
        cable: { type: "string" },
        material: { type: "string", description: "Al o Cu" },
        fases: { type: "string", description: "p.ej. 3x240" },
        neutro: { type: "string", description: "p.ej. 1x150" },
        longitud_m: { type: "number" },
        carga_actual_a: { type: "number" },
        observaciones: { type: "string" },
      },
      required: ["origen", "fin"],
    },
  },
  {
    name: "editar_tramo",
    description: "Modifica campos de un tramo ya existente, identificado por su número.",
    input_schema: {
      type: "object",
      properties: {
        tramo_numero: { type: "integer" },
        origen: { type: "string" },
        fin: { type: "string" },
        tipo: { type: "string" },
        cable: { type: "string" },
        material: { type: "string" },
        fases: { type: "string" },
        neutro: { type: "string" },
        longitud_m: { type: "number" },
        carga_actual_a: { type: "number" },
        observaciones: { type: "string" },
      },
      required: ["tramo_numero"],
    },
  },
  {
    name: "eliminar_tramo",
    description: "Elimina un tramo por su número, si el ingeniero indica que no existe o se registró por error.",
    input_schema: {
      type: "object",
      properties: { tramo_numero: { type: "integer" } },
      required: ["tramo_numero"],
    },
  },
  {
    name: "anadir_condicionante",
    description: "Registra un condicionante de trazado (carretera, río, ADIF, servidumbre, etc.).",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" } },
      required: ["texto"],
    },
  },
  {
    name: "eliminar_condicionante",
    description: "Elimina un condicionante previamente registrado que ya no aplica, buscando por texto aproximado.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" } },
      required: ["texto"],
    },
  },
  {
    name: "anadir_alternativa",
    description: "Registra una alternativa técnicamente justificada (refuerzo, nueva línea, nuevo CT, cambio de trazado, etc.).",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" } },
      required: ["texto"],
    },
  },
  {
    name: "registrar_calculo",
    description: "Registra el resultado de un cálculo técnico ya realizado (intensidad, caída de tensión, carga adicional, etc.), incluyendo la fórmula o hipótesis usada si procede.",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        valor: { type: "string" },
        formula: { type: "string" },
        hipotesis: { type: "string", description: "Si se ha usado una hipótesis autorizada por el ingeniero, descríbela aquí." },
      },
      required: ["nombre", "valor"],
    },
  },
  {
    name: "actualizar_pendientes",
    description: "Añade o quita un elemento de la lista de información pendiente.",
    input_schema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["añadir", "quitar"] },
        texto: { type: "string" },
      },
      required: ["accion", "texto"],
    },
  },
  {
    name: "actualizar_conclusion",
    description: "Actualiza el estado de viabilidad del estudio. Usa exactamente uno de los estados permitidos. Nunca marques VIABLE sin base suficiente.",
    input_schema: {
      type: "object",
      properties: {
        estado: { type: "string", enum: ESTADOS_VALIDOS },
        potencia_viable_kw: { type: "number" },
        justificacion: { type: "string" },
      },
      required: ["estado"],
    },
  },
  {
    name: "actualizar_borrador_informe",
    description: "Guarda o reemplaza el texto completo del borrador del informe de viabilidad, en formato Markdown, siguiendo la estructura de 8 apartados. Debe empezar con '# INFORME DE VIABILIDAD ELÉCTRICA'.",
    input_schema: {
      type: "object",
      properties: { markdown: { type: "string" } },
      required: ["markdown"],
    },
  },
  {
    name: "solicitar_exportacion",
    description: "Marca que el ingeniero ha pedido exportar/descargar el estudio en un formato concreto.",
    input_schema: {
      type: "object",
      properties: { formato: { type: "string", enum: ["word", "json"] } },
      required: ["formato"],
    },
  },
];

function mergeDefined(target, patch) {
  for (const k of Object.keys(patch || {})) {
    if (patch[k] !== undefined && patch[k] !== null && patch[k] !== "") {
      target[k] = patch[k];
    }
  }
  return target;
}

function applyTool(estado, toolName, input) {
  const s = JSON.parse(JSON.stringify(estado));
  let result = { ok: true };

  switch (toolName) {
    case "actualizar_identificacion":
      mergeDefined(s.identificacion, input);
      break;

    case "actualizar_solicitud":
      mergeDefined(s.solicitud, input);
      break;

    case "actualizar_ct":
      mergeDefined(s.ct, input);
      break;

    case "anadir_tramo": {
      const numero = s._siguiente_tramo || (s.red.tramos.length + 1);
      const tramo = {
        tramo: numero,
        origen: input.origen || null,
        fin: input.fin || null,
        tipo: input.tipo || null,
        cable: input.cable || null,
        material: input.material || null,
        fases: input.fases || null,
        neutro: input.neutro || null,
        longitud_m: input.longitud_m ?? null,
        carga_actual_a: input.carga_actual_a ?? null,
        observaciones: input.observaciones || null,
      };
      s.red.tramos.push(tramo);
      s._siguiente_tramo = numero + 1;
      result = { ok: true, tramo_numero: numero };
      break;
    }

    case "editar_tramo": {
      const t = s.red.tramos.find((x) => x.tramo === input.tramo_numero);
      if (!t) {
        result = { ok: false, error: "No existe un tramo con ese número." };
      } else {
        const { tramo_numero, ...patch } = input;
        mergeDefined(t, patch);
        result = { ok: true, tramo: t };
      }
      break;
    }

    case "eliminar_tramo": {
      const before = s.red.tramos.length;
      s.red.tramos = s.red.tramos.filter((x) => x.tramo !== input.tramo_numero);
      result = { ok: s.red.tramos.length < before };
      break;
    }

    case "anadir_condicionante":
      s.condicionantes.push(input.texto);
      break;

    case "eliminar_condicionante": {
      const needle = (input.texto || "").toLowerCase();
      s.condicionantes = s.condicionantes.filter((c) => !c.toLowerCase().includes(needle));
      break;
    }

    case "anadir_alternativa":
      s.alternativas.push(input.texto);
      break;

    case "registrar_calculo":
      s.calculos[input.nombre] = {
        valor: input.valor,
        formula: input.formula || null,
        hipotesis: input.hipotesis || null,
      };
      break;

    case "actualizar_pendientes":
      if (input.accion === "añadir") {
        if (!s.datos_pendientes.includes(input.texto)) s.datos_pendientes.push(input.texto);
      } else if (input.accion === "quitar") {
        const needle = (input.texto || "").toLowerCase();
        s.datos_pendientes = s.datos_pendientes.filter((p) => !p.toLowerCase().includes(needle));
      }
      break;

    case "actualizar_conclusion":
      mergeDefined(s.conclusion, input);
      break;

    case "actualizar_borrador_informe":
      s.informe_markdown = input.markdown;
      break;

    case "solicitar_exportacion":
      s.exportar_solicitado = input.formato;
      break;

    default:
      result = { ok: false, error: "Herramienta desconocida: " + toolName };
  }

  return { estado: s, result };
}

module.exports = { TOOLS, applyTool, defaultEstado, ESTADOS_VALIDOS };
