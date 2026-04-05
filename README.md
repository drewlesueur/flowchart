# Flow Chart Lab

A dependency-free Node.js app for experimenting with code-to-flowchart rendering.

## Run

```bash
node server.js
```

Then open `http://localhost:3000`.

## Notes

- The UI lets you paste code on the left and see the generated SVG flow chart on the right.
- The parser is intentionally lightweight and works best with JavaScript-style control flow using braces.
- Supported structures include sequential statements, `if` / `else`, `for`, `while`, `return`, and function-like blocks.
