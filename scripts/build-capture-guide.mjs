import { createWriteStream, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

export async function buildCaptureGuide(output, captures) {
  const pdf = new PDFDocument({ autoFirstPage: false, margin: 30 });
  const stream = createWriteStream(path.join(output, "guia-das-telas.pdf"));
  const finished = new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    pdf.on("error", reject);
  });
  pdf.pipe(stream);
  pdf.addPage({ size: "A4", margin: 30 });
  pdf.fontSize(29).fillColor("#392c23").text("Mapa visual do projeto");
  pdf.moveDown().fontSize(18).text("Cores & Fragrâncias by Berenice");
  pdf
    .moveDown()
    .fontSize(12)
    .text(
      `${captures.length} telas com identificação de suas partes.\nCapturas reais em banco isolado, exclusivamente com dados fictícios.\n\nUse a galeria index.html para abrir as fotos em resolução original e pesquisar por área. Capturas longas são divididas nas páginas seguintes para preservar a leitura.\n\nAs marcações não fazem parte do site; foram acrescentadas apenas às imagens. O relatório de produtos está em arquivo separado.`,
    );
  let pages = 1;
  for (const capture of captures) {
    const file = path.join(output, capture.file),
      image = pdf.openImage(file),
      mobile = capture.viewport.width < 700;
    const pageWidth = mobile ? 595.28 : 841.89,
      pageHeight = mobile ? 841.89 : 595.28;
    const width = mobile ? 360 : pageWidth - 60,
      scale = width / image.width,
      slice = pageHeight - 140,
      height = image.height * scale,
      x = (pageWidth - width) / 2;
    for (let offset = 0, part = 1; offset < height; offset += slice, part++) {
      pdf.addPage({
        size: "A4",
        layout: mobile ? "portrait" : "landscape",
        margin: 30,
      });
      pages++;
      pdf
        .fontSize(13)
        .fillColor("#392c23")
        .text(
          `${capture.number} · ${capture.title}${height > slice ? ` · parte ${part}` : ""}`,
          30,
          20,
          { width: pageWidth - 60 },
        );
      pdf
        .fontSize(8)
        .fillColor("#705640")
        .text(`${capture.area} | ${capture.route} | Dados fictícios`, 30, 50, {
          width: pageWidth - 60,
        });
      pdf.save();
      pdf.rect(x, 75, width, slice).clip();
      pdf.image(file, x, 75 - offset, { width });
      pdf.restore();
      pdf
        .fontSize(7.5)
        .fillColor("#705640")
        .text(
          capture.parts.map((p) => `${p.number}. ${p.label}`).join("  |  "),
          30,
          pageHeight - 58,
          { width: pageWidth - 60, height: 28, ellipsis: true },
        );
    }
  }
  pdf.end();
  await finished;
  return pages;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const output = fileURLToPath(new URL("../docs/capturas/", import.meta.url));
  const { captures } = JSON.parse(
    readFileSync(path.join(output, "manifesto.json"), "utf8"),
  );
  console.log(
    `Guia reconstruído: ${await buildCaptureGuide(output, captures)} páginas.`,
  );
}
