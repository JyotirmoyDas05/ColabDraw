<div align="center">
  <img src="./public/Brand.png" alt="ColabDraw Brand" width="600"/>
  
  <h1>ColabDraw</h1>
  
  <p>
    <strong>An open source collaborative virtual whiteboard</strong><br/>
    Hand-drawn style • Real-time collaboration • End-to-end encrypted
  </p>
  <!-- DeepWiki Badge -->
  <p>
    <a href="https://deepwiki.com/JyotirmoyDas05/ColabDraw">
      <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" height="40" />
    </a>
  </p>

  <br/>

  <!-- Badges -->
  <p>
    <a href="https://github.com/JyotirmoyDas05/ColabDraw/blob/master/LICENSE">
      <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
    </a>
    <a href="https://github.com/JyotirmoyDas05/ColabDraw">
      <img alt="GitHub Stars" src="https://img.shields.io/github/stars/JyotirmoyDas05/ColabDraw?style=social" />
    </a>
    <a href="https://github.com/JyotirmoyDas05/ColabDraw/fork">
      <img alt="GitHub Forks" src="https://img.shields.io/github/forks/JyotirmoyDas05/ColabDraw?style=social" />
    </a>
  </p>

  <p>
    <img alt="Node Version" src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" />
    <img alt="Bun Version" src="https://img.shields.io/badge/Bun-%3E%3D1.0.0-black?logo=bun" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-4.9.4-3178C6?logo=typescript&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-5.0.12-646CFF?logo=vite&logoColor=white" />
  </p>

  <p>
    <a href="https://github.com/JyotirmoyDas05/ColabDraw/issues">
      <img alt="GitHub Issues" src="https://img.shields.io/github/issues/JyotirmoyDas05/ColabDraw" />
    </a>
    <a href="https://github.com/JyotirmoyDas05/ColabDraw/pulls">
      <img alt="PRs Welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" />
    </a>
    <a href="https://github.com/JyotirmoyDas05/ColabDraw/graphs/contributors">
      <img alt="Contributors" src="https://img.shields.io/github/contributors/JyotirmoyDas05/ColabDraw" />
    </a>
    <img alt="Last Commit" src="https://img.shields.io/github/last-commit/JyotirmoyDas05/ColabDraw" />
  </p>

  <p>
    <img alt="Maintained" src="https://img.shields.io/badge/Maintained%3F-yes-green.svg" />
    <img alt="Open Source Love" src="https://badges.frapsoft.com/os/v1/open-source.svg?v=103" />
    <img alt="Built with Love" src="https://img.shields.io/badge/Built%20with-%E2%9D%A4-red" />
  </p>

---

</div>

> [!NOTE] > **ColabDraw** has taken some Components from [Excalidraw](https://github.com/excalidraw/excalidraw), and Fully Customized it according to the Project Author's Likings and is currently Maintained by JyotirmoyDas05. This project maintains the MIT license and includes all original copyright attributions as required.

## Features

The ColabDraw editor supports:

- 💯 Free & open-source
- 🎨 Infinite, canvas-based whiteboard
- ✍️ Hand-drawn like style
- 🌘 Dark mode
- 🏗️ Customizable
- 📷 Image support
- 😀 Shape libraries support
- 🌐 Localization (i18n) support
- 🖼️ Export to PNG, SVG & clipboard
- 💾 Open format - export drawings as an `.excalidraw` json file
- ⚒️ Wide range of tools - rectangle, circle, diamond, arrow, line, free-draw, eraser...
- ➡️ Arrow-binding & labeled arrows
- 🔙 Undo / Redo
- 🔍 Zoom and panning support

## ColabDraw App Features

- ⚡ **Powered by Bun** (ultra-fast builds and installs)
- 📡 PWA support (works offline)
- 🤼 Real-time collaboration via Cloudflare Workers & Durable Objects
- 🔒 End-to-end encryption
- 📊 Web Analytics with Vercel Integration
- 💾 Local-first support (autosaves to the browser)
- 🔗 Shareable links

## Development

### Prerequisites

- Node.js >= 18.0.0
- **Bun >= 1.0.0** (Recommended)

### Quick Start

```bash
# Install dependencies
bun install

# Configure environment variables
cp .env.development.example .env.development
# Edit .env.development if your backend URL is not http://localhost:8787

# Start development server
bun run dev

# Build for production
bun run build
```

### Available Scripts

- `bun run dev` - Start development server (Frontend)
- `bun run build` - Build for production (All packages + App)
- `bun run test` - Run tests
- `bun run fix` - Auto-fix linting and formatting issues

## Building & Deployment

### Local Development

```bash
bun run dev
```

The app will be available at `http://localhost:3000`

### Production Build

```bash
bun run build:app
```

### Docker

```bash
# Build Docker image
docker build -t colabdraw .

# Run Docker container
docker run -p 80:80 colabdraw
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### Attribution

ColabDraw includes code from [Excalidraw](https://github.com/excalidraw/excalidraw), which is also licensed under the MIT License. See [LICENSE](LICENSE) for full copyright notices.
