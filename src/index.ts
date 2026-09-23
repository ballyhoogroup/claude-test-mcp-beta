import { createApp } from "./app.js";

const PORT = Number(process.env.PORT) || 3000;
createApp().listen(PORT, () => {
  console.log(`Pitch-Fork MCP server listening on port ${PORT}`);
});
