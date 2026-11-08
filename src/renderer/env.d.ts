declare module '*.css';
declare module '*.png' { const url: string; export default url; }
/** `import.meta.glob` do Vite (só o formato usado aqui; sem depender de `vite/client`). */
interface ImportMeta { glob(pattern: string, options: { eager: true; query: string; import: string }): Record<string, unknown> }
