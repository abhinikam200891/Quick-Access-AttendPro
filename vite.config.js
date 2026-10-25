import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true, // Listen on all network interfaces for real mobile phone LAN testing!
    open: false
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        checkin: resolve(__dirname, 'checkin.html'),
        host: resolve(__dirname, 'host.html')
      }
    }
  }
});
