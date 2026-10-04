// 构建：相对路径（能挂在任意子路径，如 GitHub Pages 的 /glass-cad/），Worker 用 ES 模块
export default {
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
};
