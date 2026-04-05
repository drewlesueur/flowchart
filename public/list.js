const sampleList = document.getElementById("sampleList");
const listStatus = document.getElementById("listStatus");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderList(items) {
  if (!items.length) {
    sampleList.innerHTML = `<div class="empty-state">No sample files are available.</div>`;
    listStatus.textContent = "0 files.";
    return;
  }

  sampleList.innerHTML = items
    .map(
      (item) => `<a class="sample-card" href="/detail.html?sample=${encodeURIComponent(item.id)}">
        <div class="sample-card-head">
          <h3>${escapeHtml(item.name)}</h3>
          <span class="sample-pill">${escapeHtml(item.language)}</span>
        </div>
        <p>${escapeHtml(item.description)}</p>
        <span class="sample-open">Open detail view</span>
      </a>`
    )
    .join("");

  listStatus.textContent = `${items.length} files available.`;
}

async function loadList() {
  try {
    const response = await fetch("/samples/index.json");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const items = await response.json();
    renderList(items);
  } catch (error) {
    sampleList.innerHTML = `<div class="empty-state">Could not load the sample list: ${escapeHtml(error.message)}</div>`;
    listStatus.textContent = "Load error.";
  }
}

loadList();
