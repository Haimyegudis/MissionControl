import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function developmentApiToken(): string {
  try {
    const root = process.env.JIRAWEB_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'JiraWeb');
    return fs.readFileSync(path.join(root, 'api-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Android boot splash.
 *
 * index.html carries the desktop "mission control radar", which paints before
 * React and so cannot be swapped at runtime — the phone kept showing the
 * desktop animation no matter what the app did afterwards. This rewrites the
 * markup and styles at build time for the Android target only, so the boot
 * animation matches the flight-deck theme the app uses.
 */
function mobileSplash(enabled: boolean) {
  return {
    name: 'mc-mobile-splash',
    transformIndexHtml(html: string) {
      if (!enabled) return html;
      const markup = `
    <div id="splash" aria-hidden="true">
      <div class="sp-stage">
        <div class="mb-reactor">
          <i></i><i></i><i></i>
          <b></b>
        </div>
        <div class="mb-word"><b>MISSION</b> CONTROL</div>
        <div class="mb-sub">flight deck</div>
      </div>
    </div>`;
      const style = `
    <style>
      /* Android boot splash — matches the in-app reactor loader. */
      #splash {
        background:
          radial-gradient(120% 80% at 12% -10%, rgba(41,240,224,.12) 0%, transparent 55%),
          radial-gradient(100% 70% at 92% 4%, rgba(255,78,205,.10) 0%, transparent 55%),
          linear-gradient(180deg,#060a18 0%,#04060f 100%) !important;
      }
      #splash .sp-stage { display:flex; flex-direction:column; align-items:center; gap:0; }
      #splash .mb-reactor { position:relative; width:96px; height:96px; }
      #splash .mb-reactor i {
        position:absolute; inset:0; border-radius:50%;
        border:1.5px solid transparent; display:block;
      }
      #splash .mb-reactor i:nth-child(1){ border-top-color:#29f0e0; border-right-color:#29f0e0; animation:mb-spin 1.1s linear infinite; }
      #splash .mb-reactor i:nth-child(2){ inset:14px; border-bottom-color:#ff4ecd; border-left-color:#ff4ecd; animation:mb-spin 1.6s linear infinite reverse; opacity:.85; }
      #splash .mb-reactor i:nth-child(3){ inset:28px; border-top-color:#5aa9ff; animation:mb-spin .85s linear infinite; opacity:.7; }
      #splash .mb-reactor b {
        position:absolute; inset:40px; border-radius:50%;
        background:#29f0e0; box-shadow:0 0 22px #29f0e0; animation:mb-core 1.4s ease-in-out infinite;
      }
      #splash .mb-word {
        margin-top:26px; font-size:19px; letter-spacing:.34em; color:#eaf2ff;
        font-family:var(--font-display,system-ui); opacity:0; animation:mb-in .5s ease .15s forwards;
      }
      #splash .mb-word b { color:#29f0e0; font-weight:800; }
      #splash .mb-sub {
        margin-top:7px; font-size:10px; letter-spacing:.42em; text-transform:uppercase;
        color:#7d94b8; opacity:0; animation:mb-in .5s ease .3s forwards;
      }
      @keyframes mb-spin { to { transform:rotate(360deg); } }
      @keyframes mb-core { 0%,100% { transform:scale(.72); opacity:.6; } 50% { transform:scale(1); opacity:1; } }
      @keyframes mb-in { to { opacity:1; } }
      @media (prefers-reduced-motion: reduce) {
        #splash .mb-reactor i, #splash .mb-reactor b { animation:none !important; }
      }
    </style>`;
      const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://hp-jira.external.hp.com https://hp-testrail.external.hp.com; font-src 'self' data:; connect-src 'self' https://hp-jira.external.hp.com https://hp-testrail.external.hp.com">`;
      return html
        .replace(/<div id="splash"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, markup.trim())
        .replace('</head>', `${csp}\n${style}\n  </head>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), mobileSplash(process.env.MC_TARGET === 'android')],
  define: {
    // 'android' drops the desktop-only view chunks at build time.
    __MC_TARGET__: JSON.stringify(process.env.MC_TARGET === 'android' ? 'android' : 'desktop'),
  },
  resolve: {
    // Resolve the workspace package to TypeScript source so the client does
    // not need core/dist prebuilt and keeps HMR on shared logic.
    alias: { '@mc/core': path.resolve(__dirname, '../core/src/index.ts') },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-cacheable vendor chunk (react barely changes between builds).
        manualChunks(id) {
          return /node_modules[\\/]react(?:-dom)?[\\/]/.test(id) ? 'vendor' : undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5643',
        changeOrigin: false,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.startsWith('/api/bootstrap') && !req.headers['x-mc-token']) {
              const token = developmentApiToken();
              if (token) proxyReq.setHeader('x-mc-token', token);
            }
          });
        },
      },
    },
  },
});
