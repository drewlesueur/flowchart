const sampleList = document.getElementById("sampleList");
const listStatus = document.getElementById("listStatus");
const createFileForm = document.getElementById("createFileForm");
const newFileNameInput = document.getElementById("newFileName");
const createFileStatus = document.getElementById("createFileStatus");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function defaultContentFor(name) {
  const baseName = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_") || "main";
  return `${baseName}:\nreturn\n`;
}

function renderList(items) {
  if (!items.length) {
    sampleList.innerHTML = `<div class="empty-state">No TrickleScript files yet. Create one above.</div>`;
    listStatus.textContent = "0 files";
    return;
  }

  sampleList.innerHTML = items.map((item) => `
    <a class="file-card" href="/detail.html?sample=${encodeURIComponent(item.id)}">
      <div class="file-card-head">
        <h3>${escapeHtml(item.name)}</h3>
        <span class="pill">${escapeHtml(item.language)}</span>
      </div>
      <p>${escapeHtml(item.description)}</p>
      <span class="file-open">Open code + chart</span>
    </a>
  `).join("");

  listStatus.textContent = `${items.length} files`;
}

async function loadList() {
  try {
    const response = await fetch("/api/files");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    renderList(await response.json());
  } catch (error) {
    sampleList.innerHTML = `<div class="empty-state">Could not load files: ${escapeHtml(error.message)}</div>`;
    listStatus.textContent = "Load error";
  }
}

async function createFile(event) {
  event.preventDefault();

  const name = newFileNameInput.value.trim();
  if (!name) {
    createFileStatus.textContent = "Enter a file name.";
    return;
  }

  createFileStatus.textContent = "Creating...";

  try {
    const response = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        content: defaultContentFor(name),
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    window.location.href = `/detail.html?sample=${encodeURIComponent(payload.id)}`;
  } catch (error) {
    createFileStatus.textContent = `Could not create file: ${error.message}`;
  }
}

createFileForm.addEventListener("submit", createFile);
loadList();
