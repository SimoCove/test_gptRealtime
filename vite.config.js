import { resolve } from "path";

export default {
    root: '.',

    publicDir: 'files',

    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, "index.html")
            }
        }
    },

    server: {
        port: 3001,
        open: true
    },

    resolve: {
        alias: {
            "@": resolve(__dirname, "src")
        }
    }
};
