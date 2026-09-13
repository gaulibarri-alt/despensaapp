import {
  Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, Math as DocxMath, MathRun, MathFraction,
  MathRadical, MathNumerator, MathDenominator,
} from "docx";

export const runtime = "nodejs";

function inlineRuns(text) {
  const parts = String(text).split(/(\*\*.+?\*\*)/g).filter((p) => p.length);
  return parts.map((p) => {
    const m = p.match(/^\*\*(.+)\*\*$/);
    return m ? new TextRun({ text: m[1], bold: true }) : new TextRun(p);
  });
}

function markdownToParagraphs(md) {
  const lines = String(md || "").split("\n");
  const children = [];
  for (const line of lines) {
    let m;
    if (/^\s*$/.test(line)) { children.push(new Paragraph({ text: "" })); continue; }
    if ((m = line.match(/^#{1}\s+(.*)/))) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: inlineRuns(m[1]) })); continue; }
    if ((m = line.match(/^#{2}\s+(.*)/))) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 }, children: inlineRuns(m[1]) })); continue; }
    if ((m = line.match(/^#{3,}\s+(.*)/))) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 }, children: inlineRuns(m[1]) })); continue; }
    if ((m = line.match(/^[-*]\s+(.*)/))) { children.push(new Paragraph({ children: inlineRuns(m[1]), bullet: { level: 0 } })); continue; }
    if ((m = line.match(/^\d+\.\s+(.*)/))) { children.push(new Paragraph({ children: inlineRuns(m[1]) })); continue; }
    children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 300 }, children: inlineRuns(line) }));
  }
  return children;
}

function cell(text, opts) {
  opts = opts || {};
  return new TableCell({
    width: { size: opts.width || 20, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? "—"), bold: !!opts.bold })] })],
  });
}

function tramosTable(tramos) {
  if (!tramos || !tramos.length) return null;
  const header = new TableRow({
    tableHeader: true,
    children: ["Tramo", "Tipo", "Cable / Sección", "Longitud", "Carga actual"].map((t) => cell(t, { bold: true, width: 20 })),
  });
  const rows = tramos.map((t) => new TableRow({
    children: [
      cell(t.tramo, { width: 10 }),
      cell(t.tipo || "—", { width: 20 }),
      cell([t.cable, t.material, t.fases, t.neutro].filter(Boolean).join(" "), { width: 35 }),
      cell(t.longitud_m != null ? `${t.longitud_m} m` : "— pendiente —", { width: 15 }),
      cell(t.carga_actual_a != null ? `${t.carga_actual_a} A` : "— pendiente —", { width: 20 }),
    ],
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] });
}

function calculosTable(calculos) {
  const entries = Object.entries(calculos || {});
  if (!entries.length) return null;
  const header = new TableRow({
    tableHeader: true,
    children: ["Cálculo", "Valor", "Fórmula / hipótesis"].map((t) => cell(t, { bold: true, width: 25 })),
  });
  const rows = entries.map(([nombre, v]) => new TableRow({
    children: [
      cell(nombre, { width: 25 }),
      cell(typeof v === "object" ? v.valor : v, { width: 25 }),
      cell(typeof v === "object" ? [v.formula, v.hipotesis].filter(Boolean).join(" · ") || "—" : "—", { width: 50 }),
    ],
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] });
}

function formulaIntensidad() {
  // I = P / (√3 · U · cos φ)  — ecuación nativa de Word (OMML), editable.
  return new Paragraph({
    children: [
      new DocxMath({
        children: [
          new MathRun("I="),
          new MathFraction({
            numerator: [new MathRun("P")],
            denominator: [
              new MathRadical({ children: [new MathRun("3")] }),
              new MathRun("·U·cosφ"),
            ],
          }),
        ],
      }),
    ],
  });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const estado = body.estado || {};
    const informe = body.informe_markdown || estado.informe_markdown || "";
    const id = estado.identificacion || {};

    const children = [];

    children.push(new Paragraph({ text: "GRIDDEx Ingeniería y Consultoría Eléctrica", heading: HeadingLevel.TITLE, spacing: { after: 60 } }));
    children.push(new Paragraph({ text: "Informe de Viabilidad Eléctrica", heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Expediente: ${id.expediente || "—"}`, bold: true })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Cliente: ${id.cliente || "—"}` })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Ubicación: ${[id.direccion, id.municipio, id.provincia].filter(Boolean).join(", ") || "—"}` })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Fecha: ${new Date().toLocaleDateString("es-ES")}` })], spacing: { after: 300 } }));

    children.push(...markdownToParagraphs(informe || "# INFORME DE VIABILIDAD ELÉCTRICA\n\nBorrador aún no generado por el agente."));

    const tt = tramosTable(estado.red && estado.red.tramos);
    if (tt) {
      children.push(new Paragraph({ text: "Anexo — Tramos de red de baja tensión", heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } }));
      children.push(tt);
    }

    const ct = calculosTable(estado.calculos);
    if (ct) {
      children.push(new Paragraph({ text: "Anexo — Cálculos realizados", heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } }));
      children.push(ct);
    }

    children.push(new Paragraph({ text: "Anexo — Fórmula de referencia (intensidad en corriente trifásica)", heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } }));
    children.push(formulaIntensidad());

    const doc = new Document({
      styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      sections: [{ properties: {}, children }],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `Informe_Viabilidad_${(id.expediente || id.municipio || "Griddex").toString().replace(/[^a-z0-9]+/gi, "_")}.docx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message || "Error generando el Word." }, { status: 500 });
  }
}
