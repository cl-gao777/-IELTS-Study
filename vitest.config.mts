import {defineConfig} from 'vitest/config';
import path from 'node:path';
export default defineConfig({resolve:{alias:{'@':path.resolve(import.meta.dirname,'src')}},test:{maxWorkers:2,testTimeout:15000,hookTimeout:15000,exclude:['**/node_modules/**','**/.next/**','**/work/**']}});
