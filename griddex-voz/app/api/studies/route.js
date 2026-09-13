import { saveStudy, listStudies, storageAvailable } from "../../../lib/storage";

export const runtime = "nodejs";

export async function GET() {
  if (!storageAvailable()) {
    return Response.json({ disponible: false, items: [] });
  }
  const { items } = await listStudies(30);
  return Response.json({ disponible: true, items });
}

export async function POST(req) {
  const body = await req.json();
  const estado = body.estado || {};
  const id = body.id || `${Date.now()}`;
  const record = {
    id,
    cliente: estado.identificacion && estado.identificacion.cliente,
    municipio: estado.identificacion && estado.identificacion.municipio,
    expediente: estado.identificacion && estado.identificacion.expediente,
    potencia: estado.solicitud && estado.solicitud.potencia_solicitada_kw,
    estado_conclusion: estado.conclusion && estado.conclusion.estado,
    fecha: new Date().toISOString(),
    estudio: estado,
  };
  const result = await saveStudy(id, record);
  return Response.json({ ...result, id });
}
