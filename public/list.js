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
  const baseName = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_") || "newFlow";
  return `function ${baseName}() {\n  \n}\n`;
}

function renderList(items) {
  if (!items.length) {
    sampleList.innerHTML = `<div class="empty-state">No files are available yet. Create one above.</div>`;
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
    const response = await fetch("/api/files");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const items = await response.json();
    renderList(items);
  } catch (error) {
    sampleList.innerHTML = `<div class="empty-state">Could not load the file list: ${escapeHtml(error.message)}</div>`;
    listStatus.textContent = "Load error.";
  }
}

async function createFile(event) {
  event.preventDefault();

  const name = newFileNameInput.value.trim();
  if (!name) {
    createFileStatus.textContent = "Enter a file name first.";
    return;
  }

  createFileStatus.textContent = "Creating file...";

  try {
    const response = await fetch("/api/files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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
