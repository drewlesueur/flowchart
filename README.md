# Flow Chart Lab

A dependency-free Node.js app for experimenting with code-to-flowchart rendering.

## Run

```bash
node server.js
```

Then open `https://localhost:3000`.

## Notes

- The homepage at `/` is a file browser with sample code files.
- The file browser reads and creates files from `FILES_DIR`, which is configured in `.env`.
- The detail page at `/detail.html` opens a file in the editor, can save it back to disk, and can toggle the preview between SVG and Canvas.
- The parser is intentionally lightweight and works best with JavaScript-style control flow using braces.
- Supported structures include sequential statements, `if` / `else`, `for`, `while`, `return`, and function-like blocks.
- The server starts with HTTPS and reads `CERT_FILE`, `KEY_FILE`, and `FILES_DIR` from `.env`.
