function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(s) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return out;
}

function markdownToHtml(md) {
  const lines = String(md || "").split("\n");
  let html = "";
  let listType = null;
  const closeList = () => {
    if (listType) {
      html += listType === "ul" ? "</ul>" : "</ol>";
      listType = null;
    }
  };
  for (const line of lines) {
    if (/^\s*$/.test(line)) { closeList(); continue; }
    let m;
    if ((m = line.match(/^#{1}\s+(.*)/))) { closeList(); html += `<h1>${inlineMd(m[1])}</h1>`; continue; }
    if ((m = line.match(/^#{2}\s+(.*)/))) { closeList(); html += `<h2>${inlineMd(m[1])}</h2>`; continue; }
    if ((m = line.match(/^#{3,}\s+(.*)/))) { closeList(); html += `<h3>${inlineMd(m[1])}</h3>`; continue; }
    if ((m = line.match(/^[-*]\s+(.*)/))) {
      if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
      html += `<li>${inlineMd(m[1])}</li>`;
      continue;
    }
    if ((m = line.match(/^\d+\.\s+(.*)/))) {
      if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
      html += `<li>${inlineMd(m[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inlineMd(line)}</p>`;
  }
  closeList();
  return html;
}

module.exports = { markdownToHtml, escapeHtml };
