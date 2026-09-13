# GRIDDEx · Agente de voz para viabilidad eléctrica

Copiloto técnico por voz para estudios de viabilidad eléctrica. Habla, el agente
escucha, responde por voz y va construyendo el expediente estructurado y el
borrador del informe en tiempo real.

## Arquitectura

```
Navegador (React / Next.js)
  ├─ Reconocimiento de voz (Web Speech API, gratuito, en el navegador)
  ├─ Síntesis de voz (Web Speech API, gratuito, en el navegador)
  └─ POST /api/chat  ───────────────►  Servidor (Next.js API route, Node)
                                          ├─ Claude (Anthropic) con tool-calling real
                                          ├─ Motor de reglas (lib/tools.js)
                                          └─ ANTHROPIC_API_KEY (nunca en el frontend)

POST /api/export-word  → genera un .docx real (tablas nativas, fórmula OMML editable)
POST /api/studies      → guarda/lista estudios (opcional, requiere Redis)
```

No existe un modelo de voz-a-voz nativo de Anthropic: la "conversación en tiempo
real" se consigue con reconocimiento de voz del navegador + Claude (con
herramientas) + síntesis de voz del navegador, con interrupción (barge-in) y
reinicio automático del micrófono. Es la arquitectura estándar para este tipo
de agentes cuando no se usa un proveedor de voz-a-voz dedicado.

## Puesta en marcha (obligatorio)

1. **Reclama el despliegue** con el Claim URL que te ha dado Claude, para
   pasarlo a tu cuenta de Vercel.
2. En el proyecto de Vercel: **Settings → Environment Variables** → añade
   `ANTHROPIC_API_KEY` con tu clave de `console.anthropic.com` (Production
   y Preview).
3. Vuelve a desplegar (**Deployments → ⋯ → Redeploy**) para que la variable
   surta efecto.

Sin la clave configurada, `/api/chat` devuelve un error explícito indicándolo.

## Persistencia de estudios (opcional)

El botón "Guardar estudio" y el listado de estudios previos necesitan un
almacenamiento Redis. Para activarlo:

1. En el proyecto de Vercel → **Storage** → añade una integración de Redis
   (Upstash, desde el Marketplace de Vercel).
2. Vercel añade automáticamente las variables `KV_REST_API_URL` /
   `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
3. Redespliega.

Sin esto configurado, la app sigue funcionando con normalidad; solo que
"Guardar estudio" avisa de que no hay almacenamiento conectado.

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # y añade tu ANTHROPIC_API_KEY
npm run dev
```

## Qué incluye esta primera versión (v1)

- Conversación de voz en tiempo real con interrupciones (barge-in) y
  reconocimiento continuo en español.
- Captura estructurada de datos mediante herramientas reales de Claude
  (identificación, solicitud, CT, tramos de red BT, condicionantes,
  alternativas, cálculos, pendientes, conclusión).
- Correcciones y contradicciones gestionadas de forma conversacional.
- Panel visual en vivo: datos confirmados/pendientes + borrador del informe.
- Corrección manual (edición directa del JSON) como red de seguridad.
- Comandos de voz: "¿qué tenemos?", "redacta el informe", "cierra el informe",
  correcciones y nuevo tramo.
- Exportación a Word real (tablas nativas, una fórmula de ejemplo en formato
  nativo de Word/OMML editable) y a JSON.
- Backend seguro: la clave de Anthropic nunca se expone en el navegador.

## Qué queda para siguientes versiones (deliberadamente fuera del v1)

Siguiendo la propia priorización del encargo (sección 62): primero una buena
conversación de voz y una captura de datos fiable; después:

- Voz más natural (TTS de pago tipo ElevenLabs/OpenAI) — ahora mismo usa las
  voces gratuitas del navegador, algo robóticas.
- Persistencia completa multi-dispositivo (requiere terminar de conectar Redis
  o Postgres, ver arriba).
- Integración con el motor normativo (REBT/ITC-BT) ya desarrollado en otra
  herramienta de GRIDDEx.
- Análisis de capturas de pantalla (sección 52) y Computer Use (sección 53).
- Historial detallado de cambios por estudio (sección 56).
- Generación de todas las fórmulas del informe en OMML (de momento hay una de
  referencia; el resto del informe se genera como texto/Markdown enriquecido).

## Estructura de carpetas

```
/app
  /api/chat          → bucle de conversación con Claude y herramientas
  /api/export-word   → generación del .docx real
  /api/studies       → persistencia opcional
  page.js            → interfaz de voz (React)
  layout.js, globals.css
/lib
  systemPrompt.js    → instrucciones del agente (tu documento + formato de voz)
  tools.js           → definición de herramientas + motor de reglas
  storage.js         → persistencia opcional (Redis/Upstash)
  markdown.js        → utilidades de renderizado
```
