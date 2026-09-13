import { defineConfig } from '@orval/core';

export default defineConfig({
  api: {
    input: {
      target: './lib/api-spec/openapi.yaml',
      converters: [],
      validation: true,
    },
    output: {
      mode: 'tags-split',
      target: './src/services/api/__generated__',
      schemas: './src/services/api/__generated__/models',
      client: 'react-query',
      mock: false,
      prettier: true,
    },
    hooks: {
      afterAllFilesWrite: 'prettier --write',
    },
  },
});
