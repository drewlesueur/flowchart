# Flow Chart Lab

A dependency-free Node.js app for experimenting with code-to-flowchart rendering.

## Run

```bash
node server.js
```

Then open `https://localhost:3000`.

## Notes

- The UI lets you paste code on the left and see the generated SVG flow chart on the right.
- The homepage renders the flow chart as SVG, and `/canvas.html` renders the same chart with Canvas.
- The parser is intentionally lightweight and works best with JavaScript-style control flow using braces.
- Supported structures include sequential statements, `if` / `else`, `for`, `while`, `return`, and function-like blocks.
- The server starts with HTTPS and reads `CERT_FILE` and `KEY_FILE` from `.env`.
