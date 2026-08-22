# IntraSend-style GitHub Pages version

This version is designed for GitHub Pages.

## Important

GitHub Pages cannot run Node.js/WebSocket server code. The frontend therefore needs a separate WebSocket signaling server.

1. Deploy the signaling server from the Node.js project to Render, Railway, Fly.io, a VPS, or another WebSocket-capable host.
2. Open `docs/config.js`.
3. Set:
   `window.INTRASEND_SIGNALING_URL = "wss://YOUR-SERVER";`
4. Push this repository to GitHub.
5. Enable GitHub Pages using the `docs` folder.

The actual files remain peer-to-peer over WebRTC. The signaling server is only used for pairing/connection negotiation.
